import "server-only";
import type { createSupabaseServiceClient } from "@/lib/supabase";
import { resolveEnrollmentPrice } from "@/lib/pricing/resolve-server";
import { BASE_CATEGORY_LABEL, sgDay, type PriceTier } from "@/lib/pricing/tiers";
import { toE164OrNull } from "@/lib/whatsapp/phone";
import { loadPurchasesForParticipant } from "./ledger";
import type { PaymentMethod, PurchaseView } from "./types";

// Payment counter · 收款台 (Phase 2, 2026-11-26). Read side: find people,
// load one person's counter view, today's takings. Finance + Super Admin.

type Service = ReturnType<typeof createSupabaseServiceClient>;

export const COUNTER_EVENT_COLS =
  "id, slug, status, capacity, currency, price, misc_fee, price_tiers, course_id, title_en, title_cn, start_date, end_date, requires_approval";

export type CounterEvent = {
  id: string;
  slug: string;
  status: string;
  capacity: number | null;
  currency: string | null;
  price: number | null;
  misc_fee: number | null;
  price_tiers: PriceTier[] | null;
  course_id: string | null;
  title_en: string | null;
  title_cn: string | null;
  start_date: string | null;
  end_date: string | null;
  requires_approval: boolean | null;
};

export async function loadCounterEvent(service: Service, eventId: string): Promise<CounterEvent | null> {
  const { data } = await service.from("events").select(COUNTER_EVENT_COLS).eq("id", eventId).maybeSingle();
  return (data as CounterEvent | null) ?? null;
}

export type PersonHit = {
  id: string;
  region_id: string | null;
  name_cn: string | null;
  name_en: string | null;
  phone: string | null;
  email: string | null;
  enrollment: { id: string; status: string; amount_due: number | null; amount_paid: number | null } | null;
  open_purchases: number;
};

/** Typeahead for the counter (and the referrer picker). */
export async function findPeople(service: Service, q: string, eventId: string | null): Promise<PersonHit[]> {
  const needle = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
  const digits = q.replace(/\D/g, "");
  const ors = [
    `name_en.ilike.${needle}`,
    `name_cn.ilike.${needle}`,
    `region_id.ilike.${needle}`,
    `email.ilike.${needle}`,
    `phone.ilike.${needle}`,
  ];
  // "012 345 6789" should still find "+60123456789".
  if (digits.length >= 5) ors.push(`phone_e164.ilike.%${digits}%`);
  const { data } = await service
    .from("participants")
    .select("id, region_id, name_cn, name_en, phone, email")
    .or(ors.join(","))
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(10);
  const rows = (data ?? []) as Array<Omit<PersonHit, "enrollment" | "open_purchases">>;
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [enr, pur] = await Promise.all([
    eventId
      ? service.from("enrollments").select("id, participant_id, status, amount_due, amount_paid").eq("event_id", eventId).in("participant_id", ids)
      : Promise.resolve({ data: [] as Array<{ id: string; participant_id: string; status: string; amount_due: number | null; amount_paid: number | null }> }),
    service.from("programme_purchases").select("participant_id").eq("status", "active").in("participant_id", ids),
  ]);
  return rows.map((r) => {
    const e = (enr.data ?? []).find((x) => x.participant_id === r.id) ?? null;
    return {
      ...r,
      enrollment: e
        ? { id: e.id, status: e.status, amount_due: e.amount_due == null ? null : Number(e.amount_due), amount_paid: e.amount_paid == null ? null : Number(e.amount_paid) }
        : null,
      open_purchases: (pur.data ?? []).filter((x) => x.participant_id === r.id).length,
    };
  });
}

/** Existing people with the same phone, before creating a new one. */
export async function phoneMatches(service: Service, phone: string, region: string): Promise<PersonHit[]> {
  const e164 = toE164OrNull(phone, region);
  const seen = new Map<string, Omit<PersonHit, "enrollment" | "open_purchases">>();
  const cols = "id, region_id, name_cn, name_en, phone, email";
  const queries = [service.from("participants").select(cols).eq("phone", phone.trim()).limit(5)];
  if (e164) queries.push(service.from("participants").select(cols).eq("phone_e164", e164).limit(5));
  for (const res of await Promise.all(queries)) {
    for (const r of (res.data ?? []) as Array<Omit<PersonHit, "enrollment" | "open_purchases">>) seen.set(r.id, r);
  }
  return [...seen.values()].map((r) => ({ ...r, enrollment: null, open_purchases: 0 }));
}

export type CounterPerson = {
  id: string;
  region_id: string | null;
  name_cn: string | null;
  name_en: string | null;
  phone: string | null;
  email: string | null;
  referrer: string | null;
  programme: string | null;
  enrollment: {
    id: string;
    status: string;
    amount_due: number | null;
    amount_paid: number;
    price_label: string;
  } | null;
  /** What they would pay for this event if enrolled now (when not enrolled). */
  quote: { amount: number | null; label: string };
  purchases: PurchaseView[];
};

function categoryLabel(cat: string, programmeNames: Map<string, string>): string {
  const base = BASE_CATEGORY_LABEL[cat];
  if (base) return `${base.cn} · ${base.en}`;
  return programmeNames.get(cat) ?? cat;
}

