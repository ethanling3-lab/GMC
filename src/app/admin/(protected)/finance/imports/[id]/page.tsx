import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { TransactionRow, type TxnRow } from "@/components/admin/finance/TransactionRow";

export const metadata: Metadata = { title: "Reconcile import" };
export const dynamic = "force-dynamic";

const STATUS_TABS = [
  { code: "all", label: "All", labelZh: "全部" },
  { code: "suggested", label: "Suggested", labelZh: "建议" },
  { code: "auto_matched", label: "Auto", labelZh: "自动" },
  { code: "unmatched", label: "Unmatched", labelZh: "待配" },
  { code: "confirmed", label: "Confirmed", labelZh: "已确认" },
  { code: "ignored", label: "Ignored", labelZh: "忽略" },
] as const;

type StatusCode = (typeof STATUS_TABS)[number]["code"];

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ImportReviewPage({ params, searchParams }: PageProps) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "finance") {
    redirect("/admin");
  }

  const { id: importId } = await params;
  const sp = await searchParams;
  const statusParam = typeof sp.status === "string" ? sp.status : "all";
  const status: StatusCode = STATUS_TABS.some((s) => s.code === statusParam)
    ? (statusParam as StatusCode)
    : "all";

  const supabase = await createSupabaseServerClient();

  const { data: imp, error: impErr } = await supabase
    .from("bank_imports")
    .select(
      "id, filename, row_count, auto_matched_count, suggested_count, unmatched_count, confirmed_count, uploaded_by, created_at",
    )
    .eq("id", importId)
    .maybeSingle();
  if (impErr) throw new Error(impErr.message);
  if (!imp) notFound();

  const { data: uploader } = imp.uploaded_by
    ? await supabase
        .from("admins")
        .select("name_en, name_cn")
        .eq("id", imp.uploaded_by)
        .maybeSingle()
    : { data: null };

  // Load every txn; filter client-side per tab so we can show tab counts
  // without a second query. Imports are usually ≤ a few hundred rows so
  // this is fine.
  const { data: txns, error: txnErr } = await supabase
    .from("bank_transactions")
    .select(
      "id, txn_date, amount, currency, raw_name, raw_reference, status, match_confidence, match_basis, matched_enrollment_id, note",
    )
    .eq("import_id", importId)
    .order("txn_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(2000);
  if (txnErr) throw new Error(txnErr.message);

  type RawTxn = {
    id: string;
    txn_date: string | null;
    amount: number;
    currency: string | null;
    raw_name: string | null;
    raw_reference: string | null;
    status: string;
    match_confidence: number | null;
    match_basis: string | null;
    matched_enrollment_id: string | null;
    note: string | null;
  };
  const rows = (txns ?? []) as RawTxn[];

  // Resolve matched enrolments + participants + events in a single pass so
  // every row renders with its candidate panel filled in.
  const enrolmentIds = Array.from(
    new Set(
      rows
        .map((r) => r.matched_enrollment_id)
        .filter((v): v is string => typeof v === "string" && v.length > 0),
    ),
  );
  const enrolmentById = new Map<string, TxnRow["candidate"]>();
  if (enrolmentIds.length > 0) {
    const { data: eRows } = await supabase
      .from("enrollments")
      .select(
        "id, event_id, participant_id, status, payment_status, event:events(id, title_en, title_cn, currency, price, start_date), participant:participants(id, region_id, name_en, name_cn, region)",
      )
      .in("id", enrolmentIds);
    type EnrollDetail = {
      id: string;
      event_id: string;
      participant_id: string;
      status: string;
      payment_status: string;
      event: {
        id: string;
        title_en: string | null;
        title_cn: string | null;
        currency: string | null;
        price: number | string | null;
        start_date: string | null;
      } | null;
      participant: {
        id: string;
        region_id: string | null;
        name_en: string | null;
        name_cn: string | null;
        region: string | null;
      } | null;
    };
    for (const e of (eRows ?? []) as unknown as EnrollDetail[]) {
      enrolmentById.set(e.id, {
        enrollment_id: e.id,
        participant_id: e.participant_id,
        region_id: e.participant?.region_id ?? null,
        name_en: e.participant?.name_en ?? null,
        name_cn: e.participant?.name_cn ?? null,
        event_title:
          e.event?.title_en || e.event?.title_cn || "",
        event_date: e.event?.start_date ?? null,
        expected_amount: e.event?.price != null ? Number(e.event.price) : null,
        currency: e.event?.currency ?? null,
        payment_status: e.payment_status,
        enrollment_status: e.status,
      });
    }
  }

  const mapped: TxnRow[] = rows.map((r) => ({
    id: r.id,
    txn_date: r.txn_date,
    amount: Number(r.amount),
    currency: r.currency,
    raw_name: r.raw_name,
    raw_reference: r.raw_reference,
    status: r.status as TxnRow["status"],
    match_confidence: r.match_confidence != null ? Number(r.match_confidence) : null,
    match_basis: r.match_basis,
    note: r.note,
    candidate: r.matched_enrollment_id
      ? enrolmentById.get(r.matched_enrollment_id) ?? null
      : null,
  }));

  const counts: Record<StatusCode, number> = {
    all: mapped.length,
    suggested: 0,
    auto_matched: 0,
    unmatched: 0,
    confirmed: 0,
    ignored: 0,
  };
  for (const m of mapped) {
    if (m.status in counts) counts[m.status as StatusCode]++;
  }

  const visible =
    status === "all" ? mapped : mapped.filter((r) => r.status === status);

  const uploaderName = uploader
    ? (uploader as { name_en: string | null; name_cn: string | null }).name_en ??
      (uploader as { name_en: string | null; name_cn: string | null }).name_cn
    : null;

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-5">
        <Link
          href="/admin/finance"
          className="inline-flex items-center gap-1.5 text-[11.5px] tracking-[0.14em] uppercase text-[var(--ink-mute)] hover:text-[var(--ink)] transition-colors duration-[var(--dur-fast)]"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 2L3 5l3 3" />
          </svg>
          Back to finance
        </Link>
      </div>

      {/* Header card */}
      <div className="rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)] p-6">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
              <span className="w-5 h-px bg-current" />
              Reconcile · 对账
            </div>
            <h1 className="mt-3 font-display text-[26px] leading-[1.15] tracking-[-0.01em] text-[var(--ink)] break-all">
              {imp.filename}
            </h1>
            <div className="mt-2 flex items-center gap-2 flex-wrap text-[11.5px] text-[var(--ink-mute)]">
              <span className="tracking-[0.14em] uppercase">
                {new Date(imp.created_at).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </span>
              {uploaderName ? (
                <>
                  <span className="text-[var(--ink-faint)]">·</span>
                  <span>Uploaded by {uploaderName}</span>
                </>
              ) : null}
              <span className="text-[var(--ink-faint)]">·</span>
              <span className="tabular-nums">{imp.row_count} rows</span>
            </div>
          </div>

          <div className="flex items-stretch gap-3">
            <MetricChip label="Confirmed" value={counts.confirmed} tone="go" />
            <MetricChip
              label="Pending"
              value={counts.auto_matched + counts.suggested + counts.unmatched}
              tone="warn"
            />
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-5 flex flex-wrap gap-2">
          {STATUS_TABS.map((tab) => {
            const count = counts[tab.code];
            const active = status === tab.code;
            const params = new URLSearchParams();
            if (tab.code !== "all") params.set("status", tab.code);
            const qs = params.toString();
            const href = qs
              ? `/admin/finance/imports/${imp.id}?${qs}`
              : `/admin/finance/imports/${imp.id}`;
            return (
              <Link
                key={tab.code}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex items-center gap-2 h-8 px-3 rounded-[var(--radius-pill)] border text-[11.5px] tracking-[0.04em] transition-[background-color,border-color,color] duration-[var(--dur-fast)]
                            ${
                              active
                                ? "border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
                                : "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-soft)] hover:border-[var(--cinnabar)]/25 hover:bg-[var(--paper-deep)] hover:text-[var(--ink)]"
                            }`}
              >
                <span>
                  {tab.label} · {tab.labelZh}
                </span>
                <span
                  className={`tabular-nums text-[10px] tracking-[0.06em] px-1.5 py-0.5 rounded-full
                              ${active ? "bg-[var(--cinnabar)]/15" : "bg-[var(--paper-deep)] text-[var(--ink-mute)]"}`}
                >
                  {count}
                </span>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Transaction list */}
      <div className="mt-6">
        {visible.length === 0 ? (
          <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--paper-shadow)] bg-[var(--paper)]/60 px-6 py-10 text-center">
            <div className="text-[12.5px] text-[var(--ink-mute)]">
              No transactions in this tab.
            </div>
          </div>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {visible.map((r) => (
              <TransactionRow key={r.id} row={r} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function MetricChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "go" | "warn";
}) {
  const cls =
    tone === "go"
      ? "border-[#5b9a5d]/30 bg-[#5b9a5d]/8 text-[#3a6b3b]"
      : "border-[var(--gold)]/35 bg-[var(--gold-soft)] text-[var(--ink)]";
  return (
    <div
      className={`rounded-[var(--radius-md)] border ${cls} px-5 py-3 text-right`}
    >
      <div className="text-[9px] tracking-[0.28em] uppercase opacity-75">
        {label}
      </div>
      <div className="mt-0.5 font-display text-[22px] leading-[1] tracking-[-0.015em] tabular-nums">
        {value.toLocaleString()}
      </div>
    </div>
  );
}
