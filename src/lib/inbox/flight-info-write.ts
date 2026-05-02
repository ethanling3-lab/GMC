import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";

// Shared upsert/delete helper for flight_info, used by both the inbox
// thread panel and the transfer-list "Add flight" dialog.
//
// Audit metadata captures the originating context (conversation_id when
// fired from inbox; absent when fired from /admin/transfer-lists). The
// upsert key stays (enrollment_id, direction).

export type FlightInfoFields = {
  flight_number?: string | null;
  airline?: string | null;
  origin_airport?: string | null;
  destination_airport?: string | null;
  scheduled_at?: string | null;
  terminal?: string | null;
  hotel_key?: string | null;
  is_vip?: boolean;
};

export type UpsertFlightInfoArgs = {
  enrollment_id: string;
  direction: "arrival" | "departure";
  fields: FlightInfoFields;
  confirm: boolean;
  actor_id: string;
  /** Originating conversation if fired from the inbox panel. */
  conversation_id?: string;
  /** Source label for audit metadata (e.g. "inbox_panel" | "transfer_list_dialog"). */
  via: string;
};

export type UpsertFlightInfoResult =
  | { ok: true; id: string; confirmed_at: string | null }
  | { ok: false; error: string };

function emptyToNull(v: string | null | undefined): string | null {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}

export async function upsertFlightInfo(
  args: UpsertFlightInfoArgs,
): Promise<UpsertFlightInfoResult> {
  const service = createSupabaseServiceClient();

  const { data: enrollment, error: enrErr } = await service
    .from("enrollments")
    .select("id, event_id, participant_id")
    .eq("id", args.enrollment_id)
    .maybeSingle();
  if (enrErr) return { ok: false, error: enrErr.message };
  if (!enrollment) return { ok: false, error: "enrollment_not_found" };

  const { data: existing } = await service
    .from("flight_info")
    .select("id, source, confirmed_at")
    .eq("enrollment_id", args.enrollment_id)
    .eq("direction", args.direction)
    .maybeSingle();

  const payload: Record<string, unknown> = {
    enrollment_id: args.enrollment_id,
    direction: args.direction,
    flight_number: emptyToNull(args.fields.flight_number),
    airline: emptyToNull(args.fields.airline),
    origin_airport: emptyToNull(args.fields.origin_airport),
    destination_airport: emptyToNull(args.fields.destination_airport),
    scheduled_at: emptyToNull(args.fields.scheduled_at),
    terminal: emptyToNull(args.fields.terminal),
    hotel_key: emptyToNull(args.fields.hotel_key),
    is_vip: args.fields.is_vip ?? false,
    source: existing?.source ?? "manual",
  };
  if (args.confirm) {
    payload.confirmed_by = args.actor_id;
    payload.confirmed_at = new Date().toISOString();
  } else if (!existing) {
    payload.confirmed_by = null;
    payload.confirmed_at = null;
  }

  const { data: upserted, error: upErr } = await service
    .from("flight_info")
    .upsert(payload, { onConflict: "enrollment_id,direction" })
    .select("id, confirmed_at")
    .single();
  if (upErr || !upserted) {
    return { ok: false, error: upErr?.message ?? "upsert_failed" };
  }

  await writeAuditLog({
    actor_id: args.actor_id,
    action: args.confirm
      ? "inbox.flight_info_confirmed"
      : "inbox.flight_info_extracted",
    entity: "flight_info",
    entity_id: upserted.id,
    metadata: {
      enrollment_id: args.enrollment_id,
      direction: args.direction,
      via: args.via,
      ...(args.conversation_id ? { conversation_id: args.conversation_id } : {}),
    },
  });

  return { ok: true, id: upserted.id, confirmed_at: upserted.confirmed_at };
}

export type DeleteFlightInfoArgs = {
  enrollment_id: string;
  direction: "arrival" | "departure";
  actor_id: string;
  conversation_id?: string;
  via: string;
};

export async function deleteFlightInfo(
  args: DeleteFlightInfoArgs,
): Promise<{ ok: true; deleted: boolean } | { ok: false; error: string }> {
  const service = createSupabaseServiceClient();
  const { data: existing } = await service
    .from("flight_info")
    .select("id")
    .eq("enrollment_id", args.enrollment_id)
    .eq("direction", args.direction)
    .maybeSingle();
  if (!existing) return { ok: true, deleted: false };

  const { error: delErr } = await service
    .from("flight_info")
    .delete()
    .eq("id", existing.id);
  if (delErr) return { ok: false, error: delErr.message };

  await writeAuditLog({
    actor_id: args.actor_id,
    action: "inbox.flight_info_extracted",
    entity: "flight_info",
    entity_id: existing.id,
    metadata: {
      enrollment_id: args.enrollment_id,
      direction: args.direction,
      deleted: true,
      via: args.via,
      ...(args.conversation_id ? { conversation_id: args.conversation_id } : {}),
    },
  });

  return { ok: true, deleted: true };
}
