import "server-only";
import { createSupabaseServiceClient } from "../supabase";
import { writeAuditLog } from "../audit";
import { verifyQrToken } from "./qr-token";
import type { CheckInMethod } from "./types";

export type CheckInResult =
  | {
      ok: true;
      check_in: {
        id: string;
        enrollment_id: string;
        participant_id: string;
        checked_in_at: string;
        method: CheckInMethod;
      };
      participant: {
        id: string;
        region_id: string | null;
        name_cn: string | null;
        name_en: string | null;
      };
      group_no: number | null;
      seat_no: number | null;
    }
  | { ok: false; error: CheckInError };

export type CheckInError =
  | "not_found"
  | "wrong_event"
  | "not_eligible"
  | "already_checked_in"
  | "invalid_token";

// Performs a check-in for either a scanned QR token or a manually selected
// enrollment. The caller (POST /api/admin/events/[id]/check-in) is
// responsible for role gating; this helper just handles the data + audit
// write inside the service-role transaction.

type WriteArgs = {
  eventId: string;
  actorId: string;
  method: CheckInMethod;
  qrToken?: string | null;
  enrollmentId?: string | null;
  notes?: string | null;
};

export async function performCheckIn(args: WriteArgs): Promise<CheckInResult> {
  const { eventId, actorId, method, qrToken, enrollmentId, notes } = args;
  const supabase = createSupabaseServiceClient();

  // Resolve the enrollment from either a scanned token or a manual id.
  let row: {
    id: string;
    event_id: string;
    participant_id: string;
    status: string;
    payment_status: string;
    qr_token: string | null;
  } | null = null;

  if (qrToken) {
    const { data, error } = await supabase
      .from("enrollments")
      .select("id, event_id, participant_id, status, payment_status, qr_token")
      .eq("qr_token", qrToken)
      .maybeSingle();
    if (error) throw new Error(error.message);
    row = data;
    if (row && !verifyQrToken(row.id, qrToken)) {
      return { ok: false, error: "invalid_token" };
    }
  } else if (enrollmentId) {
    const { data, error } = await supabase
      .from("enrollments")
      .select("id, event_id, participant_id, status, payment_status, qr_token")
      .eq("id", enrollmentId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    row = data;
  }

  if (!row) return { ok: false, error: "not_found" };
  if (row.event_id !== eventId) return { ok: false, error: "wrong_event" };

  // Only approved + paid enrollments are eligible for check-in. We accept
  // either state — payment may be reconciled after the event for VIPs etc.
  const eligible =
    row.status === "approved" ||
    row.status === "paid" ||
    row.payment_status === "paid";
  if (!eligible) return { ok: false, error: "not_eligible" };

  // Idempotent: if a check-in already exists, surface it instead of
  // creating a duplicate (the table has unique(enrollment_id) anyway).
  const { data: existing } = await supabase
    .from("check_ins")
    .select("id, checked_in_at, method")
    .eq("enrollment_id", row.id)
    .maybeSingle();
  if (existing) {
    await writeAuditLog({
      actor_id: actorId,
      action: "check_in.duplicate_attempt",
      entity: "check_ins",
      entity_id: existing.id,
      metadata: { event_id: eventId, method, attempted_via: qrToken ? "qr" : "manual" },
    });
    return { ok: false, error: "already_checked_in" };
  }

  const { data: inserted, error: insertErr } = await supabase
    .from("check_ins")
    .insert({
      event_id: eventId,
      enrollment_id: row.id,
      participant_id: row.participant_id,
      checked_in_by: actorId,
      method,
      notes: notes?.trim() || null,
    })
    .select("id, checked_in_at")
    .single();
  if (insertErr) throw new Error(insertErr.message);

  // Look up the participant + their seat assignment so the scanner can show
  // a meaningful success card (group / seat for the staff to direct guests).
  const [{ data: participant }, { data: seat }] = await Promise.all([
    supabase
      .from("participants")
      .select("id, region_id, name_cn, name_en")
      .eq("id", row.participant_id)
      .maybeSingle(),
    supabase
      .from("event_seat_assignments")
      .select("seat_no, event_groups!inner(group_no)")
      .eq("event_id", eventId)
      .eq("participant_id", row.participant_id)
      .maybeSingle(),
  ]);

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
    },
  });

  return {
    ok: true,
    check_in: {
      id: inserted.id,
      enrollment_id: row.id,
      participant_id: row.participant_id,
      checked_in_at: inserted.checked_in_at,
      method,
    },
    participant: {
      id: participant?.id ?? row.participant_id,
      region_id: participant?.region_id ?? null,
      name_cn: participant?.name_cn ?? null,
      name_en: participant?.name_en ?? null,
    },
    group_no:
      ((seat as unknown as { event_groups?: { group_no: number | null } } | null)
        ?.event_groups?.group_no) ?? null,
    seat_no: seat?.seat_no ?? null,
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
    .select("id, event_id, enrollment_id, participant_id")
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
    },
  });

  return { ok: true };
}
