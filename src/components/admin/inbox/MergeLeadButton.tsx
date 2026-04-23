"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ParticipantPicker,
  type ParticipantHit,
} from "@/components/admin/events/ParticipantPicker";

// Button + modal for merging an inbox-auto-created lead into an existing
// participant. Lives in its own file so the server-rendered ParticipantCard
// stays server-side. Calls POST /api/admin/inbox/leads/[id]/merge which
// delegates to the merge_lead_into_participant RPC (migration 016).

export function MergeLeadButton({
  leadId,
  leadDisplay,
}: {
  leadId: string;
  /** Short label shown in the modal header (phone / name / "(unnamed)"). */
  leadDisplay: string;
}) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<ParticipantHit | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // Reset state when the modal closes so reopening starts fresh.
  useEffect(() => {
    if (!open) {
      setTarget(null);
      setError(null);
      setSending(false);
    }
  }, [open]);

  // Lock page scroll while the modal is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function submit() {
    if (!target || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/inbox/leads/${leadId}/merge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target_participant_id: target.id }),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        const detail = typeof body.detail === "string"
          ? (body.detail as string)
          : typeof body.error === "string"
            ? (body.error as string)
            : `Merge failed (${res.status})`;
        setError(detail);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[var(--radius-pill)]
                   border border-[var(--cinnabar)]/40 bg-[var(--cinnabar)] text-[var(--paper-warm)]
                   text-[10.5px] tracking-[0.12em] uppercase
                   hover:bg-[var(--cinnabar-deep)]
                   focus-visible:shadow-[var(--shadow-focus)]
                   transition-[background-color] duration-[var(--dur-fast)]"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 5h6M5.5 2.5L8 5 5.5 7.5" />
        </svg>
        Merge lead
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="merge-lead-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          {/* Scrim */}
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-[rgba(28,24,20,0.55)] backdrop-blur-[2px]
                       transition-opacity duration-[var(--dur-fast)]"
          />
          {/* Card */}
          <div
            className="relative w-full max-w-[520px] rounded-[var(--radius-lg)]
                       border border-[var(--paper-shadow)] bg-[var(--paper-warm)]
                       shadow-[var(--shadow-paper-2)]"
          >
            <div className="px-6 pt-5 pb-4 border-b border-[var(--paper-shadow)]">
              <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
                <span className="w-4 h-px bg-current" />
                Merge lead · 合并线索
              </div>
              <h2
                id="merge-lead-title"
                className="mt-2 font-display text-[20px] tracking-[-0.01em] text-[var(--ink)]"
              >
                Fold into existing participant
              </h2>
              <p className="mt-1.5 text-[12.5px] text-[var(--ink-mute)] leading-[1.55]">
                This lead (<span className="text-[var(--ink)] font-mono">{leadDisplay}</span>) will be folded into the participant you pick. All conversations and messages move over; the lead record is removed.
              </p>
            </div>

            <div className="px-6 py-5">
              <ParticipantPicker
                value={target}
                onPick={setTarget}
                extraSearchParams={{ exclude_status: "lead" }}
              />

              {error ? (
                <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--cinnabar)]/30 bg-[var(--cinnabar-wash)] px-3 py-2 text-[12px] text-[var(--cinnabar-deep)] break-words">
                  {error}
                </div>
              ) : null}
            </div>

            <div className="px-6 pb-5 pt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={sending}
                className="inline-flex items-center h-9 px-4 rounded-[var(--radius-pill)]
                           border border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-soft)]
                           text-[12px] tracking-[0.04em]
                           hover:text-[var(--ink)] hover:border-[var(--cinnabar)]/25
                           focus-visible:shadow-[var(--shadow-focus)]
                           disabled:opacity-40 disabled:cursor-not-allowed
                           transition-[border-color,color] duration-[var(--dur-fast)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={!target || sending}
                className="inline-flex items-center gap-2 h-9 px-4 rounded-[var(--radius-pill)]
                           border border-[var(--cinnabar)]/40 bg-[var(--cinnabar)] text-[var(--paper-warm)]
                           text-[12px] tracking-[0.04em] font-medium
                           hover:bg-[var(--cinnabar-deep)]
                           focus-visible:shadow-[var(--shadow-focus)]
                           disabled:opacity-40 disabled:cursor-not-allowed
                           transition-[background-color,opacity] duration-[var(--dur-fast)]"
              >
                {sending ? "Merging…" : "Merge lead"}
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M2 5.5h7M6 2l3 3.5-3 3.5" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
