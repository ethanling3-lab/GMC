"use client";

import { useEffect, useRef, useState } from "react";
import type { Tag } from "@/lib/inbox/tags-types";
import { TagChip } from "../TagChip";
import { runBulk } from "./bulk-runner";

// Popover for bulk-applying or bulk-removing a tag on the selected
// conversations. Lazy-loads /api/admin/inbox/tags on first open. Click a
// chip → fan out the per-conversation request (parallel, capped) → show
// progress → auto-close on success.
//
// Errors are surfaced as a small count below the list so the admin knows
// which slice failed; the picker stays open so they can retry.

type Mode = "apply" | "remove";

export function BulkTagPicker({
  mode,
  ids,
  onClose,
  onDone,
}: {
  mode: Mode;
  ids: string[];
  onClose: () => void;
  onDone?: () => void;
}) {
  const [tags, setTags] = useState<Tag[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [failed, setFailed] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Lazy-load on mount.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/inbox/tags", { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as { tags: Tag[] };
        if (!cancelled) setTags(data.tags);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Failed to load tags.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Click-outside + Escape to close.
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!panelRef.current) return;
      if (busy) return;
      if (!panelRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [busy, onClose]);

  async function pick(tag: Tag) {
    if (busy) return;
    setBusy(true);
    setProgress({ done: 0, total: ids.length });
    setFailed(0);
    const result = await runBulk(
      ids,
      async (id) => {
        const path =
          mode === "apply"
            ? `/api/admin/inbox/${id}/tags`
            : `/api/admin/inbox/${id}/tags/${tag.slug}`;
        const res = await fetch(path, {
          method: mode === "apply" ? "POST" : "DELETE",
          credentials: "include",
          headers: mode === "apply" ? { "Content-Type": "application/json" } : undefined,
          body: mode === "apply" ? JSON.stringify({ slug: tag.slug }) : undefined,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(text || `HTTP ${res.status}`);
        }
      },
      {
        concurrency: 4,
        onProgress: (done, total) => setProgress({ done, total }),
      },
    );
    setBusy(false);
    setFailed(result.failed.length);
    if (result.failed.length === 0) {
      onDone?.();
      // Brief pause so admin sees the 100% state.
      setTimeout(() => onClose(), 320);
    }
  }

  const eyebrow = mode === "apply" ? "Apply tag · 加标签" : "Remove tag · 移除标签";
  const headline =
    mode === "apply"
      ? `Tag ${ids.length} conversation${ids.length === 1 ? "" : "s"}`
      : `Remove from ${ids.length} conversation${ids.length === 1 ? "" : "s"}`;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={eyebrow}
      className={[
        "absolute z-30 top-full mt-2 left-0",
        "w-[320px] max-w-[calc(100vw-2rem)]",
        "rounded-[var(--radius-md)] border border-[var(--paper-shadow)]",
        "bg-[var(--paper-warm)] shadow-[var(--shadow-paper-3)]",
        "toast-in",
      ].join(" ")}
    >
      <div className="px-4 pt-3.5 pb-3 border-b border-[var(--paper-shadow)]/70">
        <div className="text-[9.5px] tracking-[0.22em] uppercase text-[var(--cinnabar)]">
          {eyebrow}
        </div>
        <div className="mt-1 font-display text-[14.5px] text-[var(--ink)] tracking-[-0.005em]">
          {headline}
        </div>
      </div>

      <div className="px-3.5 py-3 max-h-[260px] overflow-y-auto">
        {loadError ? (
          <div className="text-[12px] text-[var(--cinnabar-deep)] py-2">
            Could not load tags — {loadError}
          </div>
        ) : tags === null ? (
          <div className="text-[11.5px] tracking-[0.04em] text-[var(--ink-faint)] py-2">
            Loading tags…
          </div>
        ) : tags.length === 0 ? (
          <div className="text-[11.5px] text-[var(--ink-mute)] py-2">
            No tags yet. Create one inside any thread first.
          </div>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <li key={t.slug}>
                <TagChip
                  label={t.label_en || t.slug}
                  color={t.color}
                  variant="ghost"
                  size="sm"
                  onClick={() => pick(t)}
                  title={`${t.label_en} · ${t.label_zh}`}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {(progress || failed > 0) && (
        <div className="px-4 py-2.5 border-t border-[var(--paper-shadow)]/70 bg-[var(--paper)]/60">
          {busy && progress ? (
            <div className="flex items-center justify-between text-[10.5px] tracking-[0.08em] uppercase text-[var(--ink-mute)] tabular-nums">
              <span>Applying…</span>
              <span>{progress.done} / {progress.total}</span>
            </div>
          ) : null}
          {!busy && failed > 0 ? (
            <div className="text-[11.5px] text-[var(--cinnabar-deep)]">
              {failed} failed — click a tag to retry.
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
