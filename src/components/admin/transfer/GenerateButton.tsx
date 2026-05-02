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
  // When the API 409s on admin_edited rows we surface a confirm prompt
  // instead of silently force-overwriting.
  const [pendingForce, setPendingForce] = useState<{
    count: number;
  } | null>(null);

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
        setPendingForce({ count: json.edited_count ?? 0 });
        return;
      }
      if (!res.ok) {
        setError(json.detail ?? json.error ?? "Generate failed");
        return;
      }
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

  if (pendingForce) {
    return (
      <div className="flex flex-col gap-1.5 max-w-[280px]">
        <div className="text-[11.5px] text-[var(--ink-soft)] leading-[1.5]">
          Prior draft has{" "}
          <strong className="text-[var(--ink)]">
            {pendingForce.count} edited row
            {pendingForce.count === 1 ? "" : "s"}
          </strong>
          . Forcing regenerate will discard those overrides.
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => fire(true)}
            className="inline-flex items-center h-8 px-3 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] text-[var(--paper)] text-[11px] tracking-[0.1em] uppercase disabled:opacity-50 transition-colors"
          >
            {busy ? "…" : "Force regenerate"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setPendingForce(null)}
            className="inline-flex items-center h-8 px-3 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] text-[11px] tracking-[0.1em] uppercase text-[var(--ink-soft)] disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        disabled={busy || !hasFlights}
        onClick={() => fire(false)}
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
