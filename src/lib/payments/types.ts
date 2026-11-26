// Client-safe types + labels for the payments ledger (migration 087).

export type PaymentMethod =
  | "card_pos"
  | "cash"
  | "bank_transfer"
  | "paynow"
  | "hitpay_online"
  | "tt"
  | "other";

export const PAYMENT_METHODS: ReadonlyArray<{ value: PaymentMethod; en: string; cn: string }> = [
  { value: "card_pos", en: "Card (terminal)", cn: "刷卡" },
  { value: "cash", en: "Cash", cn: "现金" },
  { value: "paynow", en: "PayNow", cn: "PayNow" },
  { value: "bank_transfer", en: "Bank transfer", cn: "银行转账" },
  { value: "tt", en: "Telegraphic transfer", cn: "电汇" },
  { value: "hitpay_online", en: "HitPay online", cn: "HitPay 在线" },
  { value: "other", en: "Other", cn: "其他" },
];

/** Methods staff can pick by hand (HitPay online is written by the webhook). */
export const MANUAL_METHODS = PAYMENT_METHODS.filter((m) => m.value !== "hitpay_online");

export function methodLabel(m: string): string {
  const hit = PAYMENT_METHODS.find((x) => x.value === m);
  return hit ? `${hit.en} · ${hit.cn}` : m;
}

/** What the enrolment row's legacy payment_method enum should say. */
export function enrollmentMethodFor(m: PaymentMethod): string | null {
  switch (m) {
    case "card_pos":
      return "card";
    case "cash":
      return "cash";
    case "bank_transfer":
    case "paynow":
      return "bank_transfer";
    case "tt":
      return "tt";
    case "hitpay_online":
      return "hitpay";
    default:
      return null;
  }
}

export type PurchaseKind = "new" | "upgrade" | "other";
export const PURCHASE_KINDS: ReadonlyArray<{ value: PurchaseKind; en: string; cn: string }> = [
  { value: "new", en: "New purchase", cn: "新购" },
  { value: "upgrade", en: "Upgrade", cn: "升级补差价" },
  { value: "other", en: "Other", cn: "其他" },
];

export type ScheduleRow = {
  id?: string;
  label: string;
  /** YYYY-MM-DD, or null = no fixed date. */
  due_on: string | null;
  amount_sgd: number;
  sort: number;
};

export type PaymentRow = {
  id: string;
  participant_id: string;
  purchase_id: string | null;
  enrollment_id: string | null;
  amount: number;
  currency: "SGD" | "MYR";
  fx_rate: number | null;
  amount_sgd: number;
  method: PaymentMethod;
  paid_on: string;
  reference: string | null;
  counter_batch: string | null;
  event_id: string | null;
  note: string | null;
  recorded_by: string | null;
  recorded_by_name?: string | null;
  created_at: string;
  voided_at: string | null;
  void_reason: string | null;
};

export type TemplateItem = {
  id?: string;
  label: string;
  amount_sgd: number;
  /** Months after the registration date; 0 = on the day. */
  due_after_months: number;
  sort: number;
};

export type PaymentTemplate = {
  id: string;
  name: string;
  programme_id: string | null;
  kind: PurchaseKind;
  total_sgd: number;
  note: string | null;
  active: boolean;
  items: TemplateItem[];
};

export type StandingState = "unpaid" | "partial" | "complete" | "behind" | "cancelled";

export type Standing = {
  total: number;
  paid: number;
  balance: number;
  /** Sum of schedule rows whose date has passed (strictly before today). */
  due_so_far: number;
  behind: number;
  next: { label: string; due_on: string | null; remaining: number } | null;
  state: StandingState;
};

export type PurchaseView = {
  id: string;
  participant_id: string;
  programme_id: string | null;
  programme_name: string | null;
  template_id: string | null;
  title: string;
  kind: PurchaseKind;
  total_sgd: number;
  registered_on: string;
  status: "active" | "completed" | "cancelled";
  event_id: string | null;
  note: string | null;
  created_at: string;
  cancel_reason: string | null;
  schedule: ScheduleRow[];
  payments: PaymentRow[];
  standing: Standing;
};

export const STATE_LABEL: Record<StandingState, { en: string; cn: string }> = {
  unpaid: { en: "Unpaid", cn: "未付" },
  partial: { en: "Paying in instalments", cn: "分期中" },
  complete: { en: "Paid in full", cn: "完款" },
  behind: { en: "Behind", cn: "逾期" },
  cancelled: { en: "Cancelled", cn: "已取消" },
};

export function sgd(n: number): string {
  return `SGD ${n.toLocaleString("en-SG", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
