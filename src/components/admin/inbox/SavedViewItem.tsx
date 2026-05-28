"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SavedView } from "@/lib/inbox/saved-views-types";
import { savedViewHref } from "@/lib/inbox/saved-views-types";

// Single saved-view row in the inbox sidebar. Click the name to apply
// the filter combo (Link → URL navigation, server re-renders); hover
// reveals a ✕ to soft-delete. Two-click confirm: first click arms,
// second click fires the DELETE.

export function SavedViewItem({
  view,
  isActive,
}: {
  view: SavedView;
  isActive: boolean;
}) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!armed) {
      setArmed(true);
      // Auto-disarm after 3s of inactivity so a misclick doesn't sit waiting.
      setTimeout(() => setArmed(false), 3000);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/inbox/saved-views/${view.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      setBusy(false);
      setArmed(false);
    }
  }

  return (
    <li className="group/sv">
      <Link
        href={savedViewHref(view.filters)}
        aria-current={isActive ? "page" : undefined}
        className={[
          "flex items-center justify-between gap-2 px-3 py-2 rounded-[var(--radius-sm)]",
          "text-[12px] leading-[1.3] tracking-[-0.005em]",
          "transition-[background-color,color] duration-[var(--dur-fast)]",
          isActive
            ? "bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
            : "text-[var(--ink-mute)] hover:text-[var(--ink)] hover:bg-[var(--paper-deep)]/60",
        ].join(" ")}
      >
        <span className="flex-1 min-w-0 truncate font-display">{view.name}</span>
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          aria-label={armed ? "Confirm delete saved view" : "Delete saved view"}
          title={armed ? "Click again to confirm" : "Delete"}
          className={[
            "flex-none flex items-center justify-center w-4 h-4 rounded-full",
            "transition-[background-color,color,opacity] duration-[var(--dur-fast)]",
            armed
              ? "opacity-100 bg-[var(--cinnabar)] text-[var(--paper-warm)]"
              : "opacity-0 group-hover/sv:opacity-100 text-[var(--ink-faint)] hover:text-[var(--cinnabar)]",
            busy ? "opacity-50 cursor-wait" : "",
          ].join(" ")}
        >
          <svg width="7" height="7" viewBox="0 0 7 7" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
            <path d="M1.2 1.2l4.6 4.6M5.8 1.2l-4.6 4.6" />
          </svg>
        </button>
      </Link>
      {error ? (
        <div className="px-3 pb-1 text-[10px] text-[var(--cinnabar-deep)]">{error}</div>
      ) : null}
    </li>
  );
}
