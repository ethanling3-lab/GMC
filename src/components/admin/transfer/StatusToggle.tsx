"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function StatusToggle({
  listId,
  status,
}: {
  listId: string;
  status: "draft" | "final";
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next: "draft" | "final" = status === "final" ? "draft" : "final";
  const label = status === "final" ? "Revert to draft" : "Mark final";

  async function fire() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/transfer-lists/${listId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const json = (await res.json()) as { error?: string; detail?: string };
      if (!res.ok) {
        setError(json.detail ?? json.error ?? "Update failed");
        return;
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        disabled={busy}
        onClick={fire}
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[11px] tracking-[0.1em] uppercase text-[var(--ink-soft)] hover:text-[var(--ink)] hover:border-[var(--cinnabar)]/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {busy ? "…" : label}
      </button>
      {error ? (
        <span className="text-[11px] text-[var(--cinnabar-deep)]">{error}</span>
      ) : null}
    </div>
  );
}
