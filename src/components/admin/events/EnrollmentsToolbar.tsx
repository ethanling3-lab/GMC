"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { EnrollmentStatus } from "@/lib/enrollments-shared";
import { CurateZuZhangDialog } from "./CurateZuZhangDialog";

type Props = {
  eventId: string;
  initialQ: string;
  statusFilter: EnrollmentStatus | null;
  matched: number;
  hasQ: boolean;
};

export function EnrollmentsToolbar({
  eventId,
  initialQ,
  statusFilter,
  matched,
  hasQ,
}: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const [q, setQ] = useState(initialQ);
  const [isPending, startTransition] = useTransition();
  const firstRun = useRef(true);

  // Reflect outside-driven URL changes (tab switches, browser back/forward).
  useEffect(() => {
    const urlQ = sp.get("q") ?? "";
    if (urlQ !== q) setQ(urlQ);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp]);

  // Debounce q → URL. First render shouldn't push (server already matched).
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const t = setTimeout(() => {
      const next = new URLSearchParams(sp.toString());
      const trimmed = q.trim();
      if (trimmed) next.set("q", trimmed);
      else next.delete("q");
      const qs = next.toString();
      const base = `/admin/events/${eventId}/enrollments`;
      startTransition(() => {
        router.push(qs ? `${base}?${qs}` : base);
      });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  function exportCsv() {
    const next = new URLSearchParams();
    if (statusFilter) next.set("status", statusFilter);
    const trimmed = q.trim();
    if (trimmed) next.set("q", trimmed);
    const qs = next.toString();
    const base = `/api/admin/events/${eventId}/enrollments/export`;
    window.location.href = qs ? `${base}?${qs}` : base;
  }

  return (
    <div className="mt-5 flex flex-wrap items-center gap-3">
      <div
        className="flex-1 min-w-[260px] flex items-center gap-2.5 h-10 px-3.5 rounded-[var(--radius-pill)]
                   border border-[var(--paper-shadow)] bg-[var(--paper)]
                   focus-within:border-[var(--cinnabar)]/50 focus-within:shadow-[var(--shadow-focus)]
                   transition-[border-color,box-shadow] duration-[var(--dur-fast)]"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          aria-hidden="true"
          className="text-[var(--ink-faint)] flex-none"
        >
          <circle cx="6" cy="6" r="4" />
          <path d="M9 9l3 3" />
        </svg>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, student ID, email, phone…"
          aria-label="Search enrollments"
          className="flex-1 bg-transparent outline-none text-[13px] text-[var(--ink)] placeholder:text-[var(--ink-faint)]"
        />
        {q ? (
          <button
            type="button"
            onClick={() => setQ("")}
            aria-label="Clear search"
            className="text-[var(--ink-faint)] hover:text-[var(--ink)] transition-colors duration-[var(--dur-fast)]"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M3 3l6 6M9 3l-6 6" />
            </svg>
          </button>
        ) : null}
      </div>

      {hasQ ? (
        <span className="text-[11px] tracking-[0.14em] uppercase text-[var(--ink-mute)] tabular-nums">
          {matched.toLocaleString()} match{matched === 1 ? "" : "es"}
        </span>
      ) : null}

      <span
        aria-hidden={!isPending}
        className={`inline-flex items-center gap-1.5 text-[11px] tracking-[0.14em] uppercase text-[var(--cinnabar)] transition-opacity duration-[var(--dur-fast)] ${isPending ? "opacity-100" : "opacity-0"}`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--cinnabar)] animate-pulse" aria-hidden="true" />
        Refreshing
      </span>

      <CurateZuZhangDialog
        eventId={eventId}
        trigger={(open) => (
          <button
            type="button"
            onClick={open}
            className="inline-flex items-center gap-2 h-9 px-3.5 rounded-[var(--radius-pill)]
                       border border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)]
                       text-[12px] tracking-[0.04em] text-[var(--cinnabar-deep)]
                       hover:bg-[var(--cinnabar)] hover:text-[var(--paper-warm)]
                       focus-visible:shadow-[var(--shadow-focus)]
                       transition-[background-color,color] duration-[var(--dur-fast)]"
            aria-label="Curate 组长 roster"
          >
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
              <circle cx="4" cy="4" r="2" />
              <path d="M1 11c0-2 1.5-3.5 3-3.5s3 1.5 3 3.5" />
              <circle cx="9" cy="5" r="1.5" />
              <path d="M7 11c0-1.5 1-2.5 2-2.5s2 1 2 2.5" />
            </svg>
            Curate 组长
          </button>
        )}
      />

      <button
        type="button"
        onClick={exportCsv}
        className="inline-flex items-center gap-2 h-9 px-3.5 rounded-[var(--radius-pill)]
                   border border-[var(--paper-shadow)] bg-[var(--paper)]
                   text-[12px] tracking-[0.04em] text-[var(--ink)]
                   hover:border-[var(--cinnabar)]/40 hover:bg-[var(--cinnabar-wash)] hover:text-[var(--cinnabar-deep)]
                   focus-visible:shadow-[var(--shadow-focus)]
                   transition-[background-color,color,border-color] duration-[var(--dur-fast)]"
        aria-label="Export current view as CSV"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 1.5v6M3.5 5L6 7.5 8.5 5" />
          <path d="M2 9.5v0.5a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-0.5" />
        </svg>
        Export CSV
      </button>
    </div>
  );
}
