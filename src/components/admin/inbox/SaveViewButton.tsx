"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SavedViewFilters } from "@/lib/inbox/saved-views-types";
import {
  hasActiveFilters,
  validateSavedViewName,
} from "@/lib/inbox/saved-views-types";

// "+ Save view" pill rendered inside ActiveFilterStrip. Only renders when
// at least one filter is non-default — saving the empty default would
// be pointless. Uses window.prompt (matching the GroupBuilder pin
// pattern in the same admin) — keeps the surface tiny + avoids stealing
// vertical space in the already-cramped filter strip.

export function SaveViewButton({ filters, compact }: { filters: SavedViewFilters; compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!hasActiveFilters(filters)) return null;

  async function onClick() {
    setError(null);
    const raw = window.prompt(
      "Name this view · 命名 (1–60 chars)",
      defaultNameFor(filters),
    );
    if (raw === null) return; // user cancelled
    const validationErr = validateSavedViewName(raw);
    if (validationErr) {
      window.alert(validationErr);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/inbox/saved-views", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: raw.trim(), filters }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { detail?: string } | null;
        throw new Error(data?.detail ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed";
      setError(msg);
      window.alert(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title="Save this filter combo as a view · 保存当前筛选"
      className={[
        "inline-flex items-center gap-1 rounded-[var(--radius-pill)]",
        "border border-dashed border-[var(--cinnabar)]/40 bg-transparent text-[var(--cinnabar-deep)]",
        "hover:bg-[var(--cinnabar-wash)] hover:border-[var(--cinnabar)]",
        "transition-[background-color,border-color,color] duration-[var(--dur-fast)]",
        compact ? "h-5 px-1.5 text-[10px]" : "h-6 px-2 text-[10.5px]",
        busy ? "opacity-60 cursor-wait" : "",
      ].join(" ")}
      aria-label={error ? `Save view (last error: ${error})` : "Save view"}
    >
      <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
        <path d="M4.5 1.5v6M1.5 4.5h6" />
      </svg>
      <span className="truncate max-w-[120px]">{busy ? "Saving…" : "Save view"}</span>
    </button>
  );
}

// Suggest a useful default name from the active filters so admins can
// just hit Enter most of the time. E.g. "Unassigned · WhatsApp · #vip".
function defaultNameFor(f: SavedViewFilters): string {
  const parts: string[] = [];
  if (f.scope !== "mine") parts.push(capitalize(f.scope));
  if (f.channel) parts.push(capitalize(f.channel));
  if (f.status) parts.push(capitalize(f.status));
  if (f.lifecycle) parts.push(capitalize(f.lifecycle));
  if (f.tag) parts.push(`#${f.tag}`);
  if (f.q) parts.push(`"${f.q.slice(0, 20)}"`);
  return parts.slice(0, 4).join(" · ");
}

function capitalize(s: string): string {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
