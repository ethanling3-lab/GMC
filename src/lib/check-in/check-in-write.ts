import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "../supabase";
import { writeAuditLog } from "../audit";
import { verifyQrToken } from "./qr-token";
import { isPaidEnrollment, type CheckInMethod, type CheckInPerson } from "./types";
import { EVENT_TZ } from "./day";
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
  /** One-scanner flow: a repeat scan is usually "going out", not a mistake. */
  auditDuplicate?: boolean;
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
    const isRepeat =
      !!existing && Date.now() - Date.parse(existing.checked_in_at) < REPEAT_GUARD_MS;
    if (args.auditDuplicate !== false || isRepeat) {
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
    }
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
// this event. Shared by check-in and out/back scans.
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

// --- Out of class (课堂外出) --------------------------------------------------

// A scan toggles a checked-in person out / back. One open exit per
// enrollment (partial unique index on class_exits) makes two desks scanning
// the same badge settle on a single "out".
//
// A badge held in front of the camera gets read again as soon as the
// cooldown ends, so a QR scan within REPEAT_GUARD_MS of the last toggle is
// "already out / already back", never a flip. The manual list sends an
// explicit intent instead and skips the guard.

const REPEAT_GUARD_MS = 60_000;

export type ClassScanAction = "out" | "back" | "already_out" | "already_back";

export type ClassScanResult =
  | ({
      ok: true;
      action: ClassScanAction;
      enrollment_id: string;
      exit: {
        id: string;
        out_at: string;
        back_at: string | null;
        /** Whole minutes away, once back. */
        minutes: number | null;
      };
      /** Not checked in for this session when they walked out. */
      not_checked_in: boolean;
    } & CheckInPerson)
  | ({
      ok: false;
      error: "not_found" | "wrong_event" | "invalid_token" | "not_eligible";
      enrollment_id?: string;
    } & Partial<CheckInPerson>);

type ExitRow = {
  id: string;
  exit_date: string;
  session: Session;
  out_at: string;
  back_at: string | null;
  not_checked_in: boolean;
};

const EXIT_COLUMNS = "id, exit_date, session, out_at, back_at, not_checked_in";

export function minutesBetween(fromIso: string, toIso: string): number {
  return Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000));
}