export async function loadCounterPerson(service: Service, event: CounterEvent, participantId: string): Promise<CounterPerson | null> {
  const { data: p } = await service
    .from("participants")
    .select("id, region_id, name_cn, name_en, phone, email, referrer_id, referrer_name, programme_expires_at, programmes(name_cn, slug)")
    .eq("id", participantId)
    .maybeSingle();
  if (!p) return null;
  const row = p as unknown as {
    id: string; region_id: string | null; name_cn: string | null; name_en: string | null; phone: string | null; email: string | null;
    referrer_id: string | null; referrer_name: string | null; programme_expires_at: string | null;
    programmes: { name_cn: string; slug: string } | Array<{ name_cn: string; slug: string }> | null;
  };
  const prog = Array.isArray(row.programmes) ? row.programmes[0] : row.programmes;

  let referrer = row.referrer_name;
  if (row.referrer_id) {
    const { data: r } = await service.from("participants").select("name_cn, name_en, region_id").eq("id", row.referrer_id).maybeSingle();
    if (r) referrer = `${r.name_cn || r.name_en || ""}${r.region_id ? ` ${r.region_id}` : ""}`.trim();
  }

  const { data: progs } = await service.from("programmes").select("slug, name_cn");
  const names = new Map((progs ?? []).map((x: { slug: string; name_cn: string }) => [x.slug, x.name_cn]));

  const { data: e } = await service
    .from("enrollments")
    .select("id, status, amount_due, amount_paid, price_basis")
    .eq("event_id", event.id)
    .eq("participant_id", participantId)
    .maybeSingle();

  const priced = await resolveEnrollmentPrice(event, participantId, service);
  const quote = { amount: priced.amount_due, label: categoryLabel(priced.price_basis.category, names) };

  const enrollment = e
    ? {
        id: e.id as string,
        status: e.status as string,
        amount_due: e.amount_due == null ? null : Number(e.amount_due),
        amount_paid: Number(e.amount_paid ?? 0),
        price_label: (e.price_basis as { category?: string } | null)?.category
          ? categoryLabel((e.price_basis as { category: string }).category, names)
          : quote.label,
      }
    : null;

  const purchases = (await loadPurchasesForParticipant(service, participantId)).filter((x) => x.status !== "cancelled");

  const today = sgDay();
  const progValid = prog && (!row.programme_expires_at || row.programme_expires_at.slice(0, 10) >= today);
  return {
    id: row.id,
    region_id: row.region_id,
    name_cn: row.name_cn,
    name_en: row.name_en,
    phone: row.phone,
    email: row.email,
    referrer,
    programme: prog ? `${prog.name_cn}${progValid ? "" : " (expired)"}` : null,
    enrollment,
    quote,
    purchases,
  };
}

/** Price for someone not in the CRM yet (新人). */
export async function newPersonQuote(service: Service, event: CounterEvent): Promise<{ amount: number | null; label: string }> {
  const priced = await resolveEnrollmentPrice(event, null, service);
  const base = BASE_CATEGORY_LABEL[priced.price_basis.category];
  return { amount: priced.amount_due, label: base ? `${base.cn} · ${base.en}` : priced.price_basis.category };
}

export type Takings = {
  day: string;
  count: number;
  total_sgd: number;
  by_method: Array<{ method: PaymentMethod; count: number; total_sgd: number }>;
  rows: Array<{
    id: string;
    batch: string | null;
    person: string;
    region_id: string | null;
    what: string;
    method: PaymentMethod;
    amount_sgd: number;
    reference: string | null;
    created_at: string;
    by: string | null;
  }>;
};

/** Everything taken at this event's counter on one day (voided excluded). */
export async function loadTakings(service: Service, eventId: string, day: string): Promise<Takings> {
  const { data } = await service
    .from("payments")
    .select("id, counter_batch, participant_id, purchase_id, enrollment_id, method, amount_sgd, reference, created_at, recorded_by, participants(name_cn, name_en, region_id), programme_purchases(title)")
    .eq("event_id", eventId)
    .eq("paid_on", day)
    .is("voided_at", null)
    .order("created_at", { ascending: false });
  type R = {
    id: string; counter_batch: string | null; enrollment_id: string | null; method: PaymentMethod; amount_sgd: number | string;
    reference: string | null; created_at: string; recorded_by: string | null;
    participants: { name_cn: string | null; name_en: string | null; region_id: string | null } | null;
    programme_purchases: { title: string } | null;
  };
  const rows = (data ?? []) as unknown as R[];
  const ids = [...new Set(rows.map((r) => r.recorded_by).filter(Boolean))] as string[];
  const { data: admins } = ids.length
    ? await service.from("admins").select("id, name_cn, name_en").in("id", ids)
    : { data: [] as Array<{ id: string; name_cn: string | null; name_en: string | null }> };
  const by = new Map((admins ?? []).map((a) => [a.id, a.name_cn || a.name_en || "Staff"]));

  const methods = new Map<PaymentMethod, { count: number; total_sgd: number }>();
  let total = 0;
  for (const r of rows) {
    const amt = Number(r.amount_sgd);
    total += amt;
    const m = methods.get(r.method) ?? { count: 0, total_sgd: 0 };
    m.count += 1;
    m.total_sgd = Math.round((m.total_sgd + amt) * 100) / 100;
    methods.set(r.method, m);
  }
  return {
    day,
    count: rows.length,
    total_sgd: Math.round(total * 100) / 100,
    by_method: [...methods.entries()].map(([method, v]) => ({ method, ...v })),
    rows: rows.map((r) => ({
      id: r.id,
      batch: r.counter_batch,
      person: r.participants?.name_cn || r.participants?.name_en || "—",
      region_id: r.participants?.region_id ?? null,
      what: r.enrollment_id ? "Event fee · 课程费" : r.programme_purchases?.title ?? "Programme",
      method: r.method,
      amount_sgd: Number(r.amount_sgd),
      reference: r.reference,
      created_at: r.created_at,
      by: r.recorded_by ? by.get(r.recorded_by) ?? null : null,
    })),
  };
}
