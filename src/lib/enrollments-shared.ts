// Shared types + labels for enrollments — used on both server and client.

export type EnrollmentStatus =
  | "pending_approval"
  | "approved"
  | "rejected"
  | "paid"
  | "cancelled";

export type PaymentStatus =
  | "none"
  | "pending"
  | "paid"
  | "failed"
  | "refunded";

export type PaymentMethod = "hitpay" | "stripe" | "bank_transfer" | "tt";

export const ENROLLMENT_STATUS_LABEL: Record<
  EnrollmentStatus,
  { en: string; zh: string }
> = {
  pending_approval: { en: "Pending approval", zh: "待审核" },
  approved: { en: "Approved", zh: "已批准" },
  rejected: { en: "Rejected", zh: "已拒绝" },
  paid: { en: "Paid", zh: "已付款" },
  cancelled: { en: "Cancelled", zh: "已取消" },
};

export const PAYMENT_STATUS_LABEL: Record<
  PaymentStatus,
  { en: string; zh: string }
> = {
  none: { en: "—", zh: "—" },
  pending: { en: "Pending", zh: "待处理" },
  paid: { en: "Paid", zh: "已付" },
  failed: { en: "Failed", zh: "失败" },
  refunded: { en: "Refunded", zh: "已退款" },
};

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  hitpay: "HitPay",
  stripe: "Stripe",
  bank_transfer: "Bank transfer",
  tt: "TT",
};
