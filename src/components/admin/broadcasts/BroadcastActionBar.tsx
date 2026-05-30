"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { BroadcastStatus } from "@/lib/broadcasts/types";

// Action bar shown to super/regional admins on the broadcast detail
// page. Cancel + Retry-failed are armable two-click confirms (same
// pattern as DeleteFlightButton in transfer-lists). Send-draft is a
// straight POST since the broadcast hasn't fired yet.

export function BroadcastActionBar({
  id,
  status,
}: {
  id: string;
  status: BroadcastStatus;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  async function call(action: "send" | "cancel" | "retry-failed"): Promise<void> {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/admin/broadcasts/${id}/${action}`, {
        method: "POST",
      });
      if (!res.ok && res.status !== 202) {
        const body = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(body.detail ?? `${action} failed (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `${action} failed`);
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  }

  function armOrFire(action: "cancel" | "retry-failed") {
    if (confirm === action) {
      void call(action);
    } else {
      setConfirm(action);
      setTimeout(() => setConfirm((c) => (c === action ? null : c)), 3000);
    }
  }

  const canSend = status === "draft" || status === "partial";
  const canCancel = status === "scheduled" || status === "sending" || status === "draft";
  const canRetry = status === "partial" || status === "failed";

  return (
    <div className="flex items-center gap-2">
      {error ? (
        <span className="text-[11px] text-[var(--cinnabar-deep)] mr-2 max-w-[300px] truncate">{error}</span>
      ) : null}
      {canSend ? (
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => call("send")}
          className="inline-flex items-center gap-2 px-3 h-9 rounded-[var(--radius-md)] bg-[var(--cinnabar)] text-[var(--paper-warm)] text-[11.5px] tracking-[0.1em] uppercase hover:bg-[var(--cinnabar-deep)] disabled:opacity-50 transition-colors"
          style={{ color: "var(--paper-warm)" }}
        >
          {busy === "send" ? "Sending…" : "Send now"}
        </button>
      ) : null}
      {canRetry ? (
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => armOrFire("retry-failed")}
          className={`inline-flex items-center gap-2 px-3 h-9 rounded-[var(--radius-md)] border text-[11.5px] tracking-[0.1em] uppercase transition-colors ${
            confirm === "retry-failed"
              ? "border-[var(--cinnabar)] bg-[var(--cinnabar)] text-[var(--paper-warm)] ring-2 ring-[var(--cinnabar)]/30"
              : "border-[var(--paper-shadow)] bg-[var(--paper-warm)] text-[var(--ink-soft)] hover:bg-[var(--paper-deep)]"
          }`}
          style={
            confirm === "retry-failed"
              ? { color: "var(--paper-warm)" }
              : { color: "var(--ink-soft)" }
          }
        >
          {confirm === "retry-failed" ? "Click again to confirm" : "Retry failed"}
        </button>
      ) : null}
      {canCancel ? (
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => armOrFire("cancel")}
          className={`inline-flex items-center gap-2 px-3 h-9 rounded-[var(--radius-md)] border text-[11.5px] tracking-[0.1em] uppercase transition-colors ${
            confirm === "cancel"
              ? "border-[var(--cinnabar-deep)] bg-[var(--cinnabar-deep)] text-[var(--paper-warm)] ring-2 ring-[var(--cinnabar-deep)]/30"
              : "border-[var(--paper-shadow)] bg-[var(--paper-warm)] text-[var(--ink-soft)] hover:bg-[var(--paper-deep)]"
          }`}
          style={
            confirm === "cancel"
              ? { color: "var(--paper-warm)" }
              : { color: "var(--ink-soft)" }
          }
        >
          {confirm === "cancel" ? "Click again to cancel" : "Cancel"}
        </button>
      ) : null}
    </div>
  );
}
