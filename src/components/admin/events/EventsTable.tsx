"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  STATUS_LABEL,
  TYPE_LABEL,
  type EventMode,
  type EventStatus,
  type EventType,
} from "@/lib/events-shared";

export type EventRow = {
  id: string;
  slug: string;
  title_en: string | null;
  title_cn: string | null;
  type: EventType;
  mode: EventMode;
  status: EventStatus;
  venue: string | null;
  city: string | null;
  country: string | null;
  start_date: string | null;
  end_date: string | null;
  capacity: number | null;
  price: number | null;
  currency: string;
  updated_at: string;
};

type Props = {
  rows: EventRow[];
  hasFilters: boolean;
  canEdit: boolean;
  canCreate: boolean;
};

const STATUS_TONE: Record<
  EventStatus,
  { dot: string; bg: string; ring: string; text: string }
> = {
  draft: {
    dot: "bg-[var(--ink-faint)]",
    bg: "bg-[var(--paper)]",
    ring: "border-[var(--paper-shadow)]",
    text: "text-[var(--ink-mute)]",
  },
  open: {
    dot: "bg-[var(--jade)]",
    bg: "bg-[var(--jade-wash)]",
    ring: "border-[var(--jade)]/25",
    text: "text-[var(--jade-deep)]",
  },
  closed: {
    dot: "bg-[var(--cinnabar)]",
    bg: "bg-[var(--cinnabar-wash)]",
    ring: "border-[var(--cinnabar)]/25",
    text: "text-[var(--cinnabar-deep)]",
  },
  archived: {
    dot: "bg-[var(--ink)]",
    bg: "bg-[var(--paper-deep)]",
    ring: "border-[var(--ink-faint)]/40",
    text: "text-[var(--ink)]",
  },
};

const ALL_STATUSES: EventStatus[] = ["draft", "open", "closed", "archived"];

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDateRange(start: string | null, end: string | null): string {
  if (!start && !end) return "—";
  if (start && end && start !== end) {
    return `${formatDate(start)} → ${formatDate(end)}`;
  }
  return formatDate(start ?? end);
}

function title(r: EventRow): string {
  const en = r.title_en?.trim();
  const cn = r.title_cn?.trim();
  if (en && cn) return `${en} · ${cn}`;
  return en || cn || r.slug;
}

