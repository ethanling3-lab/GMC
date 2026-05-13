"use client";

import { useEffect, useState } from "react";
import type { ProfileDeckPayload } from "@/lib/profile-deck/types";

// M6.8 export trigger that sits next to the CSV-export pill on the
// enrollments toolbar. Pulls the deck payload from the server, hands it
// to the client-side pptxgenjs renderer, downloads the .pptx, then
// fires-and-forgets the audit log POST.
//
// Layout toggle:
//   1×    — one widescreen slide per participant (presentation)
//   3-up  — 3 horizontal cards per A4 portrait page (paper-saver briefing)

type Props = {
  eventId: string;
  eventSlug: string;
};

type BusyPhase = "idle" | "loading" | "rendering";
type LayoutMode = "full" | "compact";

const LAYOUT_STORAGE_PREFIX = "gmc-profile-deck-layout:";

export function ProfileDeckExportButton({ eventId, eventSlug }: Props) {
  const [phase, setPhase] = useState<BusyPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [layout, setLayout] = useState<LayoutMode>("full");

  // Hydrate stored layout choice after mount to avoid SSR mismatch.
  useEffect(() => {
    try {
      const v = sessionStorage.getItem(`${LAYOUT_STORAGE_PREFIX}${eventId}`);
      if (v === "compact" || v === "full") setLayout(v);
    } catch {
      /* sessionStorage disabled — fall back to default */
    }
  }, [eventId]);

  function setLayoutPersisted(v: LayoutMode) {
    setLayout(v);
    try {
      sessionStorage.setItem(`${LAYOUT_STORAGE_PREFIX}${eventId}`, v);
    } catch {
      /* ignore */
    }
  }

  const busy = phase !== "idle";

  async function exportDeck() {
    setError(null);
    setPhase("loading");
    try {
      const res = await fetch(
        `/api/admin/events/${eventId}/profile-deck`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? `load_failed_${res.status}`);
      }
      const payload = (await res.json()) as ProfileDeckPayload;
      if (payload.rows.length === 0) {
        throw new Error("no_approved_enrollments");
      }

      setPhase("rendering");
      const { exportProfileDeckPptx } = await import(
        "@/lib/profile-deck/export-pptx"
      );
      const blob = await exportProfileDeckPptx(payload, { layout });

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const suffix = layout === "compact" ? "-3up" : "";
      a.download = `${eventSlug || eventId}-profile-deck${suffix}.pptx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      fetch(`/api/admin/events/${eventId}/profile-deck`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "pptx",
          participant_count: payload.rows.length,
          include_photos: true,
          layout,
        }),
      }).catch(() => {});
    } catch (err) {
      const msg = err instanceof Error ? err.message : "export_failed";
      setError(translateError(msg));
    } finally {
      setPhase("idle");
    }
  }

  return (
    <div className="inline-flex items-center gap-2">
      <div
        role="radiogroup"
        aria-label="Profile deck layout"
        className="inline-flex items-center h-9 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] p-0.5"
      >
        <LayoutOption
          active={layout === "full"}
          onClick={() => setLayoutPersisted("full")}
          title="One slide per participant"
        >
          1×
        </LayoutOption>
        <LayoutOption
          active={layout === "compact"}
          onClick={() => setLayoutPersisted("compact")}
          title="3 cards per A4 page (paper-saver)"
        >
          3-up
        </LayoutOption>
      </div>

      <button
        type="button"
        onClick={exportDeck}
        disabled={busy}
        aria-label="Export profile deck as PowerPoint"
        className="inline-flex items-center gap-2 h-9 px-3.5 rounded-[var(--radius-pill)]
                   border border-[var(--paper-shadow)] bg-[var(--paper)]
                   text-[12px] tracking-[0.04em] text-[var(--ink)]
                   hover:border-[var(--cinnabar)]/40 hover:bg-[var(--cinnabar-wash)] hover:text-[var(--cinnabar-deep)]
                   disabled:opacity-60 disabled:cursor-not-allowed
                   focus-visible:shadow-[var(--shadow-focus)]
                   transition-[background-color,color,border-color] duration-[var(--dur-fast)]"
      >
        {busy ? (
          <Spinner />
        ) : (
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="1.5" y="1.5" width="9" height="9" rx="1" />
            <path d="M3.8 6.2L5.4 7.8 8.2 4.5" />
          </svg>
        )}
        {phase === "loading"
          ? "Loading…"
          : phase === "rendering"
            ? "Rendering…"
            : "Profile deck · 名册"}
      </button>

      {error ? (
        <span
          role="alert"
          className="text-[11px] tracking-[0.04em] text-[var(--cinnabar-deep)]"
        >
          {error}
        </span>
      ) : null}
    </div>
  );
}

function LayoutOption({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      title={title}
      className={`inline-flex items-center h-7 px-2.5 rounded-[var(--radius-pill)] text-[11px] tracking-[0.04em] font-medium transition-[background-color,color] duration-[var(--dur-fast)]
        ${
          active
            ? "bg-[var(--cinnabar)] text-[var(--paper-warm)] shadow-[0_2px_6px_rgba(37,99,235,0.25)]"
            : "text-[var(--ink-mute)] hover:text-[var(--ink)]"
        }`}
    >
      {children}
    </button>
  );
}

function translateError(code: string): string {
  switch (code) {
    case "forbidden":
      return "No permission to export.";
    case "event_not_found":
      return "Event not found.";
    case "no_approved_enrollments":
      return "No approved enrollments yet.";
    default:
      return code.startsWith("load_failed") ? "Load failed — try again." : code;
  }
}

function Spinner() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      className="animate-spin"
    >
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
      <path
        d="M12.5 7a5.5 5.5 0 0 0-5.5-5.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
