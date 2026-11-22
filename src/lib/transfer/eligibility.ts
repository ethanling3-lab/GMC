// Who gets an airport transfer: approved or paid. status and payment_status can
// diverge (a payment can be reconciled before approval), so either counts, and
// a later cancel/reject wins over an old payment. Pure, safe for client imports.

export function isTransferEligible(e: {
  status: string;
  payment_status: string;
}): boolean {
  if (e.status === "cancelled" || e.status === "rejected") return false;
  return (
    e.status === "approved" || e.status === "paid" || e.payment_status === "paid"
  );
}

// PostgREST form of the same rule. Apply both:
//   .or(TRANSFER_ELIGIBLE_OR).not("status", "in", TRANSFER_EXCLUDED_STATUSES)
export const TRANSFER_ELIGIBLE_OR = "status.in.(approved,paid),payment_status.eq.paid";
export const TRANSFER_EXCLUDED_STATUSES = "(cancelled,rejected)";
