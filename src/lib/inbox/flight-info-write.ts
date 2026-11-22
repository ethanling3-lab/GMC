import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";
import { CUSTOM_HOTEL_PREFIX, MAX_HOTEL_NAME, customHotelName } from "@/lib/transfer/hotels";
import { syncFlightToTransferList, type TransferSync } from "@/lib/transfer/regenerate";
import { recordFlightChange, recordVipRequest, snapshotOf } from "@/lib/transfer/flight-flags";
import type { AdminContext } from "@/lib/admin-guard";

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
  /** Customer service changes are flagged, and their VIP choice becomes a request. */
  actor_role: AdminContext["role"];
  /** Originating conversation if fired from the inbox panel. */
  conversation_id?: string;
  /** Source label for audit metadata (e.g. "inbox_panel" | "transfer_list_dialog"). */
  via: string;
};

export type FlightReviewResult = {
  /** The change now waits in the admin's review list. */
  flagged?: boolean;
  vip_requested?: boolean;
  /** The save worked but the admin couldn't be flagged. */
  flag_failed?: boolean;
};

export type UpsertFlightInfoResult =
  | ({ ok: true; id: string; confirmed_at: string | null; transfer: TransferSync } & FlightReviewResult)
  | { ok: false; error: string };

// A flight with no time can't be put in a vehicle, so it can't be confirmed.
export const FLIGHT_TIME_REQUIRED = "scheduled_at_required";
export const FLIGHT_TIME_REQUIRED_DETAIL =
  "Add the flight date and time to confirm. 请填写航班日期和时间后再确认。";

export const HOTEL_NAME_REQUIRED = "hotel_name_required";
export const HOTEL_NAME_REQUIRED_DETAIL =
  "Type the hotel name, up to 200 characters. 请填写酒店名称（最多200字）。";

function emptyToNull(v: string | null | undefined): string | null {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}

