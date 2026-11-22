// Shared types for the M7.1 on-site check-in flow. Server + client safe.

import type { CheckInMode, Session } from "./mode";

export type CheckInMethod = "qr" | "manual" | "face_match";

// The expected list is PAID attendees — the same rule the badge PDF and the
// QR-bearing emails use. status and payment_status can diverge (payment
// reconciled first, or vice versa), so either counts; a later cancel/reject
// wins over an old payment.
export function isPaidEnrollment(e: { status: string; payment_status: string }): boolean {
  if (e.status === "cancelled" || e.status === "rejected") return false;
  return e.status === "paid" || e.payment_status === "paid";
}

// PostgREST filter for the same rule, for `.or(...)` + `.not(...)` queries.
export const PAID_OR_FILTER = "status.eq.paid,payment_status.eq.paid";
export const NOT_CANCELLED_FILTER = "(cancelled,rejected)";

/** Who a scan resolved to — enough for the desk to hand over the right badge. */
export type CheckInPerson = {
  participant: {
    id: string;
    region_id: string | null;
    name_cn: string | null;
    name_en: string | null;
  };
  group_no: number | null;
  table_no: number | null;
  seat_no: number | null;
};

export type CheckInRow = {
  id: string;
  event_id: string;
  enrollment_id: string;
  participant_id: string;
  checked_in_at: string;
  checked_in_by: string | null;
  method: CheckInMethod;
  notes: string | null;
};

export type CheckInRosterEntry = {
  enrollment_id: string;
  participant_id: string;
  region_id: string | null;
  name_cn: string | null;
  name_en: string | null;
  phone: string | null;
  email: string | null;
  group_no: number | null;
  // Table the group sits at — the number the UI displays. Null when the group
  // isn't seated yet (then group_no shows instead). See src/lib/group-number.ts.
  table_no: number | null;
  seat_no: number | null;
  checked_in_at: string | null;
  check_in_method: CheckInMethod | null;
};

export type CheckInStats = {
  /** The day these numbers are for (YYYY-MM-DD, event-local). */
  day: string;
  /** Morning or Afternoon registration. */
  session: Session;
  /** Paid attendees, plus anyone checked in on an unpaid override that day. */
  total_eligible: number;
  total_checked_in: number;
  /** Of total_checked_in: approved-but-unpaid people let in by the desk. */
  unpaid_overrides: number;
  by_method: { qr: number; manual: number; face_match: number };
};

export type CheckInRecent = {
  enrollment_id: string;
  participant_id: string;
  region_id: string | null;
  name_cn: string | null;
  name_en: string | null;
  group_no: number | null;
  table_no: number | null;
  checked_in_at: string;
  method: CheckInMethod;
  unpaid_override: boolean;
};

// --- M7.1b richer dashboard --------------------------------------------------

// Sentinel id for the synthetic "Ungrouped" bucket the roster appends so
// paid attendees without a seat assignment stay visible. It is not an
// event_groups row, so anything counting real groups must exclude it.
export const UNGROUPED_GROUP_ID = "__ungrouped";

export type CheckInGroupRow = {
  group_id: string;
  group_no: number | null;          // null = "Ungrouped" synthetic bucket
  table_no: number | null;
  group_class: string | null;
  name_en: string | null;
  name_cn: string | null;
  expected_count: number;
  checked_in_count: number;
};

export type CheckInAbsentRow = {
  enrollment_id: string;
  participant_id: string;
  region_id: string | null;
  name_cn: string | null;
  name_en: string | null;
  phone: string | null;
  group_no: number | null;
  table_no: number | null;
};

// --- Sessions -----------------------------------------------------------------

/** Arrived / expected for each registration of the day — the headcount row. */
export type SessionCounts = Record<Session, { arrived: number; expected: number }>;

/** The event's live desk state, polled by every desk. */
export type DeskState = {
  /** Today, event-local — the only day a desk writes to. */
  today: string;
  mode: CheckInMode;
  testMode: boolean;
  /** Today isn't an event date and test mode is off: desks can't scan. */
  locked: boolean;
  modeSetAt: string | null;
};

/** Someone out of class right now. */
export type OutNowRow = {
  exit_id: string;
  enrollment_id: string;
  region_id: string | null;
  name_cn: string | null;
  name_en: string | null;
  group_no: number | null;
  table_no: number | null;
  session: Session;
  out_at: string;
  not_checked_in: boolean;
};

/** One person's out-of-class record for a day. Open trips count up to now. */
export type ExitTotalRow = {
  enrollment_id: string;
  region_id: string | null;
  name_cn: string | null;
  name_en: string | null;
  group_no: number | null;
  table_no: number | null;
  trips: number;
  total_minutes: number;
  longest_minutes: number;
  /** Trips closed because the session moved on before they scanned back. */
  no_return: number;
  still_out: boolean;
};
