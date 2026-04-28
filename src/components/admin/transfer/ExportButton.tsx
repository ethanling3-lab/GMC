"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

// Triggers /api/admin/transfer-lists/[id]/export. The Google Sheet is
// auto-provisioned on first export. The route is currently a stub returning
// 503 until GMC_GOOGLE_SERVICE_ACCOUNT_JSON + GMC_PARENT_DRIVE_FOLDER_ID
// are set in Netlify.

export function ExportButton({
  listId,
  hasSheet,
}: {
  listId: string;
  hasSheet: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  async function fire() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/transfer-lists/${listId}/export`, {
        method: "POST",
      });
      const json = (await res.json()) as {
        error?: string;
        detail?: string;
        sheet_url?: string;
      };
      if (!res.ok) {
        setError(json.detail ?? json.error ?? "Export failed");
        return;
      }
      if (json.sheet_url) setUrl(json.sheet_url);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(false);
    }
  }

  const label = busy
    ? "Exporting…"
    : hasSheet
      ? "Re-export"
      : "Export to Sheet";

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={fire}
        disabled={busy}
        className="inline-flex items-center gap-2 h-9 px-4 rounded-[var(--radius-pill)] border border-[var(--cinnabar)]/30 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)] text-[12px] tracking-[0.1em] uppercase font-medium hover:bg-[var(--cinnabar)]/15 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {label}
      </button>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="text-[11px] tracking-[0.12em] uppercase text-[var(--cinnabar-deep)] hover:text-[var(--cinnabar)] transition-colors"
          style={{ color: "var(--cinnabar-deep)" }}
        >
          Open ↗
        </a>
      ) : null}
      {error ? (
        <span className="text-[11px] text-[var(--cinnabar-deep)]">{error}</span>
      ) : null}
    </div>
  );
}