export async function upsertFlightInfo(
  args: UpsertFlightInfoArgs,
): Promise<UpsertFlightInfoResult> {
  const scheduledAt = emptyToNull(args.fields.scheduled_at);
  if (args.confirm && !scheduledAt) {
    return { ok: false, error: FLIGHT_TIME_REQUIRED };
  }

  let hotelKey = emptyToNull(args.fields.hotel_key);
  const customHotel = customHotelName(hotelKey);
  if (customHotel !== null) {
    const name = customHotel.trim();
    if (!name || name.length > MAX_HOTEL_NAME) {
      return { ok: false, error: HOTEL_NAME_REQUIRED };
    }
    hotelKey = `${CUSTOM_HOTEL_PREFIX}${name}`;
  }

  const service = createSupabaseServiceClient();
  const isCustomerService = args.actor_role === "customer_service";

  const { data: enrollment, error: enrErr } = await service
    .from("enrollments")
    .select("id, event_id, participant_id")
    .eq("id", args.enrollment_id)
    .maybeSingle();
  if (enrErr) return { ok: false, error: enrErr.message };
  if (!enrollment) return { ok: false, error: "enrollment_not_found" };

  const { data: existing } = await service
    .from("flight_info")
    .select(
      "id, source, confirmed_at, flight_number, airline, origin_airport, destination_airport, scheduled_at, terminal, hotel_key, is_vip",
    )
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
    scheduled_at: scheduledAt,
    terminal: emptyToNull(args.fields.terminal),
    hotel_key: hotelKey,
    is_vip: isCustomerService
      ? (existing?.is_vip ?? false)
      : (args.fields.is_vip ?? false),
    source: existing?.source ?? "manual",
  };

  const vipRequested =
    isCustomerService &&
    args.fields.is_vip !== undefined &&
    args.fields.is_vip !== (existing?.is_vip ?? false);
  const requestVip = async (): Promise<FlightReviewResult> => {
    if (!vipRequested) return {};
    const saved = await recordVipRequest({
      eventId: enrollment.event_id,
      enrollmentId: args.enrollment_id,
      direction: args.direction,
      requestedVip: args.fields.is_vip as boolean,
      actorId: args.actor_id,
    });
    return saved ? { vip_requested: true } : { flag_failed: true };
  };

  // These decide who can share a vehicle. A typo fix elsewhere keeps the seat.
  const sameTime =
    (existing?.scheduled_at ? new Date(existing.scheduled_at).getTime() : null) ===
    (scheduledAt ? new Date(scheduledAt).getTime() : null);
  const seatAffected =
    !existing?.confirmed_at ||
    !scheduledAt ||
    !sameTime ||
    existing.terminal !== payload.terminal ||
    existing.hotel_key !== payload.hotel_key ||
    existing.is_vip !== payload.is_vip;
  const detailsChanged =
    seatAffected ||
    existing?.flight_number !== payload.flight_number ||
    existing?.airline !== payload.airline ||
    existing?.origin_airport !== payload.origin_airport ||
    existing?.destination_airport !== payload.destination_airport;
  if (existing?.confirmed_at && !detailsChanged) {
    return {
      ok: true,
      id: existing.id,
      confirmed_at: existing.confirmed_at,
      transfer: { list: "unchanged" },
      ...(await requestVip()),
    };
  }

  if (args.confirm) {
    payload.confirmed_by = args.actor_id;
    payload.confirmed_at = new Date().toISOString();
  } else if (!existing || !scheduledAt) {
    // Saving a draft without a time also takes a confirmed flight back to draft.
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

  const transfer: TransferSync =
    existing?.confirmed_at || upserted.confirmed_at
      ? await syncFlightToTransferList({
          eventId: enrollment.event_id,
          direction: args.direction,
          flightId: upserted.id,
          actorId: args.actor_id,
          seatAffected,
        })
      : { list: "none" };

  // A flight on file means they do need transport after all.
  await service
    .from("flight_followups")
    .update({
      [`${args.direction}_not_needed`]: false,
      updated_at: new Date().toISOString(),
    })
    .eq("enrollment_id", args.enrollment_id)
    .eq(`${args.direction}_not_needed`, true);

  const review: FlightReviewResult = await requestVip();
  if (isCustomerService && existing?.confirmed_at) {
    const saved = await recordFlightChange({
      eventId: enrollment.event_id,
      enrollmentId: args.enrollment_id,
      direction: args.direction,
      kind: "changed",
      before: snapshotOf(existing),
      after: snapshotOf(payload),
      actorId: args.actor_id,
    });
    if (saved) review.flagged = true;
    else review.flag_failed = true;
  }

  return {
    ok: true,
    id: upserted.id,
    confirmed_at: upserted.confirmed_at,
    transfer,
    ...review,
  };
}

export type DeleteFlightInfoArgs = {
  enrollment_id: string;
  direction: "arrival" | "departure";
  actor_id: string;
  actor_role: AdminContext["role"];
  conversation_id?: string;
  via: string;
};

export async function deleteFlightInfo(
  args: DeleteFlightInfoArgs,
): Promise<
  | ({ ok: true; deleted: boolean; transfer?: TransferSync } & FlightReviewResult)
  | { ok: false; error: string }
> {
  const service = createSupabaseServiceClient();
  const { data: existing } = await service
    .from("flight_info")
    .select(
      "id, confirmed_at, flight_number, airline, origin_airport, destination_airport, scheduled_at, terminal, hotel_key, is_vip, enrollment:enrollments!inner(event_id)",
    )
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

  const eventId = (existing.enrollment as unknown as { event_id: string }).event_id;
  const transfer = existing.confirmed_at
    ? await syncFlightToTransferList({
        eventId,
        direction: args.direction,
        flightId: existing.id,
        actorId: args.actor_id,
        seatAffected: true,
      })
    : undefined;

  const review: FlightReviewResult = {};
  if (args.actor_role === "customer_service") {
    const saved = await recordFlightChange({
      eventId,
      enrollmentId: args.enrollment_id,
      direction: args.direction,
      kind: "deleted",
      before: snapshotOf(existing),
      after: null,
      actorId: args.actor_id,
    });
    if (saved) review.flagged = true;
    else review.flag_failed = true;
  }

  return { ok: true, deleted: true, transfer, ...review };
}
