import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "../supabase";
import { writeAuditLog } from "../audit";
import { verifyQrToken } from "./qr-token";
import { isPaidEnrollment, type CheckInMethod, type CheckInPerson } from "./types";
import type { Session } from "./mode";

export type CheckInResult =
  | {
      ok: true;
      check_in: {
        id: string;
        enrollment_id: string;
        participant_id: string;
        checked_in_at: string;
        check_in_date: string;
        session: Session;
        method: CheckInMethod;
        unpaid_override: boolean;
      };
    } & CheckInPerson
  | {
      ok: false;
      error: CheckInError;
      // Present when the enrollment was found, so the desk can still show who
      // it is — and, for `unpaid`, offer "check in anyway" by enrollment id.
      enrollment_id?: string;
      checked_in_at?: string;
    } & Partial<CheckInPerson>;

export type CheckInError =
  | "not_found"
  | "wrong_event"
  | "not_eligible"
  | "unpaid"
  | "already_checked_in"
  | "invalid_token";

// Performs a check-in for either a scanned QR token or a manually selected
// enrollment, for ONE event day and session (Morning / Afternoon
// registration). The caller (POST /api/admin/events/[id]/check-in) does role
// gating and the date/mode gate (gate.ts), and supplies day + session.
//
// Who can check in:
//   paid (status or payment_status)          → yes
//   approved but unpaid                      → `unpaid`, unless allowUnpaid —
//                                              the desk's explicit override,
//                                              recorded on the row
//   pending / rejected / cancelled           → `not_eligible`

type WriteArgs = {
  eventId: string;
  actorId: string;
  method: CheckInMethod;
  /** Event-local YYYY-MM-DD, from todayInEventTz() on the server. */
  checkInDate: string;
  session: Session;
  /** Event is in check-in test mode — the row is flagged for clearing. */
  isTest: boolean;
  qrToken?: string | null;
  enrollmentId?: string | null;
  allowUnpaid?: boolean;
  notes?: string | null;
};

type EnrollmentRow = {
  id: string;
  event_id: string;
  participant_id: string;
  status: string;
  payment_status: string;
  qr_token: string | null;
};

export async function performCheckIn(args: WriteArgs): Promise<CheckInResult> {
  const { eventId, actorId, method, checkInDate, session, isTest, qrToken, enrollmentId, notes } =
    args;
  const supabase = createSupabaseServiceClient();

  const resolved = await resolveEnrollment(supabase, eventId, qrToken, enrollmentId);
  if ("error" in resolved) return { ok: false, error: resolved.error };
  const row = resolved.row;

  const paid = isPaidEnrollment(row);
  if (!paid && row.status !== "approved") {
    return { ok: false, error: "not_eligible", enrollment_id: row.id };
  }
  if (!paid && !args.allowUnpaid) {
    const person = await loadPerson(supabase, eventId, row.participant_id);
    return { ok: false, error: "unpaid", enrollment_id: row.id, ...person };
  }

  const duplicate = async (): Promise<CheckInResult> => {
    const [{ data: existing }, person] = await Promise.all([
      supabase
        .from("check_ins")
        .select("id, checked_in_at")
        .eq("enrollment_id", row.id)
        .eq("check_in_date", checkInDate)
        .eq("session", session)
        .maybeSingle(),
      loadPerson(supabase, eventId, row.participant_id),
    ]);
    await writeAuditLog({
      actor_id: actorId,
      action: "check_in.duplicate_attempt",
      entity: "check_ins",
      entity_id: existing?.id ?? row.id,
      metadata: {
        event_id: eventId,
        check_in_date: checkInDate,
        session,
        method,
        attempted_via: qrToken ? "qr" : "manual",
      },
    });
    return {
      ok: false,
      error: "already_checked_in",
      enrollment_id: row.id,
      checked_in_at: existing?.checked_in_at,
      ...person,
    };
  };

  // Fast path for the common repeat scan. Not a guarantee on its own: two
  // desks scanning the same badge can both pass it — the unique
  // (enrollment_id, check_in_date, session) constraint settles that race below.
  const { data: existing } = await supabase
    .from("check_ins")
    .select("id")
    .eq("enrollment_id", row.id)
    .eq("check_in_date", checkInDate)
    .eq("session", session)
    .maybeSingle();
  if (existing) return duplicate();

  const unpaidOverride = !paid;
  const { data: inserted, error: insertErr } = await supabase
    .from("check_ins")
    .insert({
      event_id: eventId,
      enrollment_id: row.id,
      participant_id: row.participant_id,
      checked_in_by: actorId,
      check_in_date: checkInDate,
      session,
      is_test: isTest,
      unpaid_override: unpaidOverride,
      method,
      notes: notes?.trim() || null,
    })
    .select("id, checked_in_at")
    .single();
  if (insertErr) {
    // Lost the race to another desk — that's "already checked in", not a 500.
    if (insertErr.code === "23505") return duplicate();
    throw new Error(insertErr.message);
  }

  const person = await loadPerson(supabase, eventId, row.participant_id);

  await writeAuditLog({
    actor_id: actorId,
    action:
      method === "qr"
        ? "check_in.qr"
        : method === "face_match"
          ? "check_in.face_match"
          : "check_in.manual",
    entity: "check_ins",
    entity_id: inserted.id,
    metadata: {
      event_id: eventId,
      enrollment_id: row.id,
      participant_id: row.participant_id,
      check_in_date: checkInDate,
      session,
      ...(isTest ? { is_test: true } : {}),
      ...(unpaidOverride ? { unpaid_override: true, enrollment_status: row.status } : {}),
    },
  });

  return {
    ok: true,
    check_in: {
      id: inserted.id,
      enrollment_id: row.id,
      participant_id: row.participant_id,
      checked_in_at: inserted.checked_in_at,
      check_in_date: checkInDate,
      session,
      method,
      unpaid_override: unpaidOverride,
    },
    ...person,
  };
}

