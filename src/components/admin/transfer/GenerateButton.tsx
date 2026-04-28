"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function GenerateButton({
  eventId,
  direction,
  hasExisting,
  hasFlights,
  variant = "primary",
}: {
  eventId: string;
  direction: "arrival" | "departure";
  hasExisting: boolean;
  hasFlights: boolean;
  variant?: "primary" | "ghost";
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fire() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/transfer-lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_id: eventId, direction }),
      });
      const json = (await res.json()) as { error?: string; detail?: string };
      if (!res.ok) {
        setError(json.detail ?? json.error ?? "Generate failed");
        return;
      }
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
        onClick={fire}
        className={cls}
        title={!hasFlights ? "No confirmed flights for this direction yet" : undefined}
      >
        {label}
      </button>
      {error ? (
        <span className="text-[11px] text-[var(--cinnabar-deep)]">{error}</span>
      ) : null}
    </div>
  );
}
