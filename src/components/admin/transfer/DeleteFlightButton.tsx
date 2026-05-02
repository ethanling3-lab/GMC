"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";

// Per-flight-line delete affordance on the transfer-list detail page.
// Opens a modal that requires TWO explicit clicks: the primary button arms
// on first click ("Click again to confirm"), then fires DELETE on the
// second click. Hits the existing /api/admin/flight-info route.
//
// After delete, the row's flight_info_ids still references the now-missing
// id until the user clicks Regenerate — that's intentional, the action bar
// already surfaces Regenerate clearly.

export type DeleteFlightInitial = {
  enrollment_id: string;
  direction: "arrival" | "departure";
  participant_label: string;
  flight_summary: string;
};

export function DeleteFlightButton({ initial }: { initial: DeleteFlightInitial }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setArmed(false);
      setBusy(false);
      setError(null);
    }
  }, [open]);

  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Auto-disarm if admin pauses for >4s after first click — protects against
  // accidental double-tap that would otherwise sail through both stages.
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  async function onPrimary() {
    if (busy) return;
    if (!armed) {
      setArmed(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        enrollment_id: initial.enrollment_id,
        direction: initial.direction,
      });
      const res = await fetch(`/api/admin/flight-info?${qs.toString()}`, {
        method: "DELETE",
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        detail?: string;
      };
      if (!res.ok) {
        setError(json.detail ?? json.error ?? "Delete failed");
        setArmed(false);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setArmed(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Delete flight"
        aria-label="Delete flight"
        className="inline-flex items-center justify-center w-5 h-5 rounded-[var(--radius-sm)] text-[var(--ink-faint)] hover:text-[var(--cinnabar-deep)] hover:bg-[var(--paper-deep)]/60 transition-colors"
      >
        <span aria-hidden="true" className="text-[12px] leading-none">✕</span>
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="del-flight-title"
        >
          <div
            className="absolute inset-0 bg-[var(--ink)]/40 backdrop-blur-[1px]"
            onClick={() => !busy && setOpen(false)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-[440px] rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)]">
            <div className="px-6 pt-5 pb-4 border-b border-[var(--paper-shadow)]">
              <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar-deep)]">
                <span className="w-4 h-px bg-current" />
                Delete flight · 删除航班
              </div>
              <h2
                id="del-flight-title"
                className="mt-2 font-display text-[20px] leading-[1.2] tracking-[-0.01em] text-[var(--ink)]"
              >
                {initial.participant_label}
              </h2>
              <p className="mt-2 text-[12px] text-[var(--ink-soft)] leading-[1.55]">
                {initial.direction === "arrival" ? "Arrival · 接机" : "Departure · 送机"}
                {" · "}
                <span className="font-mono tabular-nums text-[var(--ink)]">
                  {initial.flight_summary}
                </span>
              </p>
            </div>
            <div className="px-6 py-5">
              <div className="rounded-[var(--radius-md)] border border-[var(--cinnabar)]/25 bg-[var(--cinnabar-wash)]/30 px-4 py-3 text-[12px] leading-[1.6] text-[var(--ink-soft)]">
                This removes the flight from the participant's record. They'll
                disappear from the transfer list after the next{" "}
                <strong className="text-[var(--ink)]">Regenerate</strong>.
                This cannot be undone.
              </div>
              {error ? (
                <div className="mt-3 text-[11.5px] text-[var(--cinnabar-deep)] leading-[1.5]">
                  {error}
                </div>
              ) : null}
            </div>
            <div className="px-6 py-4 border-t border-[var(--paper-shadow)] flex items-center justify-between gap-2">
              <span className="text-[10.5px] tracking-[0.14em] uppercase text-[var(--ink-faint)]">
                {armed ? "Armed — second click confirms" : "Two-click confirm"}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={busy}
                  className="inline-flex items-center h-8 px-3 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] text-[11px] tracking-[0.1em] uppercase text-[var(--ink-soft)] hover:text-[var(--ink)] disabled:opacity-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={onPrimary}
                  disabled={busy}
                  className={
                    armed
                      ? "inline-flex items-center h-8 px-4 rounded-[var(--radius-pill)] bg-[var(--cinnabar-deep)] text-[var(--paper)] text-[11px] tracking-[0.1em] uppercase font-semibold ring-2 ring-[var(--cinnabar)]/40 ring-offset-1 ring-offset-[var(--paper-warm)] hover:bg-[#7a1a14] disabled:opacity-50 transition-all"
                      : "inline-flex items-center h-8 px-4 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] text-[var(--paper)] text-[11px] tracking-[0.1em] uppercase font-medium hover:bg-[var(--cinnabar-deep)] disabled:opacity-50 transition-colors"
                  }
                >
                  {busy
                    ? "Deleting…"
                    : armed
                      ? "Click again to confirm"
                      : "Delete flight"}
                </button>
              </div>
            </div>
          </div>
        </div>,
            document.body,
          )
        : null}
    </>
  );
}
