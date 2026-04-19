// Enrollment state-machine helpers. Pure functions — safe to import from both
// server and client code.
//
// The DB carries three somewhat-overlapping columns (`status`,
// `payment_status`, `confirmed_at`). Business logic reads everything through
// `deriveJourneyStage()` so the UI and APIs never have to check all three
// fields independently.

import type {
  EnrollmentStatus,
  PaymentStatus,
} from "./enrollments-shared";

export type JourneyStage =
  | "registered"         // just submitted, not yet confirmed, pending approval
  | "info_confirmed"     // clicked /confirm link, still pending approval
  | "approved_unpaid"    // admin approved, awaiting payment
  | "paid"               // payment recorded (manual or webhook)
  | "rejected"
  | "cancelled";

export type EnrollmentAction =
  | "approve"
  | "reject"
  | "cancel"
  | "mark_paid"
  | "mark_unpaid";

export type EnrollmentJourneyInput = {
  status: EnrollmentStatus;
  payment_status: PaymentStatus;
  confirmed_at: string | null;
};

export function deriveJourneyStage(
  e: EnrollmentJourneyInput,
): JourneyStage {
  if (e.status === "rejected") return "rejected";
  if (e.status === "cancelled") return "cancelled";
  if (e.status === "paid" || e.payment_status === "paid") return "paid";
  if (e.status === "approved") return "approved_unpaid";
  // pending_approval — differentiate by whether participant has clicked /confirm
  return e.confirmed_at ? "info_confirmed" : "registered";
}

export const JOURNEY_LABEL: Record<JourneyStage, { en: string; zh: string }> = {
  registered: { en: "Registered", zh: "已报名" },
  info_confirmed: { en: "Info confirmed", zh: "信息已核对" },
  approved_unpaid: { en: "Approved · awaiting payment", zh: "已批准 · 待付款" },
  paid: { en: "Paid", zh: "已付款" },
  rejected: { en: "Rejected", zh: "已拒绝" },
  cancelled: { en: "Cancelled", zh: "已取消" },
};

// Colour tone key — consumed by the table to pick chip styling. Values are
// intentionally generic (not Tailwind classes) so callers can map to their
// own palette.
export const JOURNEY_TONE: Record<JourneyStage, "neutral" | "info" | "warn" | "go" | "done" | "danger"> = {
  registered: "neutral",
  info_confirmed: "info",
  approved_unpaid: "warn",
  paid: "done",
  rejected: "danger",
  cancelled: "neutral",
};

// Given a current row and a requested admin action, return whether the
// transition is legal. Used by both the bulk and per-row API routes *and*
// the table to grey out illegal menu items.
export function canTransition(
  current: EnrollmentStatus,
  action: EnrollmentAction,
): { ok: true } | { ok: false; reason: string } {
  switch (action) {
    case "approve":
      if (current === "approved") return { ok: false, reason: "already_approved" };
      if (current === "paid") return { ok: false, reason: "already_paid" };
      if (current === "cancelled") return { ok: false, reason: "cancelled_cannot_approve" };
      return { ok: true };
    case "reject":
      if (current === "paid") return { ok: false, reason: "cannot_reject_paid" };
      if (current === "rejected") return { ok: false, reason: "already_rejected" };
      return { ok: true };
    case "cancel":
      if (current === "cancelled") return { ok: false, reason: "already_cancelled" };
      if (current === "paid") return { ok: false, reason: "cannot_cancel_paid" };
      return { ok: true };
    case "mark_paid":
      if (current === "paid") return { ok: false, reason: "already_paid" };
      if (current !== "approved") return { ok: false, reason: "must_be_approved_first" };
      return { ok: true };
    case "mark_unpaid":
      if (current !== "paid") return { ok: false, reason: "not_currently_paid" };
      return { ok: true };
  }
}

// Participant-facing failure reasons. Admin UI surfaces them inline.
export const TRANSITION_REASON_LABEL: Record<string, { en: string; zh: string }> = {
  already_approved: { en: "Already approved", zh: "已批准" },
  already_paid: { en: "Already paid", zh: "已付款" },
  already_rejected: { en: "Already rejected", zh: "已拒绝" },
  already_cancelled: { en: "Already cancelled", zh: "已取消" },
  cancelled_cannot_approve: { en: "Cancelled enrolments can't be approved", zh: "已取消的报名无法批准" },
  cannot_reject_paid: { en: "Can't reject a paid enrolment — cancel instead", zh: "已付款的无法拒绝，请改为取消" },
  cannot_cancel_paid: { en: "Can't cancel a paid enrolment", zh: "已付款的无法取消" },
  must_be_approved_first: { en: "Approve before marking paid", zh: "请先批准再标记付款" },
  not_currently_paid: { en: "This isn't marked paid", zh: "当前未标记已付款" },
};

// Reverse mapping: what new status each action resolves to (server-side only).
export const ACTION_NEXT_STATUS: Record<EnrollmentAction, EnrollmentStatus> = {
  approve: "approved",
  reject: "rejected",
  cancel: "cancelled",
  mark_paid: "paid",
  mark_unpaid: "approved",
};
