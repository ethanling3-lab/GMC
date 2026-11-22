import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";
import { loadGeneratorInputs } from "./load";
import { generateTransferList } from "./generate";
import { keepEditedRows, mergeRows, type EditedRow, type SavedRow } from "./preserve";
import {
  parseRulesOverride,
  type FlightDirection,
  type GeneratorRules,
} from "./types";

export type RegenerateResult =
  | {
      ok: true;
      id: string;
      rows: SavedRow[];
      total_pax: number;
      total_groups: number;
      kept_edited_rows: number;
    }
  | { ok: false; error: string; detail?: string; status: number };

// Rebuilds a draft list in one DB transaction. Manually edited rows are kept
// and only the other passengers are re-placed. Final lists are never touched.
export async function regenerateTransferList(args: {
  eventId: string;
  direction: FlightDirection;
  actorId: string;
  rules?: Partial<GeneratorRules>;
  force?: boolean;
  keepFlightIds?: ReadonlySet<string>;
  // A flight update may legitimately leave the list empty.
  allowEmpty?: boolean;
  auto?: boolean;
}): Promise<RegenerateResult> {
  const { eventId, direction, actorId, force = false } = args;

  const inputs = await loadGeneratorInputs(eventId, direction);
  if ("error" in inputs) {
    if (inputs.error === "event_not_found") {
      return { ok: false, error: "not_found", status: 404 };
    }
    if (inputs.error === "missing_main_venue_hotel_name") {
      return {
        ok: false,
        error: inputs.error,
        detail: "Set the event's main venue hotel name before generating a transfer list.",
        status: 400,
      };
    }
    return { ok: false, error: inputs.error, status: 500 };
  }

  const finalized = {
    ok: false as const,
    error: "already_finalized",
    detail: "This direction has a finalized list. Revert to draft before regenerating.",
    status: 409,
  };

  const service = createSupabaseServiceClient();
  const { data: existing, error: existErr } = await service
    .from("transfer_lists")
    .select("id, status, generated_at")
    .eq("event_id", eventId)
    .eq("direction", direction);
  if (existErr) return { ok: false, error: existErr.message, status: 500 };
  if ((existing ?? []).some((r) => r.status === "final")) return finalized;
  const drafts = existing ?? [];

  let edited: EditedRow[] = [];
  if (drafts.length > 0) {
    const { data: editedRows, error: editedErr } = await service
      .from("transfer_list_rows")
      .select(
        "vehicle_type, landing_or_takeoff_at, terminal, destination, remark, vip, flight_info_ids, manual_passengers",
      )
      .in("transfer_list_id", drafts.map((d) => d.id))
      .eq("admin_edited", true)
      .returns<EditedRow[]>();
    if (editedErr) return { ok: false, error: editedErr.message, status: 500 };
    edited = editedRows ?? [];
  }

  const { kept, keptFlightIds } = force
    ? { kept: [] as EditedRow[], keptFlightIds: new Set<string>() }
    : keepEditedRows(
        edited,
        inputs.flights,
        drafts[0]?.generated_at ?? null,
        args.keepFlightIds,
      );

  if (inputs.flights.length === 0 && kept.length === 0 && !args.allowEmpty) {
    return {
      ok: false,
      error: "no_flights",
      detail: `No confirmed ${direction} flights for this event yet.`,
      status: 400,
    };
  }

  const result = generateTransferList({
    direction,
    flights: inputs.flights.filter((f) => !keptFlightIds.has(f.flight_info_id)),
    context: inputs.context,
    rules: args.rules,
  });
  const rows = mergeRows(kept, result.groups);

  const { data: listId, error: saveErr } = await service.rpc("replace_transfer_list", {
    p_event_id: eventId,
    p_direction: direction,
    p_generated_by: actorId,
    p_rules: result.rules_snapshot,
    p_rows: rows,
  });
  if (saveErr || !listId) {
    if (saveErr?.message.includes("already_finalized")) return finalized;
    return { ok: false, error: saveErr?.message ?? "save_failed", status: 500 };
  }

  const totalPax = rows.reduce(
    (n, r) => n + r.flight_info_ids.length + r.manual_passengers.length,
    0,
  );
  await writeAuditLog({
    actor_id: actorId,
    action:
      force && edited.length > 0
        ? "transfer_list.regenerated_force"
        : "transfer_list.generated",
    entity: "transfer_lists",
    entity_id: listId as string,
    metadata: {
      event_id: eventId,
      direction,
      total_pax: totalPax,
      total_groups: rows.length,
      kept_edited_rows: kept.length,
      forced_over_edits: force && edited.length > 0 ? edited.length : undefined,
      auto_after_flight_change: args.auto ? true : undefined,
    },
  });

  return {
    ok: true,
    id: listId as string,
    rows,
    total_pax: totalPax,
    total_groups: rows.length,
    kept_edited_rows: kept.length,
  };
}

export type TransferSync =
  | { list: "unchanged" | "none" | "final" | "error" }
  | {
      list: "updated";
      outcome: "stayed" | "combined" | "new_pickup" | "removed";
      group_no: number | null;
      vehicle: string | null;
    };

// After a flight is saved or deleted: keep the passenger's seat if it still
// works, otherwise combine them with a compatible group or give them a new
// pickup. Uses the rules this list was built with, so one edit can't reshuffle
// everyone under changed event settings. A final list is left for staff.
export async function syncFlightToTransferList(args: {
  eventId: string;
  direction: FlightDirection;
  flightId: string;
  actorId: string;
  seatAffected: boolean;
}): Promise<TransferSync> {
  try {
    const service = createSupabaseServiceClient();
    const { data: list } = await service
      .from("transfer_lists")
      .select("id, status, rules_snapshot")
      .eq("event_id", args.eventId)
      .eq("direction", args.direction)
      .maybeSingle();
    if (!list) return { list: "none" };
    if (list.status === "final") return { list: "final" };

    const { data: beforeRows } = await service
      .from("transfer_list_rows")
      .select("flight_info_ids")
      .eq("transfer_list_id", list.id)
      .returns<{ flight_info_ids: string[] }[]>();
    const before = (beforeRows ?? []).find((r) =>
      r.flight_info_ids.includes(args.flightId),
    );
    const beforeMates = new Set(
      (before?.flight_info_ids ?? []).filter((id) => id !== args.flightId),
    );

    const result = await regenerateTransferList({
      eventId: args.eventId,
      direction: args.direction,
      actorId: args.actorId,
      rules: parseRulesOverride(list.rules_snapshot),
      keepFlightIds: args.seatAffected ? undefined : new Set([args.flightId]),
      allowEmpty: true,
      auto: true,
    });
    if (!result.ok) {
      return { list: result.error === "already_finalized" ? "final" : "error" };
    }

    const after = result.rows.find((r) => r.flight_info_ids.includes(args.flightId));
    if (!after) {
      return { list: "updated", outcome: "removed", group_no: null, vehicle: null };
    }
    const mates = after.flight_info_ids.filter((id) => id !== args.flightId);
    const hasOthers = mates.length + after.manual_passengers.length > 0;
    const outcome =
      mates.some((id) => !beforeMates.has(id))
        ? "combined"
        : !before
          ? hasOthers
            ? "combined"
            : "new_pickup"
          : !hasOthers && beforeMates.size > 0
            ? "new_pickup"
            : "stayed";
    return {
      list: "updated",
      outcome,
      group_no: after.group_no,
      vehicle: after.vehicle_type,
    };
  } catch {
    return { list: "error" };
  }
}