function formatPrice(price: number | null, currency: string): string {
  if (price === null || price === undefined) return "—";
  return `${currency} ${price.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

type BulkAction = "set_status" | "delete";
type Toast = { message: string } | null;

export function EventsTable({ rows, hasFilters, canEdit, canCreate }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<BulkAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const headerCheckboxRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const rowKey = useMemo(() => rows.map((r) => r.id).join("|"), [rows]);
  useEffect(() => {
    setSelected(new Set());
    setError(null);
  }, [rowKey]);

  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someOnPage = rows.some((r) => selected.has(r.id));
  const indeterminate = someOnPage && !allOnPage;

  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  useEffect(() => {
    if (!statusMenuOpen) return;
    function onDown(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setStatusMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setStatusMenuOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [statusMenuOpen]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allOnPage) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.id)));
  }

  async function postBulk(body: Record<string, unknown>): Promise<void> {
    const res = await fetch("/api/admin/events/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      throw new Error(
        payload.error ?? `Bulk ${String(body.action)} failed (${res.status})`,
      );
    }
  }

  async function runSetStatus(next: EventStatus) {
    if (selected.size === 0) return;
    setStatusMenuOpen(false);
    setBusy("set_status");
    setError(null);
    try {
      const ids = Array.from(selected);
      await postBulk({ action: "set_status", ids, status: next });
      const count = ids.length;
      setSelected(new Set());
      router.refresh();
      setToast({
        message: `${count.toLocaleString()} set to ${STATUS_LABEL[next].en}`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Set status failed");
    } finally {
      setBusy(null);
    }
  }

  async function runDelete() {
    if (selected.size === 0) return;
    const ok = window.confirm(
      `Permanently delete ${selected.size} event${selected.size === 1 ? "" : "s"}? This cannot be undone.`,
    );
    if (!ok) return;
    setBusy("delete");
    setError(null);
    try {
      const ids = Array.from(selected);
      await postBulk({ action: "delete", ids });
      setSelected(new Set());
      router.refresh();
      setToast({ message: `${ids.length.toLocaleString()} deleted` });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk delete failed");
    } finally {
      setBusy(null);
    }
  }

  const count = selected.size;

  return (
    <div
      className="mt-6 rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)]
                 shadow-[var(--shadow-paper-1)] overflow-hidden"
    >
      {count > 0 && canEdit ? (
        <div
          ref={menuRef}
          className="relative flex flex-wrap items-center gap-2 px-5 py-3 border-b border-[var(--paper-shadow)] bg-[var(--cinnabar-wash)]/60"
        >
          <div className="inline-flex items-center gap-2 text-[12px] text-[var(--cinnabar-deep)] mr-1">
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              aria-label="Clear selection"
              className="inline-flex items-center justify-center w-5 h-5 rounded-[4px] border border-[var(--cinnabar)]/40 bg-[var(--paper)] text-[var(--cinnabar)] hover:bg-[var(--cinnabar)]/10 transition-colors duration-[var(--dur-fast)]"
            >
              <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                <path d="M2.5 5h5" />
              </svg>
            </button>
            <span className="font-medium tabular-nums">
              {count.toLocaleString()} selected
            </span>
          </div>

          <div className="h-5 w-px bg-[var(--cinnabar)]/20" aria-hidden="true" />

          <div className="relative">
            <BulkButton
              label="Set status"
              caret
              onClick={() => setStatusMenuOpen((p) => !p)}
              busy={busy === "set_status"}
              disabled={busy !== null}
              active={statusMenuOpen}
            />
            {statusMenuOpen ? (
              <ul
                role="listbox"
                className="absolute top-full left-0 mt-2 z-30 min-w-[220px]
                           rounded-[var(--radius-md)] border border-[var(--paper-shadow)]
                           bg-[var(--paper-warm)] shadow-[var(--shadow-paper-2)] py-1.5"
              >
                {ALL_STATUSES.map((s) => {
                  const tone = STATUS_TONE[s];
                  return (
                    <li key={s}>
                      <button
                        type="button"
                        onClick={() => runSetStatus(s)}
                        role="option"
                        className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left
                                   transition-colors duration-[var(--dur-fast)]
                                   text-[var(--ink-soft)]
                                   hover:bg-[var(--paper-deep)] hover:text-[var(--ink)]"
                      >
                        <span
                          className={`inline-flex items-center gap-2 px-2 py-0.5 rounded-full border text-[10px] tracking-[0.14em] uppercase ${tone.bg} ${tone.ring} ${tone.text}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} aria-hidden="true" />
                          {STATUS_LABEL[s].en}
                        </span>
                        <span className="text-[10px] tracking-[0.18em] uppercase text-[var(--ink-faint)]">
                          {STATUS_LABEL[s].zh}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>

          <BulkButton
            label="Delete"
            onClick={runDelete}
            busy={busy === "delete"}
            disabled={busy !== null}
            tone="danger"
          />

          {error ? (
            <div className="ml-auto text-[12px] text-[var(--cinnabar-deep)] font-medium">
              {error}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-[13px] text-[var(--ink-soft)]">
          <thead className="bg-[var(--paper-deep)]/70 text-[9px] tracking-[0.22em] uppercase text-[var(--ink-mute)]">
            <tr>
              {canEdit ? (
                <th scope="col" className="w-10 pl-5 pr-2 py-3.5">
                  <input
                    ref={headerCheckboxRef}
                    type="checkbox"
                    checked={allOnPage}
                    onChange={toggleAll}
                    disabled={rows.length === 0}
                    aria-label="Select all on page"
                    className="w-3.5 h-3.5 accent-[var(--cinnabar)] cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                  />
                </th>
              ) : null}
              <th scope="col" className="px-5 py-3.5 font-medium">Title</th>
              <th scope="col" className="px-5 py-3.5 font-medium">Type</th>
              <th scope="col" className="px-5 py-3.5 font-medium">Where</th>
              <th scope="col" className="px-5 py-3.5 font-medium">Dates</th>
              <th scope="col" className="px-5 py-3.5 font-medium">Status</th>
              <th scope="col" className="px-5 py-3.5 font-medium text-right">Capacity</th>
              <th scope="col" className="px-5 py-3.5 font-medium text-right">Price</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={canEdit ? 8 : 7} className="px-6 py-16 text-center">
                  <div className="inline-flex flex-col items-center gap-3">
                    <span
                      className="inline-flex items-center justify-center w-10 h-10 rounded-full
                                 border border-[var(--paper-shadow)] bg-[var(--paper)]
                                 text-[var(--cinnabar)]"
                      aria-hidden="true"
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2.5" y="3.5" width="11" height="10" rx="1.4" />
                        <path d="M2.5 6.5h11" />
                        <path d="M5.5 2v3M10.5 2v3" />
                      </svg>
                    </span>
                    <div className="text-[13px] text-[var(--ink)]">
                      {hasFilters
                        ? "No events match these filters"
                        : "No events yet"}
                    </div>
                    <div className="text-[12px] text-[var(--ink-mute)] max-w-[44ch]">
                      {hasFilters
                        ? "Try widening the filters or clearing search."
                        : canCreate
                          ? "Create the first event — add bilingual titles, dates, pricing, and a target audience filter."
                          : "Ask a super admin to create the first event."}
                    </div>
                  </div>
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const tone = STATUS_TONE[r.status];
                const where = [r.venue, r.city, r.country]
                  .filter(Boolean)
                  .join(" · ");
                const isSelected = selected.has(r.id);
                return (
                  <tr
                    key={r.id}
                    className={`border-t border-[var(--paper-shadow)]
                               hover:bg-[var(--paper-deep)]/55
                               transition-colors duration-[var(--dur-fast)]
                               has-[a:focus-visible]:bg-[var(--paper-deep)]/55
                               ${isSelected ? "bg-[var(--cinnabar-wash)]/40" : ""}`}
                  >
                    {canEdit ? (
                      <td className="w-10 pl-5 pr-2 py-3.5">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRow(r.id)}
                          aria-label={`Select ${title(r)}`}
                          className="w-3.5 h-3.5 accent-[var(--cinnabar)] cursor-pointer"
                        />
                      </td>
                    ) : null}
                    <td className="px-5 py-3.5">
                      <Link
                        href={`/admin/events/${r.id}`}
                        className="block hover:text-[var(--cinnabar)] transition-colors duration-[var(--dur-fast)] focus-visible:shadow-[var(--shadow-focus)] rounded-sm"
                      >
                        <div className="text-[var(--ink)] font-medium">
                          {title(r)}
                        </div>
                        <div className="mt-0.5 font-mono text-[11px] text-[var(--ink-faint)]">
                          /{r.slug}
                        </div>
                      </Link>
                    </td>
                    <td className="px-5 py-3.5 text-[var(--ink-mute)]">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[12px] text-[var(--ink)]">
                          {TYPE_LABEL[r.type].en}
                        </span>
                        <span className="text-[10px] tracking-[0.14em] uppercase text-[var(--ink-faint)]">
                          {r.mode === "online" ? "Online" : "In-person"}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-[var(--ink-mute)] max-w-[220px] truncate">
                      {where || (
                        <span className="text-[var(--ink-faint)]">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-[var(--ink-mute)] whitespace-nowrap">
                      {formatDateRange(r.start_date, r.end_date)}
                    </td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full border
                                    text-[10px] tracking-[0.14em] uppercase
                                    ${tone.bg} ${tone.ring} ${tone.text}`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${tone.dot}`}
                          aria-hidden="true"
                        />
                        {STATUS_LABEL[r.status].en}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums">
                      {typeof r.capacity === "number" ? (
                        <span className="text-[var(--ink)]">
                          {r.capacity.toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-[var(--ink-faint)]">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-[var(--ink)]">
                      {formatPrice(r.price, r.currency)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {toast ? (
        <div
          role="status"
          aria-live="polite"
          className="toast-in fixed bottom-6 left-1/2 -translate-x-1/2 z-50
                     inline-flex items-center gap-4 pl-5 pr-2 py-2
                     rounded-[var(--radius-pill)]
                     bg-[var(--ink)] text-[var(--paper-warm)]
                     shadow-[0_12px_32px_rgba(11,41,84,0.28)]"
        >
          <span className="text-[13px] tracking-[0.02em]">{toast.message}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label="Dismiss"
            className="inline-flex items-center justify-center w-8 h-8 rounded-full text-[var(--paper-warm)]/70 hover:text-[var(--paper-warm)] hover:bg-[var(--paper-warm)]/10 transition-colors"
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
              <path d="M3 3l6 6M9 3l-6 6" />
            </svg>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function BulkButton({
  label,
  onClick,
  busy,
  disabled,
  tone = "default",
  caret = false,
  active = false,
}: {
  label: string;
  onClick: () => void;
  busy: boolean;
  disabled: boolean;
  tone?: "default" | "danger";
  caret?: boolean;
  active?: boolean;
}) {
  const base =
    "inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-pill)] text-[12px] tracking-[0.04em] font-medium border transition-[background-color,border-color,color] duration-[var(--dur-fast)] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:shadow-[var(--shadow-focus)]";
  const toneCls =
    tone === "danger"
      ? "border-[var(--cinnabar)]/40 bg-[var(--paper)] text-[var(--cinnabar-deep)] hover:bg-[var(--cinnabar)] hover:text-[var(--paper-warm)] hover:border-[var(--cinnabar)]"
      : active
        ? "border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
        : "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink)] hover:border-[var(--cinnabar)]/40 hover:bg-[var(--cinnabar-wash)] hover:text-[var(--cinnabar-deep)]";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-expanded={caret ? active : undefined}
      className={`${base} ${toneCls}`}
    >
      {busy ? (
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="animate-spin">
          <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
          <path d="M12.5 7a5.5 5.5 0 0 0-5.5-5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      ) : null}
      {label}
      {caret ? (
        <svg
          width="9"
          height="9"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="opacity-70"
        >
          <path d="M2.5 4L5 6.5 7.5 4" />
        </svg>
      ) : null}
    </button>
  );
}
