import "server-only";
import type { createSupabaseServiceClient } from "@/lib/supabase";
import { sgDay } from "@/lib/pricing/tiers";
import { computeStanding, addMonthsDay } from "./standing";
import type {
  PaymentMethod,
  PaymentRow,
  PaymentTemplate,
  PurchaseKind,
  PurchaseView,
  ScheduleRow,
} from "./types";

// Payments ledger + programme purchases (migration 087). Server-only; every
// caller has already checked the role. Writes are not wrapped in a DB
// transaction, so callers validate everything BEFORE the first write.

type Service = ReturnType<typeof createSupabaseServiceClient>;

const PAYMENT_COLS =
  "id, participant_id, purchase_id, enrollment_id, amount, currency, fx_rate, amount_sgd, method, paid_on, reference, counter_batch, event_id, note, recorded_by, created_at, voided_at, void_reason";

const num = (v: unknown) => (v == null ? 0 : Number(v));

function toPayment(r: Record<string, unknown>, names: Map<string, string>): PaymentRow {
  return {
    id: r.id as string,
    participant_id: r.participant_id as string,
    purchase_id: (r.purchase_id as string | null) ?? null,
    enrollment_id: (r.enrollment_id as string | null) ?? null,
    amount: num(r.amount),
    currency: (r.currency as "SGD" | "MYR") ?? "SGD",
    fx_rate: r.fx_rate == null ? null : Number(r.fx_rate),
    amount_sgd: num(r.amount_sgd),
    method: r.method as PaymentMethod,
    paid_on: r.paid_on as string,
    reference: (r.reference as string | null) ?? null,
    counter_batch: (r.counter_batch as string | null) ?? null,
    event_id: (r.event_id as string | null) ?? null,
    note: (r.note as string | null) ?? null,
    recorded_by: (r.recorded_by as string | null) ?? null,
    recorded_by_name: r.recorded_by ? names.get(r.recorded_by as string) ?? null : null,
    created_at: r.created_at as string,
    voided_at: (r.voided_at as string | null) ?? null,
    void_reason: (r.void_reason as string | null) ?? null,
  };
}

async function adminNames(service: Service, ids: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (uniq.length === 0) return new Map();
  const { data } = await service.from("admins").select("id, name_en, name_cn").in("id", uniq);
  return new Map(
    (data ?? []).map((a: { id: string; name_en: string | null; name_cn: string | null }) => [
      a.id,
      a.name_cn || a.name_en || "Staff",
    ]),
  );
}

type PurchaseRowDb = {
  id: string;
  participant_id: string;
  programme_id: string | null;
  template_id: string | null;
  title: string;
  kind: PurchaseKind;
  total_sgd: number | string;
  registered_on: string;
  status: "active" | "completed" | "cancelled";
  event_id: string | null;
  note: string | null;
  created_at: string;
  cancel_reason: string | null;
  programmes?: { name_cn: string | null; name_en: string | null } | Array<{ name_cn: string | null; name_en: string | null }> | null;
};

export const PURCHASE_COLS =
  "id, participant_id, programme_id, template_id, title, kind, total_sgd, registered_on, status, event_id, note, created_at, cancel_reason, programmes(name_cn, name_en)";

