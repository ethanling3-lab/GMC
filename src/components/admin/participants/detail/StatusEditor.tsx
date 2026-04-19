"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ParticipantStatus } from "@/lib/participants-query";
import { STATUS_LABEL, StatusPill } from "./StatusPill";

const STATUSES: ParticipantStatus[] = [
  "new",
  "info_verified",
  "cs_enriched",
  "active",
  "inactive",
];

export function StatusEditor({
  participantId,
  initial,
}: {
  participantId: string;
  initial: ParticipantStatus;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [value, setValue] = useState<ParticipantStatus>(initial);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setValue(initial);
  }, [initial]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function change(next: ParticipantStatus) {
    setOpen(false);
    if (next === value) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/participants/${participantId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? `Update failed (${res.status})`);
      }
      setValue(next);
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Update failed";
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        disabled={saving}
        className="inline-flex items-center gap-1.5 focus-visible:shadow-[var(--shadow-focus)] rounded-full disabled:opacity-60 transition-opacity"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <StatusPill status={value} size="md" />
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="text-[var(--ink-mute)]"
        >
          <path d="M2.5 4L5 6.5 7.5 4" />
        </svg>
      </button>

      {open ? (
        <ul
          role="listbox"
          className="absolute top-full left-0 mt-2 z-20 min-w-[200px] rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-2)] py-1.5"
        >
          {STATUSES.map((s) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => change(s)}
                role="option"
                aria-selected={s === value}
                className={`w-full flex items-center justify-between gap-3 px-3 py-2 text-left
                            text-[12.5px] transition-colors duration-[var(--dur-fast)]
                            ${
                              s === value
                                ? "bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
                                : "text-[var(--ink-soft)] hover:bg-[var(--paper-deep)] hover:text-[var(--ink)]"
                            }`}
              >
                <StatusPill status={s} size="sm" />
                <span className="text-[10px] tracking-[0.18em] uppercase text-[var(--ink-faint)]">
                  {STATUS_LABEL[s].zh}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <div className="absolute top-full left-0 mt-2 rounded-[var(--radius-md)] border border-[var(--cinnabar)]/30 bg-[var(--cinnabar-wash)] px-3 py-1.5 text-[12px] text-[var(--cinnabar-deep)] whitespace-nowrap">
          {error}
        </div>
      ) : null}
    </div>
  );
}
