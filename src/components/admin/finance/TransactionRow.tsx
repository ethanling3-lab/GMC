"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EnrollmentPicker } from "./EnrollmentPicker";
import { formatMoney } from "@/lib/finance/format";

// One bank_transaction, rendered as an expandable row. Admin can confirm the
// existing match, retarget to a different enrolment, ignore the txn, or
// clear the match. The row collapses after a successful action (pending a
// router.refresh).

export type TxnRow = {
  id: string;
  txn_date: string | null;
  amount: number;
  currency: string | null;
  raw_name: string | null;
  raw_reference: string | null;
  status: "unmatched" | "suggested" | "auto_matched" | "confirmed" | "ignored";
  match_confidence: number | null;
  match_basis: string | null;
  note: string | null;
  candidate: null | {
    enrollment_id: string;
    participant_id: string;
    region_id: string | null;
    name_en: string | null;
    name_cn: string | null;
    event_title: string;
    event_date: string | null;
    expected_amount: number | null;
    currency: string | null;
    payment_status: string;
    enrollment_status: string;
  };
};

export function TransactionRow({ row }: { row: TxnRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(row.status === "suggested" || row.status === "auto_matched");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingTarget, setPendingTarget] = useState<TxnRow["candidate"]>(row.candidate);
  const [, startTransition] = useTransition();

  async function patch(body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/finance/transactions/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => ({}) as Record<string, unknown>);
      if (!res.ok) {
        const detail =
          typeof (payload as { detail?: unknown }).detail === "string"
            ? (payload as { detail: string }).detail
            : typeof (payload as { error?: unknown }).error === "string"
              ? (payload as { error: string }).error
              : `Failed (${res.status})`;
        setError(detail);
        setBusy(false);
        return false;
      }
      startTransition(() => router.refresh());
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setBusy(false);
      return false;
    }
  }

  const tone = statusTone(row.status);
  const isTerminal = row.status === "confirmed" || row.status === "ignored";
  const expanded = open && !isTerminal;

  return (
    <li
      data-status={row.status}
      className="group rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)]
                 shadow-[var(--shadow-paper-1)] overflow-hidden"
    >
      <button
        type="button"
        onClick={() => {
          if (!isTerminal) setOpen((v) => !v);
        }}
        aria-expanded={expanded}
        disabled={isTerminal}
        className="w-full flex items-center gap-4 px-4 py-3 text-left
                   disabled:cursor-default
                   transition-[background-color] duration-[var(--dur-fast)]
                   enabled:hover:bg-[var(--paper-warm)]"
      >
        <span
          className={`inline-flex items-center h-6 px-2 rounded-[var(--radius-pill)] border text-[10px] tracking-[0.14em] uppercase ${tone.chip}`}
        >
          {tone.label}
        </span>
        <div className="flex-1 min-w-0 grid grid-cols-[auto_1fr_auto] items-center gap-4">
          <div className="text-[11.5px] tracking-[0.14em] uppercase text-[var(--ink-faint)] tabular-nums">
            {row.txn_date ?? "—"}
          </div>
          <div className="min-w-0">
            <div className="text-[13.5px] text-[var(--ink)] truncate leading-[1.3]">
              {row.raw_name ?? <span className="text-[var(--ink-faint)]">(no name)</span>}
            </div>
            {row.raw_reference ? (
              <div className="text-[11px] font-mono text-[var(--ink-faint)] truncate mt-0.5">
                {row.raw_reference}
              </div>
            ) : null}
          </div>
          <div className="font-display text-[16px] tabular-nums text-[var(--ink)]">
            {formatMoney(row.amount, row.currency)}
          </div>
        </div>
        {row.match_confidence != null ? (
          <span className="text-[10px] tracking-[0.18em] uppercase text-[var(--ink-faint)] tabular-nums">
            {Math.round(row.match_confidence * 100)}%
          </span>
        ) : null}
        {!isTerminal ? (
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            className={`text-[var(--ink-faint)] transition-transform duration-[var(--dur-fast)] ${expanded ? "rotate-180" : ""}`}
            aria-hidden="true"
          >
            <path d="M2 4l3 3 3-3" />
          </svg>
        ) : null}
      </button>

      {expanded ? (
        <div className="border-t border-[var(--paper-shadow)] px-4 py-4 bg-[var(--paper-warm)]">
          <div className="grid md:grid-cols-[1fr_auto] gap-4 items-start">
            <div className="min-w-0">
              {pendingTarget ? (
                <div className="rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] px-4 py-3">
                  <div className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
                    Matching with
                  </div>
                  <div className="mt-1.5 flex items-baseline gap-2 flex-wrap">
                    <span className="font-mono text-[12px] text-[var(--cinnabar-deep)]">
                      {pendingTarget.region_id ?? "—"}
                    </span>
                    <span className="text-[13.5px] text-[var(--ink)]">
                      {pendingTarget.name_en ?? pendingTarget.name_cn ?? "(unnamed)"}
                    </span>
                    <span className="text-[11.5px] text-[var(--ink-mute)]">
                      {pendingTarget.event_title}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-[11.5px] text-[var(--ink-mute)] tabular-nums">
                    <span>
                      Expected{" "}
                      {pendingTarget.expected_amount != null
                        ? formatMoney(pendingTarget.expected_amount, pendingTarget.currency)
                        : "—"}
                    </span>
                    <span>·</span>
                    <span className="tracking-[0.14em] uppercase text-[11px]">
                      {pendingTarget.enrollment_status}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="text-[12.5px] text-[var(--ink-mute)] leading-[1.6]">
                  No match suggested. Search for an enrolment below to assign this
                  transaction.
                </div>
              )}

              <div className="mt-3">
                <EnrollmentPicker
                  onSelect={(c) =>
                    setPendingTarget({
                      enrollment_id: c.enrollment_id,
                      participant_id: c.participant_id,
                      region_id: c.region_id,
                      name_en: c.name_en,
                      name_cn: c.name_cn,
                      event_title: c.event_title,
                      event_date: c.event_date,
                      expected_amount: c.price,
                      currency: c.currency,
                      payment_status: c.payment_status,
                      enrollment_status: c.status,
                    })
                  }
                />
              </div>
              {row.note ? (
                <div className="mt-3 text-[11.5px] text-[var(--ink-mute)] leading-[1.6]">
                  Note · {row.note}
                </div>
              ) : null}
            </div>

            <div className="flex flex-col items-stretch gap-2 min-w-[160px]">
              <button
                type="button"
                disabled={busy || !pendingTarget}
                onClick={async () => {
                  const ok = await patch({
                    action: "confirm",
                    enrollment_id: pendingTarget?.enrollment_id,
                  });
                  if (ok) setOpen(false);
                }}
                className="inline-flex items-center justify-center h-9 px-4 rounded-[var(--radius-pill)]
                           border border-[var(--cinnabar)]/40 bg-[var(--cinnabar)] text-[var(--paper-warm)]
                           text-[12px] tracking-[0.04em] font-medium
                           hover:bg-[var(--cinnabar-deep)]
                           focus-visible:shadow-[var(--shadow-focus)]
                           disabled:opacity-40 disabled:cursor-not-allowed
                           transition-[background-color,opacity] duration-[var(--dur-fast)]"
              >
                Confirm match
              </button>
              {pendingTarget ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setPendingTarget(null);
                    await patch({ action: "unmatch" });
                  }}
                  className="inline-flex items-center justify-center h-9 px-4 rounded-[var(--radius-pill)]
                             border border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-soft)]
                             text-[12px] tracking-[0.04em]
                             hover:bg-[var(--paper-deep)] hover:text-[var(--ink)]
                             focus-visible:shadow-[var(--shadow-focus)]
                             disabled:opacity-40 disabled:cursor-not-allowed
                             transition-[background-color,color] duration-[var(--dur-fast)]"
                >
                  Clear match
                </button>
              ) : null}
              <button
                type="button"
                disabled={busy}
                onClick={() => patch({ action: "ignore" })}
                className="inline-flex items-center justify-center h-9 px-4 rounded-[var(--radius-pill)]
                           border border-[var(--paper-shadow)] bg-transparent text-[var(--ink-mute)]
                           text-[12px] tracking-[0.04em]
                           hover:text-[var(--ink)]
                           focus-visible:shadow-[var(--shadow-focus)]
                           disabled:opacity-40 disabled:cursor-not-allowed
                           transition-[color] duration-[var(--dur-fast)]"
              >
                Ignore row
              </button>
            </div>
          </div>
          {error ? (
            <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--cinnabar)]/30 bg-[var(--cinnabar-wash)] px-3 py-2 text-[12px] text-[var(--cinnabar-deep)]">
              {error}
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function statusTone(s: TxnRow["status"]): { label: string; chip: string } {
  switch (s) {
    case "confirmed":
      return {
        label: "Confirmed · 已确认",
        chip: "border-[#5b9a5d]/30 bg-[#5b9a5d]/8 text-[#3a6b3b]",
      };
    case "auto_matched":
      return {
        label: "Auto · 自动",
        chip: "border-[var(--cinnabar)]/25 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]",
      };
    case "suggested":
      return {
        label: "Suggested · 建议",
        chip: "border-[var(--gold)]/35 bg-[var(--gold-soft)] text-[var(--ink)]",
      };
    case "ignored":
      return {
        label: "Ignored · 忽略",
        chip: "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-mute)]",
      };
    case "unmatched":
    default:
      return {
        label: "Unmatched · 待配",
        chip: "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink)]",
      };
  }
}
