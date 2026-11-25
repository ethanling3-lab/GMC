"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// "Price check · 价格核对" on an event's enrollments page (Super Admin).
// Re-runs the price rules for every live enrollment and lists the ones whose
// stored price differs from today's result. Nothing changes until staff
// press "Apply" on a row and give a reason — each fix is audited.

type Mismatch = {
  enrollment_id: string;
  region_id: string | null;
  name: string;
  status: string;
  amount_paid: number | null;
  stored: { amount: number | null; tier_key: string | null; why: string };
  now: { amount: number | null; tier_key: string | null; why: string };
};

const btn =
  "inline-flex items-center h-9 px-4 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[12.5px] text-[var(--ink)] hover:border-[var(--cinnabar)]/40 hover:text-[var(--cinnabar-deep)] focus-visible:shadow-[var(--shadow-focus)] active:scale-[0.98] disabled:opacity-50 transition-[border-color,color,transform] duration-[var(--dur-fast)]";

export function PriceCheckPanel({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [result, setResult] = useState<{ checked: number; currency: string; mismatches: Mismatch[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const money = (n: number | null, c: string) =>
    n == null ? "—" : `${c} ${n.toLocaleString("en-SG", { maximumFractionDigits: 2 })}`;

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/price-check`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? `Price check failed (${res.status})`);
      setResult(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Price check failed");
    } finally {
      setBusy(false);
    }
  }

  async function apply(m: Mismatch) {
    const reason = window.prompt(
      `Re-price ${m.name} from ${money(m.stored.amount, result?.currency ?? "SGD")} to ${money(m.now.amount, result?.currency ?? "SGD")}?\nReason (kept in the audit log):`,
    );
    if (reason === null) return;
    if (reason.trim().length < 3) {
      setError("Give a short reason (3+ characters).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/enrollments/${m.enrollment_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reprice: true, price_reason: reason.trim() }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.detail ?? j.error ?? `Couldn't re-price (${res.status})`);
      router.refresh();
      await run();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Re-price failed");
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-[14px] font-medium text-[var(--ink)]">Price check · 价格核对</h2>
          <p className="mt-1 text-[12px] text-[var(--ink-mute)] max-w-[70ch]">
            Re-runs the price rules for everyone registered and lists anyone whose price would be different today, for
            example a programme added or expired since they registered. Nothing changes until you apply a fix.
          </p>
        </div>
        <button type="button" className={btn} disabled={busy} onClick={run}>
          {busy ? "Checking…" : result ? "Check again" : "Run price check"}
        </button>
      </div>

      {error ? <p className="mt-3 text-[12.5px] text-[var(--cinnabar-deep)]">{error}</p> : null}

      {result ? (
        result.mismatches.length === 0 ? (
          <p className="mt-4 text-[12.5px] text-[var(--ink-soft)]">
            ✓ All {result.checked} registrations match the rules.
          </p>
        ) : (
          <div className="mt-4">
            <p className="text-[12.5px] text-[#B45309]">
              {result.mismatches.length} of {result.checked} registrations would be priced differently today.
            </p>
            <ul className="mt-3 flex flex-col gap-2">
              {result.mismatches.map((m) => (
                <li
                  key={m.enrollment_id}
                  className="rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] px-4 py-3 flex items-start gap-4 flex-wrap"
                >
                  <div className="min-w-0 flex-1 text-[12.5px]">
                    <div className="text-[13px] text-[var(--ink)]">
                      {m.name}
                      {m.region_id ? <span className="ml-2 font-mono text-[11.5px] text-[var(--ink-mute)]">{m.region_id}</span> : null}
                      <span className="ml-2 text-[11px] text-[var(--ink-faint)]">{m.status}</span>
                    </div>
                    <div className="mt-1 text-[var(--ink-mute)]">
                      Now charged {money(m.stored.amount, result.currency)} — {m.stored.why}
                    </div>
                    <div className="mt-0.5 text-[var(--ink-soft)]">
                      Rules give {money(m.now.amount, result.currency)} — {m.now.why}
                    </div>
                    {m.amount_paid ? (
                      <div className="mt-0.5 text-[11.5px] text-[#B45309]">
                        Already paid {money(m.amount_paid, result.currency)} — check before changing.
                      </div>
                    ) : null}
                  </div>
                  <button type="button" className={btn} disabled={busy} onClick={() => apply(m)}>
                    Apply new price
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )
      ) : null}
    </section>
  );
}
