"use client";

import { useState } from "react";

// Fetches a fresh short-lived signed URL on click, then opens it. Keeps
// download links from going stale on a long-open submissions page.

export function SubmissionFileLink({
  fileId,
  filename,
  bytes,
}: {
  fileId: string;
  filename: string;
  bytes: number | null;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  async function open() {
    setBusy(true);
    setErr(false);
    try {
      const res = await fetch(`/api/admin/submission-files/${fileId}/url`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.url) throw new Error("failed");
      window.open(json.url, "_blank", "noopener,noreferrer");
    } catch {
      setErr(true);
    } finally {
      setBusy(false);
    }
  }

  const size =
    bytes && bytes > 0
      ? bytes < 1024 * 1024
        ? `${(bytes / 1024).toFixed(0)} KB`
        : `${(bytes / 1024 / 1024).toFixed(1)} MB`
      : "";

  return (
    <button
      type="button"
      onClick={open}
      disabled={busy}
      className="inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1.5 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-soft)] hover:border-[var(--cinnabar)]/40 hover:text-[var(--cinnabar-deep)] disabled:opacity-50 transition-colors"
    >
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M8 2v8M4.5 6.5L8 10l3.5-3.5M3 13h10" />
      </svg>
      <span className="truncate max-w-[200px]">{err ? "Retry" : filename}</span>
      {size ? <span className="text-[var(--ink-faint)] tabular-nums">{size}</span> : null}
    </button>
  );
}