export async function performClassScan(args: {
  eventId: string;
  actorId: string;
  day: string;
  session: Session;
  isTest: boolean;
  qrToken?: string | null;
  enrollmentId?: string | null;
  /** Manual list: what the desk pressed. QR scans toggle. */
  intent?: "out" | "back";
}): Promise<ClassScanResult> {
  const { eventId, actorId, day, session, isTest, intent } = args;
  const supabase = createSupabaseServiceClient();

  const resolved = await resolveEnrollment(supabase, eventId, args.qrToken, args.enrollmentId);
  if ("error" in resolved) return { ok: false, error: resolved.error };
  const row = resolved.row;

  // Anyone the desk could check in can be logged out; pending / cancelled
  // people shouldn't be in the room at all.
  if (!isPaidEnrollment(row) && row.status !== "approved") {
    return { ok: false, error: "not_eligible", enrollment_id: row.id };
  }

  const now = new Date().toISOString();
  const [person, { data: open, error: openErr }] = await Promise.all([
    loadPerson(supabase, eventId, row.participant_id),
    supabase
      .from("class_exits")
      .select(EXIT_COLUMNS)
      .eq("enrollment_id", row.id)
      .is("back_at", null)
      .maybeSingle(),
  ]);
  if (openErr) throw new Error(openErr.message);

  const result = (
    action: ClassScanAction,
    exit: ExitRow,
    notCheckedIn: boolean,
  ): ClassScanResult => ({
    ok: true,
    action,
    enrollment_id: row.id,
    exit: {
      id: exit.id,
      out_at: exit.out_at,
      back_at: exit.back_at,
      minutes: exit.back_at ? minutesBetween(exit.out_at, exit.back_at) : null,
    },
    not_checked_in: notCheckedIn,
    ...person,
  });

  let openExit = open as ExitRow | null;

  // An exit left open from an earlier session (nobody switched session
  // since) can't be "back" now — close it as no-return and start fresh.
  if (openExit && (openExit.exit_date !== day || openExit.session !== session)) {
    await closeExit(supabase, openExit, "session_ended", null, endOfDay(openExit.exit_date, now));
    openExit = null;
  }

  if (openExit) {
    if (intent === "out") return result("already_out", openExit, openExit.not_checked_in);
    if (!intent && Date.parse(now) - Date.parse(openExit.out_at) < REPEAT_GUARD_MS) {
      return result("already_out", openExit, openExit.not_checked_in);
    }
    const closed = await closeExit(supabase, openExit, "scanned_back", actorId, now);
    // Another desk logged them back a moment ago.
    if (!closed) return result("already_back", { ...openExit, back_at: now }, false);
    await writeAuditLog({
      actor_id: actorId,
      action: "class_exit.back",
      entity: "class_exits",
      entity_id: openExit.id,
      metadata: {
        event_id: eventId,
        enrollment_id: row.id,
        exit_date: day,
        session,
        minutes: minutesBetween(openExit.out_at, now),
      },
    });
    return result("back", { ...openExit, back_at: now }, openExit.not_checked_in);
  }

  // Not out. A "back" press, or a QR re-read right after coming back, is a
  // no-op rather than a fresh exit.
  if (intent === "back" || !intent) {
    const { data: last } = await supabase
      .from("class_exits")
      .select(EXIT_COLUMNS)
      .eq("enrollment_id", row.id)
      .eq("exit_date", day)
      .eq("session", session)
      .not("back_at", "is", null)
      .order("back_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const lastExit = last as ExitRow | null;
    if (intent === "back") {
      if (lastExit) return result("already_back", lastExit, false);
      // Never went out — nothing to close. Report as back with no trip.
      return {
        ok: true,
        action: "already_back",
        enrollment_id: row.id,
        exit: { id: "", out_at: now, back_at: now, minutes: null },
        not_checked_in: false,
        ...person,
      };
    }
    if (lastExit?.back_at && Date.parse(now) - Date.parse(lastExit.back_at) < REPEAT_GUARD_MS) {
      return result("already_back", lastExit, false);
    }
  }

  const { data: checkIn } = await supabase
    .from("check_ins")
    .select("id")
    .eq("enrollment_id", row.id)
    .eq("check_in_date", day)
    .eq("session", session)
    .maybeSingle();
  const notCheckedIn = !checkIn;

  const { data: inserted, error: insErr } = await supabase
    .from("class_exits")
    .insert({
      event_id: eventId,
      enrollment_id: row.id,
      participant_id: row.participant_id,
      exit_date: day,
      session,
      out_at: now,
      out_by: actorId,
      not_checked_in: notCheckedIn,
      is_test: isTest,
    })
    .select(EXIT_COLUMNS)
    .single();
  if (insErr) {
    // Another desk logged them out in the same instant — show that exit.
    if (insErr.code === "23505") {
      const { data: theirs } = await supabase
        .from("class_exits")
        .select(EXIT_COLUMNS)
        .eq("enrollment_id", row.id)
        .is("back_at", null)
        .maybeSingle();
      if (theirs) {
        const t = theirs as ExitRow;
        return result("already_out", t, t.not_checked_in);
      }
    }
    throw new Error(insErr.message);
  }

  await writeAuditLog({
    actor_id: actorId,
    action: "class_exit.out",
    entity: "class_exits",
    entity_id: (inserted as ExitRow).id,
    metadata: {
      event_id: eventId,
      enrollment_id: row.id,
      exit_date: day,
      session,
      ...(notCheckedIn ? { not_checked_in: true } : {}),
      ...(isTest ? { is_test: true } : {}),
    },
  });

  return result("out", inserted as ExitRow, notCheckedIn);
}

// The desk's one scanner: what a badge scan does depends on the person.
//   out of class now              → back
//   not checked in this session   → check in
//   checked in a minute+ ago      → out
//   checked in under a minute ago → "already checked in" (the same badge
//                                   still in front of the camera)
export async function performDeskScan(
  args: WriteArgs,
): Promise<{ type: "check_in"; result: CheckInResult } | { type: "class"; result: ClassScanResult }> {
  const { eventId, actorId, checkInDate: day, session, isTest, qrToken, enrollmentId } = args;
  const classScan = async () => ({
    type: "class" as const,
    result: await performClassScan({ eventId, actorId, day, session, isTest, qrToken, enrollmentId }),
  });

  const supabase = createSupabaseServiceClient();
  const resolved = await resolveEnrollment(supabase, eventId, qrToken, enrollmentId);
  if ("error" in resolved) {
    return { type: "check_in", result: { ok: false, error: resolved.error } };
  }
  const { data: open, error } = await supabase
    .from("class_exits")
    .select("id")
    .eq("enrollment_id", resolved.row.id)
    .eq("exit_date", day)
    .eq("session", session)
    .is("back_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (open) return classScan();

  const result = await performCheckIn({ ...args, auditDuplicate: false });
  if (
    !result.ok &&
    result.error === "already_checked_in" &&
    result.checked_in_at &&
    Date.now() - Date.parse(result.checked_in_at) >= REPEAT_GUARD_MS
  ) {
    return classScan();
  }
  return { type: "check_in", result };
}

// Close one open exit. Returns false when it was already closed (another
// desk got there first) — the `back_at is null` filter makes it a no-op.
async function closeExit(
  supabase: SupabaseClient,
  exit: Pick<ExitRow, "id">,
  reason: "scanned_back" | "session_ended",
  actorId: string | null,
  backAt: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("class_exits")
    .update({ back_at: backAt, closed_reason: reason, back_by: actorId })
    .eq("id", exit.id)
    .is("back_at", null)
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

// Last moment of an event-local day, capped at `now`. An exit forgotten
// overnight shouldn't count the night as time out of class.
function endOfDay(day: string, now: string): string {
  const offset = EVENT_TZ === "Asia/Singapore" ? "+08:00" : "Z";
  const end = new Date(`${day}T23:59:59${offset}`).toISOString();
  return end < now ? end : now;
}

/**
 * Close every open exit for the event as "didn't scan back" — the organizer
 * moved to the next session while these people were still out. Returns how many.
 */
export async function closeOpenExits(eventId: string, actorId: string): Promise<number> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("class_exits")
    .select("id, exit_date")
    .eq("event_id", eventId)
    .is("back_at", null);
  if (error) throw new Error(error.message);
  const now = new Date().toISOString();
  let closed = 0;
  for (const e of (data ?? []) as Array<{ id: string; exit_date: string }>) {
    if (await closeExit(supabase, e, "session_ended", actorId, endOfDay(e.exit_date, now))) {
      closed += 1;
    }
  }
  return closed;
}