// Badge token or picked enrollment → the enrollment row, checked to belong to
// this event.
async function resolveEnrollment(
  supabase: SupabaseClient,
  eventId: string,
  qrToken: string | null | undefined,
  enrollmentId: string | null | undefined,
): Promise<{ row: EnrollmentRow } | { error: "not_found" | "wrong_event" | "invalid_token" }> {
  let row: EnrollmentRow | null = null;
  if (qrToken) {
    const { data, error } = await supabase
      .from("enrollments")
      .select("id, event_id, participant_id, status, payment_status, qr_token")
      .eq("qr_token", qrToken)
      .maybeSingle();
    if (error) throw new Error(error.message);
    row = data;
    if (row && !verifyQrToken(row.id, qrToken)) return { error: "invalid_token" };
  } else if (enrollmentId) {
    const { data, error } = await supabase
      .from("enrollments")
      .select("id, event_id, participant_id, status, payment_status, qr_token")
      .eq("id", enrollmentId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    row = data;
  }
  if (!row) return { error: "not_found" };
  if (row.event_id !== eventId) return { error: "wrong_event" };
  return { row };
}

// Name + group/table/seat — what the desk needs on screen to hand over the
// right badge from the right pile.
async function loadPerson(
  supabase: SupabaseClient,
  eventId: string,
  participantId: string,
): Promise<CheckInPerson> {
  const [{ data: participant }, { data: seat }] = await Promise.all([
    supabase
      .from("participants")
      .select("id, region_id, name_cn, name_en")
      .eq("id", participantId)
      .maybeSingle(),
    supabase
      .from("event_seat_assignments")
      .select(
        "seat_no, group_id, event_groups!inner(group_no, event_floor_plan_shapes(table_no))",
      )
      .eq("event_id", eventId)
      .eq("participant_id", participantId)
      .maybeSingle(),
  ]);

  const seatGroup =
    (
      seat as unknown as {
        event_groups?: {
          group_no: number | null;
          event_floor_plan_shapes?:
            | { table_no: number | null }[]
            | { table_no: number | null }
            | null;
        } | null;
      } | null
    )?.event_groups ?? null;

  // A reverse (one-to-many) embed normally arrives as an array, but PostgREST
  // collapses it to a single object when it can prove cardinality — accept both
  // rather than letting a shape change here 500 a door scan.
  const seatShapes = seatGroup?.event_floor_plan_shapes;
  const tableNo =
    (Array.isArray(seatShapes)
      ? seatShapes.find((sh) => sh?.table_no != null)?.table_no
      : seatShapes?.table_no) ?? null;

  return {
    participant: {
      id: participant?.id ?? participantId,
      region_id: participant?.region_id ?? null,
      name_cn: participant?.name_cn ?? null,
      name_en: participant?.name_en ?? null,
    },
    group_no: seatGroup?.group_no ?? null,
    table_no: tableNo,
    seat_no: (seat as { seat_no?: number | null } | null)?.seat_no ?? null,
  };
}

// Undo a check-in (admin clicked "Mark as not arrived"). Service-role only.
export async function undoCheckIn({
  checkInId,
  eventId,
  actorId,
}: {
  checkInId: string;
  eventId: string;
  actorId: string;
}): Promise<{ ok: true } | { ok: false; error: "not_found" }> {
  const supabase = createSupabaseServiceClient();
  const { data: existing, error } = await supabase
    .from("check_ins")
    .select("id, event_id, enrollment_id, participant_id, check_in_date, session")
    .eq("id", checkInId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!existing || existing.event_id !== eventId) {
    return { ok: false, error: "not_found" };
  }

  const { error: delErr } = await supabase
    .from("check_ins")
    .delete()
    .eq("id", checkInId);
  if (delErr) throw new Error(delErr.message);

  await writeAuditLog({
    actor_id: actorId,
    action: "check_in.undone",
    entity: "check_ins",
    entity_id: checkInId,
    metadata: {
      event_id: eventId,
      enrollment_id: existing.enrollment_id,
      participant_id: existing.participant_id,
      check_in_date: existing.check_in_date,
      session: existing.session,
    },
  });

  return { ok: true };
}