/** Turn purchase rows into full views (schedule, payments, standing). */
export async function hydratePurchases(service: Service, rows: PurchaseRowDb[]): Promise<PurchaseView[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [{ data: sched }, { data: pays }] = await Promise.all([
    service.from("purchase_schedule").select("id, purchase_id, label, due_on, amount_sgd, sort").in("purchase_id", ids),
    service.from("payments").select(PAYMENT_COLS).in("purchase_id", ids).order("paid_on", { ascending: true }).order("created_at", { ascending: true }),
  ]);
  const names = await adminNames(service, (pays ?? []).map((p) => (p as { recorded_by: string | null }).recorded_by ?? ""));
  const today = sgDay();
  return rows.map((r) => {
    const schedule: ScheduleRow[] = (sched ?? [])
      .filter((s) => s.purchase_id === r.id)
      .map((s) => ({ id: s.id, label: s.label, due_on: s.due_on, amount_sgd: num(s.amount_sgd), sort: s.sort }))
      .sort((a, b) => a.sort - b.sort);
    const payments = (pays ?? [])
      .filter((p) => (p as { purchase_id: string }).purchase_id === r.id)
      .map((p) => toPayment(p as Record<string, unknown>, names));
    const prog = Array.isArray(r.programmes) ? r.programmes[0] : r.programmes;
    const total = num(r.total_sgd);
    return {
      id: r.id,
      participant_id: r.participant_id,
      programme_id: r.programme_id,
      programme_name: prog ? prog.name_cn || prog.name_en : null,
      template_id: r.template_id,
      title: r.title,
      kind: r.kind,
      total_sgd: total,
      registered_on: r.registered_on,
      status: r.status,
      event_id: r.event_id,
      note: r.note,
      created_at: r.created_at,
      cancel_reason: r.cancel_reason,
      schedule,
      payments,
      standing: computeStanding({ total, schedule, payments, today, cancelled: r.status === "cancelled" }),
    };
  });
}

export async function loadPurchasesForParticipant(service: Service, participantId: string): Promise<PurchaseView[]> {
  const { data } = await service
    .from("programme_purchases")
    .select(PURCHASE_COLS)
    .eq("participant_id", participantId)
    .order("registered_on", { ascending: false });
  return hydratePurchases(service, (data ?? []) as unknown as PurchaseRowDb[]);
}

export async function loadPurchase(service: Service, purchaseId: string): Promise<PurchaseView | null> {
  const { data } = await service.from("programme_purchases").select(PURCHASE_COLS).eq("id", purchaseId).maybeSingle();
  if (!data) return null;
  return (await hydratePurchases(service, [data as unknown as PurchaseRowDb]))[0] ?? null;
}

export async function loadTemplates(service: Service, opts: { activeOnly?: boolean } = {}): Promise<PaymentTemplate[]> {
  let q = service
    .from("payment_templates")
    .select("id, name, programme_id, kind, total_sgd, note, active, payment_template_items(id, label, amount_sgd, due_after_months, sort)")
    .order("name", { ascending: true });
  if (opts.activeOnly) q = q.eq("active", true);
  const { data } = await q;
  return (data ?? []).map((t) => {
    const r = t as unknown as {
      id: string; name: string; programme_id: string | null; kind: PurchaseKind; total_sgd: number | string;
      note: string | null; active: boolean;
      payment_template_items: Array<{ id: string; label: string; amount_sgd: number | string; due_after_months: number; sort: number }>;
    };
    return {
      id: r.id,
      name: r.name,
      programme_id: r.programme_id,
      kind: r.kind,
      total_sgd: num(r.total_sgd),
      note: r.note,
      active: r.active,
      items: (r.payment_template_items ?? [])
        .map((i) => ({ id: i.id, label: i.label, amount_sgd: num(i.amount_sgd), due_after_months: i.due_after_months, sort: i.sort }))
        .sort((a, b) => a.sort - b.sort),
    };
  });
}

export type NewPurchase = {
  participant_id: string;
  programme_id: string | null;
  template_id: string | null;
  title: string;
  kind: PurchaseKind;
  total_sgd: number;
  registered_on: string;
  schedule: ScheduleRow[];
  event_id: string | null;
  note: string | null;
  created_by: string;
};

