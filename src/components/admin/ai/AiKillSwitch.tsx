"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// The switch, and the ceiling.
//
// Everything on this card exists so that stopping the AI, or bounding what it
// can spend, never requires a deploy or a hand-written SQL statement executed
// by whoever happens to be awake.

type Props = {
  aiEnabled: boolean;
  dailyCostCapCents: number | null;
  spentTodayCents: number;
  canEdit: boolean;
};

export function AiKillSwitch({ aiEnabled, dailyCostCapCents, spentTodayCents, canEdit }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capInput, setCapInput] = useState(
    dailyCostCapCents === null ? "" : (dailyCostCapCents / 100).toFixed(2),
  );

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/ai/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const detail = (await res.json().catch(() => ({}))) as { detail?: string; error?: string };
        setError(detail.detail ?? detail.error ?? `Failed (${res.status})`);
        return;
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  const spentUsd = spentTodayCents / 100;
  const capUsd = dailyCostCapCents === null ? null : dailyCostCapCents / 100;
  const pct = capUsd === null ? 0 : Math.min(100, (spentUsd / capUsd) * 100);
  const atCap = capUsd !== null && spentUsd >= capUsd;

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)] overflow-hidden">
      {/* Kill switch */}
      <div className="px-6 py-5 flex items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
            <span className="w-4 h-px bg-current" />
            Master switch · 总开关
          </div>
          <div className="mt-2 font-display text-[22px] leading-[1.2] tracking-[-0.01em] text-[var(--ink)]">
            {aiEnabled ? "AI is answering" : "AI is stopped"}
          </div>
          <p className="mt-1.5 text-[13px] leading-[1.6] text-[var(--ink-soft)] max-w-[54ch]">
            {aiEnabled
              ? "Threads with AI switched on will get automatic replies. Turning this off stops every AI reply everywhere, immediately — conversations stay open and staff answer by hand."
              : "No AI replies are being sent on any thread. Inbound messages still arrive and alert as normal; they simply wait for a person."}
          </p>
          {/* Never claim "instant" — other instances read a 20s memo. */}
          <p className="mt-2 text-[11.5px] text-[var(--ink-faint)]">
            Takes effect within 20 seconds across all servers.
          </p>
        </div>

        <button
          type="button"
          disabled={!canEdit || busy || pending}
          onClick={() => patch({ ai_enabled: !aiEnabled })}
          aria-pressed={aiEnabled}
          className={`flex-none inline-flex items-center justify-center h-10 px-5 rounded-[var(--radius-pill)]
                      text-[13px] tracking-[0.02em] font-medium
                      transition-[background-color,color,border-color] duration-[var(--dur-fast)]
                      disabled:opacity-50 disabled:cursor-not-allowed
                      ${
                        aiEnabled
                          ? "border border-[#C2410C]/40 bg-[#C2410C]/8 text-[#9A3412] hover:bg-[#C2410C]/14"
                          : "border border-[var(--cinnabar)]/40 bg-[var(--cinnabar)] text-[var(--paper-warm)] hover:bg-[var(--cinnabar-deep)]"
                      }`}
        >
          {busy ? "Saving…" : aiEnabled ? "Stop the AI" : "Start the AI"}
        </button>
      </div>

      <div className="h-px bg-[var(--paper-shadow)] mx-6" />

      {/* Spend cap */}
      <div className="px-6 py-5">
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <div className="text-[13px] text-[var(--ink)]">
            Spent today
            <span className="ml-2 font-display text-[20px] tabular-nums tracking-[-0.01em]">
              ${spentUsd.toFixed(2)}
            </span>
            {capUsd !== null ? (
              <span className="ml-1.5 text-[13px] text-[var(--ink-mute)] tabular-nums">
                of ${capUsd.toFixed(2)}
              </span>
            ) : null}
          </div>

          {atCap ? (
            <span className="inline-flex items-center h-[22px] px-2.5 rounded-[var(--radius-pill)] border border-[#C2410C]/40 bg-[#C2410C]/10 text-[10px] tracking-[0.18em] uppercase text-[#9A3412]">
              Cap reached — AI paused
            </span>
          ) : null}
        </div>

        {capUsd !== null ? (
          <div className="mt-2.5 h-1.5 rounded-full bg-[var(--paper-deep)] overflow-hidden">
            <div
              className={`h-full rounded-full transition-[width] duration-[var(--dur-base)] ${
                atCap ? "bg-[#C2410C]" : "bg-[var(--cinnabar)]"
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
        ) : (
          <p className="mt-2 text-[12.5px] leading-[1.6] text-[#9A3412]">
            No daily cap set. Nothing bounds what the AI can spend in a day — a
            burst of messages from unknown numbers has no ceiling.
          </p>
        )}

        {canEdit ? (
          <div className="mt-4 flex items-end gap-3 flex-wrap">
            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] tracking-[0.18em] uppercase text-[var(--ink-faint)]">
                Daily cap (USD)
              </span>
              <input
                type="number"
                min="0.01"
                step="0.50"
                value={capInput}
                onChange={(e) => setCapInput(e.target.value)}
                placeholder="No cap"
                className="h-9 w-[140px] px-3 rounded-[var(--radius-md)] border border-[var(--paper-shadow)]
                           bg-[var(--paper)] text-[13px] tabular-nums text-[var(--ink)]
                           focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
              />
            </label>
            <button
              type="button"
              disabled={busy || pending}
              onClick={() => {
                const trimmed = capInput.trim();
                if (trimmed === "") {
                  void patch({ daily_cost_cap_cents: null });
                  return;
                }
                const usd = Number(trimmed);
                if (!Number.isFinite(usd) || usd <= 0) {
                  setError("Enter a positive amount, or clear the field for no cap.");
                  return;
                }
                void patch({ daily_cost_cap_cents: Math.round(usd * 100) });
              }}
              className="h-9 px-4 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)]
                         bg-[var(--paper)] text-[12.5px] text-[var(--ink-soft)]
                         hover:bg-[var(--paper-deep)] hover:text-[var(--ink)]
                         disabled:opacity-50 disabled:cursor-not-allowed
                         transition-[background-color,color] duration-[var(--dur-fast)]"
            >
              Save cap
            </button>
          </div>
        ) : null}

        {error ? (
          <div className="mt-3 rounded-[var(--radius-md)] border border-[#C2410C]/40 bg-[#C2410C]/8 px-3 py-2 text-[12px] text-[#9A3412]">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}
