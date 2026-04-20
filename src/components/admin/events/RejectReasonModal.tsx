"use client";

import { useEffect, useRef, useState } from "react";

export type RejectReasonValue = "no_seats" | "duplicate" | "unsuitable" | "other";

const REASONS: {
  value: RejectReasonValue;
  label: string;
  zh: string;
  hint: string;
}[] = [
  {
    value: "no_seats",
    label: "No seats available",
    zh: "名额已满",
    hint: "Tells the participant the session is full and invites them to a future event.",
  },
  {
    value: "duplicate",
    label: "Duplicate registration",
    zh: "重复报名",
    hint: "Closes the second submission for the same person.",
  },
  {
    value: "unsuitable",
    label: "Doesn't meet event criteria",
    zh: "未满足参与条件",
    hint: "Polite decline noting the session has specific criteria.",
  },
  {
    value: "other",
    label: "Other reason",
    zh: "其他原因",
    hint: "Free-text note included verbatim in the email.",
  },
];

type Props = {
  open: boolean;
  onCancel: () => void;
  onConfirm: (args: { reason: RejectReasonValue; note: string | null }) => void | Promise<void>;
  busy?: boolean;
  /** Number of rows the action will affect — drives the confirm button label. */
  count?: number;
};

export function RejectReasonModal({ open, onCancel, onConfirm, busy = false, count = 1 }: Props) {
  const [reason, setReason] = useState<RejectReasonValue>("no_seats");
  const [note, setNote] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);

  // Reset on open.
  useEffect(() => {
    if (!open) return;
    setReason("no_seats");
    setNote("");
  }, [open]);

  // Esc closes; click outside cancels.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
    }
    function onClick(e: MouseEvent) {
      if (busy) return;
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
        onCancel();
      }
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open, busy, onCancel]);

  if (!open) return null;

  const noteRequired = reason === "other";
  const noteValid = !noteRequired || note.trim().length > 0;

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-[60] flex items-center justify-center px-4 py-8 bg-[var(--ink)]/40 backdrop-blur-[2px]"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reject-modal-title"
        className="w-full max-w-[440px] rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-2)] overflow-hidden"
      >
        <div className="px-6 pt-6 pb-2">
          <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
            <span className="w-5 h-px bg-current" />
            Reject enrollment{count > 1 ? "s" : ""} · 拒绝
          </div>
          <h2
            id="reject-modal-title"
            className="mt-2 font-display text-[20px] leading-[1.25] tracking-[-0.005em] text-[var(--ink)]"
          >
            Why are you rejecting?
          </h2>
          <p className="mt-1 text-[12.5px] text-[var(--ink-mute)] leading-[1.55]">
            The participant{count > 1 ? "s" : ""} will receive an email + WhatsApp matching the reason.
          </p>
        </div>

        <fieldset className="px-6 py-4 grid gap-2">
          {REASONS.map((r) => {
            const selected = reason === r.value;
            return (
              <label
                key={r.value}
                className={`group flex items-start gap-3 px-3.5 py-3 rounded-[var(--radius-md)] cursor-pointer border
                            transition-[background-color,border-color] duration-[var(--dur-fast)]
                            ${
                              selected
                                ? "border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)]/60"
                                : "border-[var(--paper-shadow)] bg-[var(--paper)] hover:bg-[var(--paper-deep)]/55"
                            }`}
              >
                <input
                  type="radio"
                  name="reject_reason"
                  value={r.value}
                  checked={selected}
                  onChange={() => setReason(r.value)}
                  disabled={busy}
                  className="mt-1 accent-[var(--cinnabar)] cursor-pointer"
                />
                <div className="min-w-0">
                  <div className={`text-[13px] font-medium ${selected ? "text-[var(--cinnabar-deep)]" : "text-[var(--ink)]"}`}>
                    {r.label}
                    <span className="ml-2 text-[var(--ink-faint)] font-normal">· {r.zh}</span>
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-[var(--ink-mute)] leading-[1.5]">
                    {r.hint}
                  </div>
                </div>
              </label>
            );
          })}
        </fieldset>

        <div className={`px-6 ${noteRequired || note.trim() ? "pb-4" : "pb-2"}`}>
          <label className="block text-[10.5px] tracking-[0.22em] uppercase text-[var(--ink-mute)] mb-1.5">
            Note {noteRequired ? <span className="text-[var(--cinnabar)]">*</span> : <span className="text-[var(--ink-faint)] normal-case tracking-[0.06em]">(optional · added below the body)</span>}
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 500))}
            disabled={busy}
            rows={3}
            placeholder={noteRequired ? "Add a brief note for the participant" : "Optional context"}
            className="w-full rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] px-3 py-2.5 text-[13px] text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:outline-none focus:border-[var(--cinnabar)]/50 focus:shadow-[var(--shadow-focus)]"
          />
          <div className="mt-1 text-[10.5px] text-[var(--ink-faint)] text-right tabular-nums">
            {note.length} / 500
          </div>
        </div>

        <div className="px-6 py-4 border-t border-[var(--paper-shadow)] bg-[var(--paper)]/50 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="h-9 px-3.5 rounded-[var(--radius-pill)] text-[12px] tracking-[0.04em] text-[var(--ink-mute)] hover:text-[var(--ink)] hover:bg-[var(--paper-deep)] transition-colors duration-[var(--dur-fast)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm({ reason, note: note.trim() || null })}
            disabled={busy || !noteValid}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-[var(--radius-pill)] border border-[var(--cinnabar)]/40 bg-[var(--paper)] text-[12px] tracking-[0.04em] font-medium text-[var(--cinnabar-deep)] hover:bg-[var(--cinnabar)] hover:text-[var(--paper-warm)] hover:border-[var(--cinnabar)] transition-[background-color,color,border-color] duration-[var(--dur-fast)] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? (
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="animate-spin">
                <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
                <path d="M12.5 7a5.5 5.5 0 0 0-5.5-5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            ) : null}
            Reject {count > 1 ? `${count.toLocaleString()} ` : ""}&amp; notify
          </button>
        </div>
      </div>
    </div>
  );
}
