"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// Drag-and-drop uploader for bank CSV/XLSX. Posts to /api/admin/finance/imports
// and routes the admin to the review screen on success.
//
// Matches the admin chrome: editorial eyebrow, cinnabar accents, warm paper
// card. Intentional drop-zone depth cue via inset shadow + dashed border;
// animated only on dragging state.

type Props = {
  compact?: boolean;
};

export function BankCsvUploader({ compact = false }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function submit(file: File) {
    setError(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/finance/imports", {
        method: "POST",
        body: fd,
      });
      const payload = await res.json().catch(() => ({}) as Record<string, unknown>);
      if (!res.ok) {
        const detail =
          typeof (payload as { detail?: unknown }).detail === "string"
            ? (payload as { detail: string }).detail
            : typeof (payload as { error?: unknown }).error === "string"
              ? (payload as { error: string }).error
              : `Upload failed (${res.status})`;
        setError(detail);
        setBusy(false);
        return;
      }
      const importId = (payload as { import_id?: string }).import_id;
      if (!importId) {
        setError("Unexpected response from server");
        setBusy(false);
        return;
      }
      startTransition(() => {
        router.push(`/admin/finance/imports/${importId}`);
        router.refresh();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setBusy(false);
    }
  }

  const working = busy || isPending;

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) submit(file);
      }}
      className={`relative rounded-[var(--radius-lg)] border transition-[background-color,border-color,box-shadow] duration-[var(--dur-base)] ease-[var(--ease-out)]
                  ${
                    dragging
                      ? "border-[var(--cinnabar)] bg-[var(--cinnabar-wash)] shadow-[var(--shadow-paper-2)]"
                      : "border-dashed border-[var(--paper-shadow)] bg-[var(--paper)]/60"
                  }
                  ${compact ? "px-6 py-6" : "px-8 py-10"}`}
    >
      <div className="flex items-start gap-5">
        <div
          aria-hidden="true"
          className="flex-none w-11 h-11 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)]
                     flex items-center justify-center text-[var(--cinnabar)]
                     shadow-[var(--shadow-paper-1)]"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 12V3" />
            <path d="M5 7l4-4 4 4" />
            <path d="M3 12v2.5A1.5 1.5 0 0 0 4.5 16h9a1.5 1.5 0 0 0 1.5-1.5V12" />
          </svg>
        </div>

        <div className="flex-1 min-w-0">
          <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
            <span className="w-4 h-px bg-current" />
            Bank import · 对账
          </div>
          <h3 className="mt-2 font-display text-[20px] leading-[1.2] tracking-[-0.01em] text-[var(--ink)]">
            Drop a bank CSV or XLSX here
          </h3>
          <p className="mt-2 text-[13px] leading-[1.6] text-[var(--ink-soft)] max-w-[56ch]">
            We'll auto-match against approved enrolments using reference, amount, and
            name similarity. Ambiguous rows go to a review queue.
          </p>

          <div className="mt-4 flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={working}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-[var(--radius-pill)]
                         border border-[var(--cinnabar)]/40 bg-[var(--cinnabar)] text-[var(--paper-warm)]
                         text-[12px] tracking-[0.04em] font-medium
                         hover:bg-[var(--cinnabar-deep)]
                         focus-visible:shadow-[var(--shadow-focus)]
                         disabled:opacity-50 disabled:cursor-not-allowed
                         transition-[background-color,opacity] duration-[var(--dur-fast)]"
            >
              {working ? "Parsing…" : "Choose file"}
            </button>
            <span className="text-[11px] tracking-[0.14em] uppercase text-[var(--ink-faint)]">
              CSV · XLSX · 5 MB max
            </span>
          </div>

          {error ? (
            <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--cinnabar)]/30 bg-[var(--cinnabar-wash)] px-4 py-2.5 text-[12.5px] leading-[1.55] text-[var(--cinnabar-deep)]">
              {error}
            </div>
          ) : null}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="sr-only"
        disabled={working}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) submit(file);
          if (inputRef.current) inputRef.current.value = "";
        }}
      />
    </div>
  );
}
