import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Finance-dashboard data loaders. One module so the page + CSV export stay
// in sync and we don't have two spellings of "outstanding" drifting apart.

export type EventFinanceRow = {
  id: string;
  slug: string;
  title_en: string | null;
  title_cn: string | null;
  status: string;
  start_date: string | null;
  currency: string | null;
  price: number;

  approved_count: number;        // awaiting payment
  paid_count: number;
  refunded_count: number;

  paid_amount: number;           // sum(amount_paid) where status=paid
  outstanding_amount: number;    // approved × price
  refunded_amount: number;       // sum(refund_amount)
};

export type FinanceOverview = {
  events: EventFinanceRow[];
  totals: {
    paid_amount_by_currency: Record<string, number>;
    outstanding_amount_by_currency: Record<string, number>;
    refunded_amount_by_currency: Record<string, number>;
    paid_count: number;
    outstanding_count: number;
    refunded_count: number;
  };
  recentImports: RecentImport[];
};

export type RecentImport = {
  id: string;
  filename: string;
  uploaded_by_name: string | null;
  row_count: number;
  auto_matched_count: number;
  suggested_count: number;
  unmatched_count: number;
  confirmed_count: number;
  created_at: string;
};

export async function loadFinanceOverview(
  supabase: SupabaseClient,
): Promise<FinanceOverview> {
  // Load every non-archived event. Finance cares about open + closed; archived
  // is usually post-settlement and cluttering.
  const { data: events, error: eventsErr } = await supabase
    .from("events")
    .select("id, slug, title_en, title_cn, status, start_date, currency, price")
    .neq("status", "archived")
    .order("start_date", { ascending: false, nullsFirst: false })
    .limit(40);
  if (eventsErr) throw new Error(eventsErr.message);

  const eventIds = (events ?? []).map((e) => e.id as string);
  if (eventIds.length === 0) {
    return emptyOverview();
  }

  // Pull every enrolment for those events in one shot. The per-event join is
  // tiny — we only need status + amount — so a single query is fine even at
  // a few thousand rows.
  let enrRes = (await supabase
    .from("enrollments")
    .select("event_id, status, payment_status, amount_paid, refund_amount")
    .in("event_id", eventIds)
    .limit(20_000)) as unknown as {
    data: unknown[] | null;
    error: { code?: string; message: string } | null;
  };
  // Pre-013 fallback — refund_amount column absent.
  if (enrRes.error && enrRes.error.code === "42703") {
    enrRes = (await supabase
      .from("enrollments")
      .select("event_id, status, payment_status, amount_paid")
      .in("event_id", eventIds)
      .limit(20_000)) as unknown as typeof enrRes;
  }
  if (enrRes.error) throw new Error(enrRes.error.message);

  type EnrolSlice = {
    event_id: string;
    status: string;
    payment_status: string | null;
    amount_paid: number | string | null;
    refund_amount?: number | string | null;
  };
  const enrolments = (enrRes.data ?? []) as EnrolSlice[];

  const byEvent: Record<string, EnrolSlice[]> = {};
  for (const e of enrolments) {
    if (!byEvent[e.event_id]) byEvent[e.event_id] = [];
    byEvent[e.event_id].push(e);
  }

  const rows: EventFinanceRow[] = (events ?? []).map((ev) => {
    const list = byEvent[ev.id as string] ?? [];
    const price = Number(ev.price ?? 0);
    let approved = 0;
    let paid = 0;
    let refunded = 0;
    let paidAmt = 0;
    let refundedAmt = 0;
    for (const e of list) {
      if (e.status === "approved") approved++;
      if (e.status === "paid" || e.payment_status === "paid") {
        paid++;
        paidAmt += Number(e.amount_paid ?? 0);
      }
      if (e.payment_status === "refunded") refunded++;
      if (e.refund_amount != null) refundedAmt += Number(e.refund_amount);
    }
    return {
      id: ev.id as string,
      slug: ev.slug as string,
      title_en: ev.title_en as string | null,
      title_cn: ev.title_cn as string | null,
      status: ev.status as string,
      start_date: ev.start_date as string | null,
      currency: ev.currency as string | null,
      price,
      approved_count: approved,
      paid_count: paid,
      refunded_count: refunded,
      paid_amount: paidAmt,
      outstanding_amount: approved * price,
      refunded_amount: refundedAmt,
    };
  });

  // Group totals by currency so mixed SGD/MYR/USD events don't silently collapse.
  const paidByCcy: Record<string, number> = {};
  const outByCcy: Record<string, number> = {};
  const refByCcy: Record<string, number> = {};
  let paidCount = 0;
  let outCount = 0;
  let refCount = 0;
  for (const r of rows) {
    const ccy = (r.currency ?? "").trim() || "—";
    paidByCcy[ccy] = (paidByCcy[ccy] ?? 0) + r.paid_amount;
    outByCcy[ccy] = (outByCcy[ccy] ?? 0) + r.outstanding_amount;
    refByCcy[ccy] = (refByCcy[ccy] ?? 0) + r.refunded_amount;
    paidCount += r.paid_count;
    outCount += r.approved_count;
    refCount += r.refunded_count;
  }

  // Recent imports — last 10 with uploader name join.
  const { data: importsRaw } = await supabase
    .from("bank_imports")
    .select(
      "id, filename, row_count, auto_matched_count, suggested_count, unmatched_count, confirmed_count, created_at, uploaded_by",
    )
    .order("created_at", { ascending: false })
    .limit(10);
  const imports = (importsRaw ?? []) as Array<{
    id: string;
    filename: string;
    row_count: number;
    auto_matched_count: number;
    suggested_count: number;
    unmatched_count: number;
    confirmed_count: number;
    created_at: string;
    uploaded_by: string | null;
  }>;

  const uploaderIds = Array.from(
    new Set(imports.map((i) => i.uploaded_by).filter((v): v is string => !!v)),
  );
  const uploaderById = new Map<string, string>();
  if (uploaderIds.length > 0) {
    const { data: admins } = await supabase
      .from("admins")
      .select("id, name_en, name_cn")
      .in("id", uploaderIds);
    for (const a of admins ?? []) {
      const row = a as { id: string; name_en: string | null; name_cn: string | null };
      uploaderById.set(row.id, row.name_en ?? row.name_cn ?? row.id.slice(0, 6));
    }
  }

  const recentImports: RecentImport[] = imports.map((i) => ({
    id: i.id,
    filename: i.filename,
    uploaded_by_name: i.uploaded_by ? uploaderById.get(i.uploaded_by) ?? null : null,
    row_count: i.row_count,
    auto_matched_count: i.auto_matched_count,
    suggested_count: i.suggested_count,
    unmatched_count: i.unmatched_count,
    confirmed_count: i.confirmed_count,
    created_at: i.created_at,
  }));

  return {
    events: rows,
    totals: {
      paid_amount_by_currency: paidByCcy,
      outstanding_amount_by_currency: outByCcy,
      refunded_amount_by_currency: refByCcy,
      paid_count: paidCount,
      outstanding_count: outCount,
      refunded_count: refCount,
    },
    recentImports,
  };
}

function emptyOverview(): FinanceOverview {
  return {
    events: [],
    totals: {
      paid_amount_by_currency: {},
      outstanding_amount_by_currency: {},
      refunded_amount_by_currency: {},
      paid_count: 0,
      outstanding_count: 0,
      refunded_count: 0,
    },
    recentImports: [],
  };
}

export function formatMoney(amount: number, currency: string | null): string {
  const ccy = (currency ?? "").trim();
  const n = Math.round(amount * 100) / 100;
  const display = n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (!ccy || ccy === "—") return display;
  return `${ccy} ${display}`;
}
