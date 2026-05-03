"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

// Pre-generation confirm dialog ensures admin sees which rules are about to
// apply (per-event override merged over defaults) plus the confirmed-flight
// count. Avoids the silent-default-rules trap where a generator quietly uses
// a 12:00 coach pickup that wasn't appropriate for this event.
//
// State machine:
//   idle → confirm dialog (idle click)
//        → pending-force prompt (server returned 409 edited_rows_present)
//   confirm dialog → fire(false)
//   pending-force   → fire(true)

type EffectiveRules = {
  consolidation_window_minutes: number;
  departure_lead_hours: number;
  coach_cutoff_hour_local: number;
  coach_hotel_departure_local: string;
  coach_rule_enabled: boolean;
};

export function GenerateButton({
  eventId,
  direction,
  hasExisting,
  hasFlights,
  variant = "primary",
  effectiveRules,
  confirmedFlightCount,
}: {
  eventId: string;
  direction: "arrival" | "departure";
  hasExisting: boolean;
  hasFlights: boolean;
  variant?: "primary" | "ghost";
  effectiveRules: EffectiveRules;
  confirmedFlightCount: number;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingForce, setPendingForce] = useState<{ count: number } | null>(null);

  useEffect(() => {
    if (!confirmOpen && !pendingForce) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setConfirmOpen(false);
        setPendingForce(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmOpen, pendingForce]);

  async function fire(force: boolean) {
    setBusy(true);
    setError(null);
    try {
      const url = `/api/admin/transfer-lists${force ? "?force=1" : ""}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_id: eventId, direction }),
      });
      const json = (await res.json()) as {
        error?: string;
        detail?: string;
        edited_count?: number;
      };
      if (res.status === 409 && json.error === "edited_rows_present") {
        setConfirmOpen(false);
        setPendingForce({ count: json.edited_count ?? 0 });
        return;
      }
      if (!res.ok) {
        setError(json.detail ?? json.error ?? "Generate failed");
        return;
      }
      setConfirmOpen(false);
      setPendingForce(null);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generate failed");
    } finally {
      setBusy(false);
    }
  }

  const label = busy
    ? hasExisting
      ? "Regenerating…"
      : "Generating…"
    : hasExisting
      ? "Regenerate"
      : "Generate";

  const cls =
    variant === "primary"
      ? "inline-flex items-center gap-2 h-9 px-4 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] text-[var(--paper)] text-[12px] tracking-[0.1em] uppercase font-medium hover:bg-[var(--cinnabar-deep)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      : "inline-flex items-center gap-2 h-8 px-3 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[11px] tracking-[0.1em] uppercase text-[var(--ink-soft)] hover:text-[var(--ink)] hover:border-[var(--cinnabar)]/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors";

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        disabled={busy || !hasFlights}
        onClick={() => setConfirmOpen(true)}
        className={cls}
        title={!hasFlights ? "No confirmed flights for this direction yet" : undefined}
      >
        {label}
      </button>
      {error ? (
        <span className="text-[11px] text-[var(--cinnabar-deep)]">{error}</span>
      ) : null}

      {/* Pre-generation confirm dialog */}
      {!confirmOpen ? null : (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="gen-confirm-title"
        >
          <div
            className="absolute inset-0 bg-[var(--ink)]/40 backdrop-blur-[1px]"
            onClick={() => !busy && setConfirmOpen(false)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-[480px] rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)]">
            <div className="px-6 pt-5 pb-4 border-b border-[var(--paper-shadow)]">
              <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
                <span className="w-4 h-px bg-current" />
                Confirm rules · 确认规则
              </div>
              <h2
                id="gen-confirm-title"
                className="mt-2 font-display text-[20px] leading-[1.2] tracking-[-0.01em] text-[var(--ink)]"
              >
                {hasExisting ? "Regenerate" : "Generate"} {direction === "arrival" ? "arrival" : "departure"} list
              </h2>
              <p className="mt-1.5 text-[12px] text-[var(--ink-mute)] leading-[1.55]">
                <strong className="text-[var(--ink)] tabular-nums">{confirmedFlightCount}</strong>{" "}
                confirmed {direction} flight{confirmedFlightCount === 1 ? "" : "s"}.
                Review the rules below before generating.
              </p>
            </div>

            <div className="px-6 py-5 flex flex-col gap-2">
              <RuleRow label="Consolidation window" value={`${effectiveRules.consolidation_window_minutes} min`} />
              <RuleRow label="Departure lead time" value={`${effectiveRules.departure_lead_hours} hours`} />
              <RuleRow
                label="Coach rule"
                value={
                  effectiveRules.coach_rule_enabled
                    ? `Enabled — ${effectiveRules.coach_hotel_departure_local} pickup, ≥${effectiveRules.coach_cutoff_hour_local}:00 cutoff`
                    : "Disabled — every flight uses lead time"
                }
                tone={effectiveRules.coach_rule_enabled ? "active" : "muted"}
              />
              <Link
                href={`/admin/events/${eventId}/edit`}
                className="self-start mt-2 inline-flex items-center gap-1 text-[11.5px] tracking-[0.04em] text-[var(--cinnabar-deep)] hover:text-[var(--cinnabar)] transition-colors"
                style={{ color: "var(--cinnabar-deep)" }}
              >
                Edit rules in event editor
                <span aria-hidden="true">↗</span>
              </Link>
              {error ? (
                <div className="mt-2 text-[11.5px] text-[var(--cinnabar-deep)] leading-[1.5]">
                  {error}
                </div>
              ) : null}
            </div>

            <div className="px-6 py-4 border-t border-[var(--paper-shadow)] flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={busy}
                className="inline-flex items-center h-8 px-3 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] text-[11px] tracking-[0.1em] uppercase text-[var(--ink-soft)] hover:text-[var(--ink)] disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => fire(false)}
                disabled={busy}
                className="inline-flex items-center h-8 px-4 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] text-[var(--paper)] text-[11px] tracking-[0.1em] uppercase font-medium hover:bg-[var(--cinnabar-deep)] disabled:opacity-50 transition-colors"
              >
                {busy ? "Generating…" : "Confirm + generate"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Force-regenerate prompt (after 409 from edited rows) */}
      {!pendingForce ? null : (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="gen-force-title"
        >
          <div
            className="absolute inset-0 bg-[var(--ink)]/40 backdrop-blur-[1px]"
            onClick={() => !busy && setPendingForce(null)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-[440px] rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)]">
            <div className="px-6 pt-5 pb-4 border-b border-[var(--paper-shadow)]">
              <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar-deep)]">
                <span className="w-4 h-px bg-current" />
                Force regenerate · 强制重生
              </div>
              <h2
                id="gen-force-title"
                className="mt-2 font-display text-[20px] leading-[1.2] tracking-[-0.01em] text-[var(--ink)]"
              >
                {pendingForce.count} edited row
                {pendingForce.count === 1 ? "" : "s"} will be discarded
              </h2>
              <p className="mt-1.5 text-[12px] text-[var(--ink-mute)] leading-[1.55]">
                The prior draft has manual overrides (vehicle / time / remark
                tweaks). Force regenerate rebuilds from scratch and wipes
                them.
              </p>
            </div>
            <div className="px-6 py-4 border-t border-[var(--paper-shadow)] flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingForce(null)}
                disabled={busy}
                className="inline-flex items-center h-8 px-3 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] text-[11px] tracking-[0.1em] uppercase text-[var(--ink-soft)] hover:text-[var(--ink)] disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => fire(true)}
                disabled={busy}
                className="inline-flex items-center h-8 px-4 rounded-[var(--radius-pill)] bg-[var(--cinnabar-deep)] text-[var(--paper)] text-[11px] tracking-[0.1em] uppercase font-semibold hover:bg-[#7a1a14] disabled:opacity-50 transition-colors"
              >
                {busy ? "…" : "Force regenerate"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RuleRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "active" | "muted";
}) {
  const valueCls =
    tone === "muted"
      ? "text-[var(--ink-mute)]"
      : "text-[var(--ink)]";
  return (
    <div className="flex items-baseline justify-between gap-3 px-3 py-2 rounded-[var(--radius-md)] bg-[var(--paper)]">
      <span className="text-[10.5px] tracking-[0.18em] uppercase text-[var(--ink-faint)]">
        {label}
      </span>
      <span className={`text-[12px] tabular-nums ${valueCls}`}>{value}</span>
    </div>
  );
}
