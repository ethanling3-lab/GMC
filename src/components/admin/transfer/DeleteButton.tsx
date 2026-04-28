"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function DeleteButton({ listId }: { listId: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fire() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/transfer-lists/${listId}`, {
        method: "DELETE",
      });
      const json = (await res.json()) as { error?: string; detail?: string };
      if (!res.ok) {
        setError(json.detail ?? json.error ?? "Delete failed");
        return;
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-pill)] border border-transparent text-[11px] tracking-[0.1em] uppercase text-[var(--ink-faint)] hover:text-[var(--cinnabar-deep)] hover:border-[var(--cinnabar)]/20 transition-colors"
      >
        Discard
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        disabled={busy}
        onClick={fire}
        className="inline-flex items-center h-8 px-3 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] text-[var(--paper)] text-[11px] tracking-[0.1em] uppercase disabled:opacity-50 transition-colors"
      >
        {busy ? "…" : "Confirm discard"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={busy}
        className="inline-flex items-center h-8 px-3 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] text-[11px] tracking-[0.1em] uppercase text-[var(--ink-soft)] transition-colors"
      >
        Cancel
      </button>
      {error ? (
        <span className="text-[11px] text-[var(--cinnabar-deep)]">{error}</span>
      ) : null}
    </div>
  );
}