export async function createPurchase(service: Service, p: NewPurchase): Promise<string> {
  const { data, error } = await service
    .from("programme_purchases")
    .insert({
      participant_id: p.participant_id,
      programme_id: p.programme_id,
      template_id: p.template_id,
      title: p.title,
      kind: p.kind,
      total_sgd: p.total_sgd,
      registered_on: p.registered_on,
      event_id: p.event_id,
      note: p.note,
      created_by: p.created_by,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "purchase_insert_failed");
  await replaceSchedule(service, data.id, p.schedule);
  return data.id;
}

export async function replaceSchedule(service: Service, purchaseId: string, rows: ScheduleRow[]): Promise<void> {
  const del = await service.from("purchase_schedule").delete().eq("purchase_id", purchaseId);
  if (del.error) throw new Error(del.error.message);
  if (rows.length === 0) return;
  const ins = await service.from("purchase_schedule").insert(
    rows.map((r, i) => ({
      purchase_id: purchaseId,
      label: r.label,
      due_on: r.due_on || null,
      amount_sgd: r.amount_sgd,
      sort: i,
    })),
  );
  if (ins.error) throw new Error(ins.error.message);
}

export type NewPayment = {
  participant_id: string;
  purchase_id?: string | null;
  enrollment_id?: string | null;
  amount: number;
  currency: "SGD" | "MYR";
  fx_rate: number | null;
  method: PaymentMethod;
  paid_on: string;
  reference: string | null;
  counter_batch?: string | null;
  event_id?: string | null;
  note?: string | null;
  recorded_by: string;
};

/** SGD value of a payment: SGD as-is, MYR × typed rate (SGD per 1 MYR). */
export function toSgd(amount: number, currency: "SGD" | "MYR", fx: number | null): number {
  const v = currency === "SGD" ? amount : amount * (fx ?? 0);
  return Math.round(v * 100) / 100;
}

export async function insertPayment(service: Service, p: NewPayment): Promise<string> {
  const amount_sgd = toSgd(p.amount, p.currency, p.fx_rate);
  const { data, error } = await service
    .from("payments")
    .insert({
      participant_id: p.participant_id,
      purchase_id: p.purchase_id ?? null,
      enrollment_id: p.enrollment_id ?? null,
      amount: p.amount,
      currency: p.currency,
      fx_rate: p.currency === "SGD" ? null : p.fx_rate,
      amount_sgd,
      method: p.method,
      paid_on: p.paid_on,
      reference: p.reference,
      counter_batch: p.counter_batch ?? null,
      event_id: p.event_id ?? null,
      note: p.note ?? null,
      recorded_by: p.recorded_by,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "payment_insert_failed");
  return data.id;
}

/** Keep a purchase's status in step with its payments (active ↔ completed). */
export async function syncPurchaseStatus(service: Service, purchaseId: string): Promise<void> {
  const v = await loadPurchase(service, purchaseId);
  if (!v || v.status === "cancelled") return;
  const next = v.standing.state === "complete" ? "completed" : "active";
  if (next !== v.status) {
    await service.from("programme_purchases").update({ status: next, updated_at: new Date().toISOString() }).eq("id", purchaseId);
  }
}

/** The last MYR rate this staff member typed, to pre-fill the next one. */
export async function lastFxRate(service: Service, adminId: string): Promise<number | null> {
  const { data } = await service
    .from("payments")
    .select("fx_rate")
    .eq("recorded_by", adminId)
    .eq("currency", "MYR")
    .order("created_at", { ascending: false })
    .limit(1);
  const r = data?.[0]?.fx_rate;
  return r == null ? null : Number(r);
}

/**
 * Make a programme the participant's current one. Validity starts on the
 * 1st of the registration month (agreed 2026-11-24) and runs for the
 * programme's validity_months, valid through its last day.
 */
export async function setCurrentProgramme(
  service: Service,
  participantId: string,
  programmeId: string,
  registeredOn: string,
): Promise<{ started: string; lastDay: string | null }> {
  const { data: prog } = await service
    .from("programmes")
    .select("validity_months")
    .eq("id", programmeId)
    .is("deleted_at", null)
    .maybeSingle<{ validity_months: number | null }>();
  if (!prog) throw new Error("programme_not_found");
  const firstDay = `${registeredOn.slice(0, 7)}-01`;
  let lastDay: string | null = null;
  if (prog.validity_months != null) {
    const end = addMonthsDay(firstDay, prog.validity_months); // 1st of the month after validity
    const d = new Date(`${end}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    lastDay = d.toISOString().slice(0, 10);
  }
  const { error } = await service
    .from("participants")
    .update({
      programme_id: programmeId,
      programme_started_at: `${firstDay}T00:00:00+08:00`,
      programme_expires_at: lastDay ? `${lastDay}T12:00:00+08:00` : null,
    })
    .eq("id", participantId);
  if (error) throw new Error(error.message);
  return { started: firstDay, lastDay };
}
