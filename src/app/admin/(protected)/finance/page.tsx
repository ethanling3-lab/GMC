import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import {
  formatMoney,
  loadFinanceOverview,
  type EventFinanceRow,
} from "@/lib/finance/finance-query";
import { BankCsvUploader } from "@/components/admin/finance/BankCsvUploader";

export const metadata: Metadata = { title: "Finance" };
export const dynamic = "force-dynamic";

export default async function FinanceDashboardPage() {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "finance") {
    redirect("/admin");
  }

  const supabase = await createSupabaseServerClient();
  const overview = await loadFinanceOverview(supabase);

  const currencies = Array.from(
    new Set([
      ...Object.keys(overview.totals.paid_amount_by_currency),
      ...Object.keys(overview.totals.outstanding_amount_by_currency),
    ]),
  ).sort();

  return (
    <div>
      {/* Header */}
      <div className="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
            <span className="w-5 h-px bg-current" />
            Finance · 财务
          </div>
          <h1 className="mt-4 font-display text-[36px] md:text-[40px] leading-[1.05] tracking-[-0.015em] text-[var(--ink)]">
            Reconcile, track, settle.
          </h1>
          <p className="mt-4 max-w-[62ch] text-[14.5px] leading-[1.7] text-[var(--ink-soft)]">
            Import bank statements, match inflows to approved enrolments, and
            watch outstanding balances settle per event.
          </p>
        </div>
        <div className="text-right">
          <div className="text-[9px] tracking-[0.28em] uppercase text-[var(--ink-faint)]">
            Today
          </div>
          <div className="mt-1 font-display text-[20px] leading-[1.1] text-[var(--ink)]">
            {new Date().toLocaleDateString("en-GB", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </div>
        </div>
      </div>

      {/* Totals ribbon */}
      <section className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-5">
        <TotalCard
          label="Paid"
          labelZh="已收"
          tone="go"
          count={overview.totals.paid_count}
          amountByCurrency={overview.totals.paid_amount_by_currency}
        />
        <TotalCard
          label="Outstanding"
          labelZh="待收"
          tone="warn"
          count={overview.totals.outstanding_count}
          amountByCurrency={overview.totals.outstanding_amount_by_currency}
        />
        <TotalCard
          label="Refunded"
          labelZh="已退"
          tone="danger"
          count={overview.totals.refunded_count}
          amountByCurrency={overview.totals.refunded_amount_by_currency}
        />
      </section>

      {/* Upload + recent imports */}
      <section className="mt-12 grid lg:grid-cols-[1.1fr_0.9fr] gap-8">
        <BankCsvUploader />

        <div className="relative rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] p-6 shadow-[var(--shadow-paper-1)]">
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
                <span className="w-4 h-px bg-current" />
                Imports · 导入记录
              </div>
              <h2 className="mt-2 font-display text-[20px] leading-[1.2] tracking-[-0.01em] text-[var(--ink)]">
                Recent bank imports
              </h2>
            </div>
            {overview.recentImports.length > 0 ? (
              <span className="text-[11px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
                Last {overview.recentImports.length}
              </span>
            ) : null}
          </div>

          {overview.recentImports.length === 0 ? (
            <p className="mt-5 text-[13px] leading-[1.7] text-[var(--ink-mute)]">
              No imports yet. Drop a statement on the left to start the first
              reconciliation run.
            </p>
          ) : (
            <ul className="mt-5 flex flex-col divide-y divide-[var(--paper-shadow)]">
              {overview.recentImports.map((imp) => {
                const pending = imp.suggested_count + imp.unmatched_count;
                return (
                  <li key={imp.id}>
                    <Link
                      href={`/admin/finance/imports/${imp.id}`}
                      className="group flex items-center gap-4 py-3 -mx-2 px-2 rounded-[var(--radius-md)]
                                 transition-[background-color] duration-[var(--dur-fast)]
                                 hover:bg-[var(--paper-deep)]"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] text-[var(--ink)] truncate leading-[1.3]">
                          {imp.filename}
                        </div>
                        <div className="mt-0.5 text-[11px] tracking-[0.14em] uppercase text-[var(--ink-faint)]">
                          {new Date(imp.created_at).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                          {imp.uploaded_by_name ? ` · ${imp.uploaded_by_name}` : ""}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 tabular-nums">
                        <StatusPip label={`${imp.confirmed_count}`} tone="go" />
                        <StatusPip label={`${imp.auto_matched_count}`} tone="info" />
                        <StatusPip label={`${pending}`} tone={pending > 0 ? "warn" : "neutral"} />
                      </div>
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 10 10"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        className="text-[var(--ink-faint)] group-hover:text-[var(--cinnabar)] transition-colors"
                        aria-hidden="true"
                      >
                        <path d="M4 2l3 3-3 3" />
                      </svg>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* Per-event ledger */}
      <section className="mt-12 rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] p-6 shadow-[var(--shadow-paper-1)]">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
              <span className="w-4 h-px bg-current" />
              By event · 按活动
            </div>
            <h2 className="mt-2 font-display text-[22px] leading-[1.2] tracking-[-0.01em] text-[var(--ink)]">
              Event ledger
            </h2>
          </div>
          <span className="text-[11px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
            {overview.events.length} event{overview.events.length === 1 ? "" : "s"}
          </span>
        </div>

        {overview.events.length === 0 ? (
          <p className="mt-5 text-[13px] leading-[1.7] text-[var(--ink-mute)]">
            No non-archived events. Create one from the Events module to start
            tracking finance here.
          </p>
        ) : (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="text-left text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
                  <th className="pb-3 font-normal">Event</th>
                  <th className="pb-3 font-normal text-right tabular-nums">Approved</th>
                  <th className="pb-3 font-normal text-right tabular-nums">Paid</th>
                  <th className="pb-3 font-normal text-right tabular-nums">Refunded</th>
                  <th className="pb-3 font-normal text-right tabular-nums">Paid (amt)</th>
                  <th className="pb-3 font-normal text-right tabular-nums">Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {overview.events.map((e) => (
                  <EventRow key={e.id} row={e} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {currencies.length > 1 ? (
          <div className="mt-5 pt-4 border-t border-[var(--paper-shadow)] flex items-center gap-2 flex-wrap text-[10.5px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
            <span>Currencies in play</span>
            {currencies.map((c) => (
              <span
                key={c}
                className="px-2 py-0.5 rounded-[var(--radius-pill)] bg-[var(--paper-deep)] text-[var(--ink-mute)]"
              >
                {c}
              </span>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function TotalCard({
  label,
  labelZh,
  tone,
  count,
  amountByCurrency,
}: {
  label: string;
  labelZh: string;
  tone: "go" | "warn" | "danger";
  count: number;
  amountByCurrency: Record<string, number>;
}) {
  const currencies = Object.keys(amountByCurrency).filter(
    (c) => amountByCurrency[c] > 0,
  );
  const toneRail =
    tone === "go"
      ? "linear-gradient(180deg, #5b9a5d 0%, rgba(91,154,93,0) 100%)"
      : tone === "warn"
        ? "linear-gradient(180deg, var(--gold) 0%, rgba(218,165,32,0) 100%)"
        : "linear-gradient(180deg, var(--cinnabar) 0%, rgba(220,68,51,0) 100%)";
  const toneDot =
    tone === "go"
      ? "#5b9a5d"
      : tone === "warn"
        ? "var(--gold)"
        : "var(--cinnabar)";

  return (
    <article
      className="relative rounded-[var(--radius-lg)] border border-[var(--paper-shadow)]
                 bg-[var(--paper-warm)] overflow-hidden
                 shadow-[var(--shadow-paper-1)]"
    >
      <span
        aria-hidden="true"
        className="absolute left-0 top-5 bottom-5 w-[3px] rounded-full"
        style={{ background: toneRail }}
      />
      <div className="px-6 py-6 pl-7">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: toneDot }}
              aria-hidden="true"
            />
            <div className="text-[10px] tracking-[0.24em] uppercase text-[var(--ink-mute)]">
              {label}
            </div>
          </div>
          <div className="text-[10px] tracking-[0.18em] uppercase text-[var(--ink-faint)]">
            {labelZh}
          </div>
        </div>

        <div className="mt-5 font-display text-[36px] leading-[1] tracking-[-0.02em] text-[var(--ink)] tabular-nums">
          {count.toLocaleString()}
        </div>

        {currencies.length === 0 ? (
          <div className="mt-3 text-[12px] text-[var(--ink-faint)]">—</div>
        ) : (
          <div className="mt-3 flex flex-col gap-0.5 text-[12.5px] text-[var(--ink-soft)] tabular-nums">
            {currencies.map((c) => (
              <div key={c} className="flex items-baseline justify-between gap-4">
                <span className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
                  {c}
                </span>
                <span>{formatMoney(amountByCurrency[c], c)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

function StatusPip({
  label,
  tone,
}: {
  label: string;
  tone: "go" | "info" | "warn" | "neutral";
}) {
  const cls =
    tone === "go"
      ? "border-[#5b9a5d]/30 bg-[#5b9a5d]/8 text-[#3a6b3b]"
      : tone === "info"
        ? "border-[var(--cinnabar)]/25 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
        : tone === "warn"
          ? "border-[var(--gold)]/35 bg-[var(--gold-soft)] text-[var(--ink)]"
          : "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-mute)]";
  return (
    <span
      className={`inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-[var(--radius-pill)]
                  border text-[10.5px] tabular-nums ${cls}`}
    >
      {label}
    </span>
  );
}

function EventRow({ row }: { row: EventFinanceRow }) {
  const title =
    row.title_en || row.title_cn
      ? `${row.title_en ?? ""}${row.title_en && row.title_cn ? " · " : ""}${row.title_cn ?? ""}`
      : row.slug;
  const startStr = row.start_date
    ? new Date(row.start_date).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";
  const outstandingTone =
    row.outstanding_amount > 0 ? "text-[var(--ink)]" : "text-[var(--ink-faint)]";
  return (
    <tr className="border-t border-[var(--paper-shadow)] hover:bg-[var(--paper-deep)]/50">
      <td className="py-3 pr-4">
        <div className="text-[13.5px] text-[var(--ink)] leading-[1.3]">
          <Link
            href={`/admin/events/${row.id}/enrollments?status=paid`}
            className="hover:text-[var(--cinnabar)] transition-colors"
          >
            {title}
          </Link>
        </div>
        <div className="mt-0.5 text-[10.5px] tracking-[0.14em] uppercase text-[var(--ink-faint)]">
          {row.status} · {startStr}
        </div>
      </td>
      <td className="py-3 text-right tabular-nums text-[var(--ink-soft)]">
        {row.approved_count.toLocaleString()}
      </td>
      <td className="py-3 text-right tabular-nums text-[var(--ink-soft)]">
        {row.paid_count.toLocaleString()}
      </td>
      <td className="py-3 text-right tabular-nums text-[var(--ink-mute)]">
        {row.refunded_count.toLocaleString()}
      </td>
      <td className="py-3 text-right tabular-nums text-[var(--ink)]">
        {row.paid_amount > 0 ? formatMoney(row.paid_amount, row.currency) : "—"}
      </td>
      <td className={`py-3 text-right tabular-nums ${outstandingTone}`}>
        {row.outstanding_amount > 0
          ? formatMoney(row.outstanding_amount, row.currency)
          : "—"}
      </td>
    </tr>
  );
}
