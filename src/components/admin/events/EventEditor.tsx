"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type {
  EventStatus,
  EventType,
  EventMode,
} from "@/lib/events-shared";
import { STATUS_LABEL, TYPE_LABEL } from "@/lib/events-shared";
import { PAYMENT_METHODS } from "@/lib/event-update-schema";
import { PosterUploader } from "./PosterUploader";
import { EventFormBuilder } from "./EventFormBuilder";

export type EventFull = {
  id: string;
  slug: string;
  title_en: string | null;
  title_cn: string | null;
  heading_en: string | null;
  heading_cn: string | null;
  sub_heading_en: string | null;
  sub_heading_cn: string | null;
  body_en: string | null;
  body_cn: string | null;
  poster_url: string | null;
  gallery: string[];
  type: EventType;
  mode: EventMode;
  venue: string | null;
  city: string | null;
  country: string | null;
  start_date: string | null;
  end_date: string | null;
  arrival_day: string | null;
  departure_day: string | null;
  enrollment_opens_at: string | null;
  enrollment_closes_at: string | null;
  capacity: number | null;
  price: number | null;
  currency: string;
  payment_methods: string[];
  target_audience_filter: Record<string, unknown>;
  status: EventStatus;
  requires_approval: boolean;
  form_schema: Record<string, unknown>;
  bank_details: { en?: string; zh?: string } | null;
  // Transfer-list inputs — short hotel name for the airport generator +
  // designated hotel map (key→display name) for the flight-info dropdown.
  main_venue_hotel_name: string | null;
  designated_hotels: Record<string, string>;
  // Per-event override of the generator rules. Empty {} = use defaults
  // (lib/transfer/types.ts → DEFAULT_RULES).
  transfer_rules: TransferRulesDraft;
  // M6 grouping policy. seating_mode locks the floor-plan palette and
  // the grouping algorithm fork; group_size_min/max bound the LLM's
  // assignment search.
  seating_mode: "tables" | "cushions";
  group_size_min: number;
  group_size_max: number;
  // M7.1d — per-event check-in method. Drives which scanner UI the
  // /admin/events/[id]/check-in/scan page renders at the door.
  check_in_method: "qr" | "face" | "both";
  created_at: string;
  updated_at: string;
};

export type TransferRulesDraft = {
  consolidation_window_minutes?: number;
  departure_lead_hours?: number;
  coach_cutoff_hour_local?: number;
  coach_hotel_departure_local?: string;
  coach_rule_enabled?: boolean;
};

const RULE_DEFAULTS = {
  consolidation_window_minutes: 30,
  departure_lead_hours: 3,
  coach_cutoff_hour_local: 15,
  coach_hotel_departure_local: "12:00",
  coach_rule_enabled: true,
} as const;

const TYPES: EventType[] = [
  "retreat",
  "course",
  "single_class",
  "delivery_class",
  "other",
];
const ALL_STATUSES: EventStatus[] = ["draft", "open", "closed", "archived"];

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

// Normalize a possibly-null ISO datetime into an <input type="datetime-local">
// compatible string (local timezone, YYYY-MM-DDTHH:mm).
function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

type Props = {
  event: EventFull;
  canEdit: boolean;
  canDelete: boolean;
  enrollmentCount: number;
};

export function EventEditor({
  event,
  canEdit,
  canDelete,
  enrollmentCount,
}: Props) {
  const router = useRouter();
  const [draft, setDraft] = useState(event);
  const [saving, setSaving] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [targetFilterText, setTargetFilterText] = useState(
    JSON.stringify(event.target_audience_filter ?? {}, null, 2),
  );
  const [targetFilterError, setTargetFilterError] = useState<string | null>(
    null,
  );
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const statusMenuRef = useRef<HTMLDivElement>(null);

  // Keep poster_url + gallery in sync with the server: the PosterUploader
  // writes both via its own API + router.refresh(), bypassing draft. Without
  // this effect the draft would look "dirty" right after an upload.
  useEffect(() => {
    setDraft((d) => ({
      ...d,
      poster_url: event.poster_url,
      gallery: event.gallery,
    }));
  }, [event.poster_url, event.gallery]);

  useEffect(() => {
    if (!statusMenuOpen) return;
    function onDown(e: MouseEvent) {
      if (!statusMenuRef.current?.contains(e.target as Node)) {
        setStatusMenuOpen(false);
      }
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

  function update<K extends keyof EventFull>(key: K, value: EventFull[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    const res = await fetch(`/api/admin/events/${event.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      throw new Error(payload.error ?? `Save failed (${res.status})`);
    }
    return true;
  }

  async function onChangeStatus(next: EventStatus) {
    if (next === draft.status) {
      setStatusMenuOpen(false);
      return;
    }
    setStatusMenuOpen(false);
    setSavingStatus(true);
    setError(null);
    try {
      await patch({ status: next });
      update("status", next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Status update failed");
    } finally {
      setSavingStatus(false);
    }
  }

  async function onSave() {
    setError(null);
    setSuccess(null);
    setTargetFilterError(null);

    // Parse target_audience_filter JSON textarea
    let targetFilter: Record<string, unknown> = {};
    const trimmed = targetFilterText.trim();
    if (trimmed) {
      try {
        const parsed = JSON.parse(trimmed);
        if (
          typeof parsed !== "object" ||
          Array.isArray(parsed) ||
          parsed === null
        ) {
          throw new Error("Must be a JSON object.");
        }
        targetFilter = parsed;
      } catch (err) {
        setTargetFilterError(
          err instanceof Error ? err.message : "Invalid JSON",
        );
        return;
      }
    }

    setSaving(true);
    try {
      await patch({
        slug: draft.slug.trim(),
        title_en: draft.title_en,
        title_cn: draft.title_cn,
        heading_en: draft.heading_en,
        heading_cn: draft.heading_cn,
        sub_heading_en: draft.sub_heading_en,
        sub_heading_cn: draft.sub_heading_cn,
        body_en: draft.body_en,
        body_cn: draft.body_cn,
        // poster_url + gallery are owned by PosterUploader — not written here.
        type: draft.type,
        mode: draft.mode,
        venue: draft.venue,
        city: draft.city,
        country: draft.country,
        start_date: draft.start_date,
        end_date: draft.end_date,
        arrival_day: draft.arrival_day,
        departure_day: draft.departure_day,
        enrollment_opens_at: draft.enrollment_opens_at,
        enrollment_closes_at: draft.enrollment_closes_at,
        capacity: draft.capacity,
        price: draft.price,
        currency: draft.currency,
        payment_methods: draft.payment_methods,
        target_audience_filter: targetFilter,
        requires_approval: draft.requires_approval,
        bank_details: draft.bank_details ?? {},
        main_venue_hotel_name: draft.main_venue_hotel_name,
        designated_hotels: draft.designated_hotels ?? {},
        transfer_rules: draft.transfer_rules ?? {},
        seating_mode: draft.seating_mode,
        group_size_min: draft.group_size_min,
        group_size_max: draft.group_size_max,
        check_in_method: draft.check_in_method,
      });
      setSuccess("Saved");
      router.refresh();
      setTimeout(() => setSuccess(null), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    const ok = window.confirm(
      `Permanently delete "${draft.title_en || draft.title_cn || draft.slug}"? This cannot be undone.`,
    );
    if (!ok) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/events/${event.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? `Delete failed (${res.status})`);
      }
      router.push("/admin/events");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      setDeleting(false);
    }
  }

  const statusTone = STATUS_TONE[draft.status];
  const dirty = JSON.stringify(draft) !== JSON.stringify(event);
  const targetFilterDirty =
    targetFilterText.trim() !==
    JSON.stringify(event.target_audience_filter ?? {}, null, 2).trim();

  return (
    <div className="flex flex-col gap-6">
      {/* Header card */}
      <div className="rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)] p-6">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
              <span className="w-5 h-px bg-current" />
              Event · 活动
            </div>
            <h1 className="mt-3 font-display text-[32px] leading-[1.1] tracking-[-0.01em] text-[var(--ink)]">
              {draft.title_en || draft.title_cn || draft.slug}
            </h1>
            {draft.title_en && draft.title_cn ? (
              <div className="mt-1 text-[15px] text-[var(--ink-soft)]">
                {draft.title_en === draft.title_cn ? null : draft.title_cn}
              </div>
            ) : null}
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <span className="font-mono text-[11.5px] text-[var(--ink-faint)]">
                /events/{draft.slug}
              </span>
              <span className="text-[var(--ink-faint)]">·</span>
              <span className="text-[11px] tracking-[0.14em] uppercase text-[var(--ink-mute)]">
                {TYPE_LABEL[draft.type].en}
              </span>
              <span className="text-[var(--ink-faint)]">·</span>
              <span className="text-[11px] tracking-[0.14em] uppercase text-[var(--ink-mute)]">
                {draft.mode === "online" ? "Online" : "Offline"}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Enrollments link */}
            <Link
              href={`/admin/events/${event.id}/enrollments`}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-[var(--radius-pill)]
                         border border-[var(--paper-shadow)] bg-[var(--paper)]
                         text-[12.5px] tracking-[0.04em] text-[var(--ink)]
                         hover:border-[var(--cinnabar)]/40 hover:bg-[var(--cinnabar-wash)] hover:text-[var(--cinnabar-deep)]
                         focus-visible:shadow-[var(--shadow-focus)]
                         transition-[background-color,border-color,color] duration-[var(--dur-fast)]"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="8" cy="6" r="2.6" />
                <path d="M3 13.2a5 5 0 0 1 10 0" />
              </svg>
              Enrollments
              <span className="tabular-nums text-[10px] tracking-[0.06em] px-1.5 py-0.5 rounded-full bg-[var(--paper-deep)] text-[var(--ink-mute)]">
                {enrollmentCount.toLocaleString()}
              </span>
            </Link>

            {/* Groups link — M6 grouping + seating editor entry point */}
            <Link
              href={`/admin/events/${event.id}/groups`}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-[var(--radius-pill)]
                         border border-[var(--paper-shadow)] bg-[var(--paper)]
                         text-[12.5px] tracking-[0.04em] text-[var(--ink)]
                         hover:border-[var(--cinnabar)]/40 hover:bg-[var(--cinnabar-wash)] hover:text-[var(--cinnabar-deep)]
                         focus-visible:shadow-[var(--shadow-focus)]
                         transition-[background-color,border-color,color] duration-[var(--dur-fast)]"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="5" cy="6" r="2" />
                <circle cx="11" cy="6" r="2" />
                <path d="M2 13a3 3 0 0 1 6 0M8 13a3 3 0 0 1 6 0" />
              </svg>
              Groups
              <span className="tabular-nums text-[10px] tracking-[0.06em] px-1.5 py-0.5 rounded-full bg-[var(--paper-deep)] text-[var(--ink-mute)]">
                小组
              </span>
            </Link>

            {/* Check-in link — M7.1 QR + manual + live dashboard */}
            <Link
              href={`/admin/events/${event.id}/check-in`}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-[var(--radius-pill)]
                         border border-[var(--paper-shadow)] bg-[var(--paper)]
                         text-[12.5px] tracking-[0.04em] text-[var(--ink)]
                         hover:border-[var(--cinnabar)]/40 hover:bg-[var(--cinnabar-wash)] hover:text-[var(--cinnabar-deep)]
                         focus-visible:shadow-[var(--shadow-focus)]
                         transition-[background-color,border-color,color] duration-[var(--dur-fast)]"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="2.5" y="2.5" width="4" height="4" rx="0.5" />
                <rect x="9.5" y="2.5" width="4" height="4" rx="0.5" />
                <rect x="2.5" y="9.5" width="4" height="4" rx="0.5" />
                <path d="M9.5 9.5h2v2M13.5 9.5v.01M9.5 13.5h.01M11.5 13.5h2" />
              </svg>
              Check-in
              <span className="tabular-nums text-[10px] tracking-[0.06em] px-1.5 py-0.5 rounded-full bg-[var(--paper-deep)] text-[var(--ink-mute)]">
                签到
              </span>
            </Link>

            {/* Floor plan link — M6.4 Visio-style layout editor */}
            <Link
              href={`/admin/events/${event.id}/layout`}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-[var(--radius-pill)]
                         border border-[var(--paper-shadow)] bg-[var(--paper)]
                         text-[12.5px] tracking-[0.04em] text-[var(--ink)]
                         hover:border-[var(--cinnabar)]/40 hover:bg-[var(--cinnabar-wash)] hover:text-[var(--cinnabar-deep)]
                         focus-visible:shadow-[var(--shadow-focus)]
                         transition-[background-color,border-color,color] duration-[var(--dur-fast)]"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="2" y="2" width="12" height="12" rx="1" />
                <circle cx="6" cy="6" r="1.4" />
                <rect x="9" y="9" width="3" height="3" rx="0.5" />
              </svg>
              Floor plan
              <span className="tabular-nums text-[10px] tracking-[0.06em] px-1.5 py-0.5 rounded-full bg-[var(--paper-deep)] text-[var(--ink-mute)]">
                平面
              </span>
            </Link>

            {/* Status picker */}
            <div ref={statusMenuRef} className="relative">
            <button
              type="button"
              onClick={() => canEdit && setStatusMenuOpen((p) => !p)}
              disabled={!canEdit || savingStatus}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-full border
                          text-[11px] tracking-[0.14em] uppercase
                          ${statusTone.bg} ${statusTone.ring} ${statusTone.text}
                          ${canEdit ? "hover:shadow-[0_2px_6px_rgba(0,0,0,0.04)] cursor-pointer" : "cursor-default"}
                          disabled:opacity-60
                          transition-shadow duration-[var(--dur-fast)]`}
              aria-haspopup="listbox"
              aria-expanded={statusMenuOpen}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${statusTone.dot}`} aria-hidden="true" />
              {STATUS_LABEL[draft.status].en}
              {canEdit ? (
                <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="opacity-70">
                  <path d="M2.5 4L5 6.5 7.5 4" />
                </svg>
              ) : null}
            </button>
            {statusMenuOpen ? (
              <ul
                role="listbox"
                className="absolute top-full right-0 mt-2 z-30 min-w-[200px]
                           rounded-[var(--radius-md)] border border-[var(--paper-shadow)]
                           bg-[var(--paper-warm)] shadow-[var(--shadow-paper-2)] py-1.5"
              >
                {ALL_STATUSES.map((s) => {
                  const tone = STATUS_TONE[s];
                  return (
                    <li key={s}>
                      <button
                        type="button"
                        onClick={() => onChangeStatus(s)}
                        role="option"
                        aria-selected={s === draft.status}
                        className={`w-full flex items-center justify-between gap-3 px-3 py-2 text-left
                                    transition-colors duration-[var(--dur-fast)]
                                    ${
                                      s === draft.status
                                        ? "bg-[var(--cinnabar-wash)]"
                                        : "hover:bg-[var(--paper-deep)]"
                                    }`}
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
          </div>
        </div>
      </div>

      {/* Content section */}
      <Section title="Content" titleZh="内容" description="Bilingual copy for the public page.">
        <Field label="Slug" labelZh="链接标识" required>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[12px] text-[var(--ink-faint)] flex-none">
              /events/
            </span>
            <input
              type="text"
              value={draft.slug}
              onChange={(e) => update("slug", e.target.value)}
              disabled={!canEdit}
              required
              className={inputCls("font-mono text-[12.5px]")}
            />
          </div>
        </Field>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field label="Title (EN)" labelZh="标题">
            <input type="text" value={draft.title_en ?? ""} onChange={(e) => update("title_en", e.target.value || null)} disabled={!canEdit} className={inputCls()} />
          </Field>
          <Field label="Title (中文)" labelZh="中文标题">
            <input type="text" value={draft.title_cn ?? ""} onChange={(e) => update("title_cn", e.target.value || null)} disabled={!canEdit} className={inputCls()} />
          </Field>

          <Field label="Heading (EN)" labelZh="主标题">
            <input type="text" value={draft.heading_en ?? ""} onChange={(e) => update("heading_en", e.target.value || null)} disabled={!canEdit} className={inputCls()} />
          </Field>
          <Field label="Heading (中文)" labelZh="主标题">
            <input type="text" value={draft.heading_cn ?? ""} onChange={(e) => update("heading_cn", e.target.value || null)} disabled={!canEdit} className={inputCls()} />
          </Field>

          <Field label="Sub-heading (EN)" labelZh="副标题">
            <input type="text" value={draft.sub_heading_en ?? ""} onChange={(e) => update("sub_heading_en", e.target.value || null)} disabled={!canEdit} className={inputCls()} />
          </Field>
          <Field label="Sub-heading (中文)" labelZh="副标题">
            <input type="text" value={draft.sub_heading_cn ?? ""} onChange={(e) => update("sub_heading_cn", e.target.value || null)} disabled={!canEdit} className={inputCls()} />
          </Field>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field label="Body (EN)" labelZh="正文" hint="Plain text or markdown — rendered on the public page.">
            <textarea rows={8} value={draft.body_en ?? ""} onChange={(e) => update("body_en", e.target.value || null)} disabled={!canEdit} className={textareaCls()} />
          </Field>
          <Field label="Body (中文)" labelZh="正文">
            <textarea rows={8} value={draft.body_cn ?? ""} onChange={(e) => update("body_cn", e.target.value || null)} disabled={!canEdit} className={textareaCls()} />
          </Field>
        </div>

        <Field
          label="Poster slideshow"
          labelZh="海报"
          hint="Drop images to build a slideshow. The first one is the hero — shown on the listing card, the top of the public event page, and in share previews. Uploads save immediately."
        >
          <PosterUploader
            eventId={event.id}
            initialImages={
              event.poster_url
                ? [
                    event.poster_url,
                    ...(event.gallery ?? []).filter(
                      (g) => g && g !== event.poster_url,
                    ),
                  ]
                : (event.gallery ?? []).filter(Boolean)
            }
            canEdit={canEdit}
          />
        </Field>
      </Section>

      {/* Logistics */}
      <Section title="Logistics" titleZh="安排" description="Type, venue, and date window.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field label="Type" labelZh="类型">
            <select value={draft.type} onChange={(e) => update("type", e.target.value as EventType)} disabled={!canEdit} className={inputCls()}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t].en} · {TYPE_LABEL[t].zh}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Mode" labelZh="形式">
            <select value={draft.mode} onChange={(e) => update("mode", e.target.value as EventMode)} disabled={!canEdit} className={inputCls()}>
              <option value="offline">Offline · 实体</option>
              <option value="online">Online · 线上</option>
            </select>
          </Field>

          <Field label="Venue" labelZh="场地">
            <input type="text" value={draft.venue ?? ""} onChange={(e) => update("venue", e.target.value || null)} disabled={!canEdit} className={inputCls()} />
          </Field>
          <Field label="City" labelZh="城市">
            <input type="text" value={draft.city ?? ""} onChange={(e) => update("city", e.target.value || null)} disabled={!canEdit} className={inputCls()} />
          </Field>
          <Field label="Country" labelZh="国家">
            <input type="text" value={draft.country ?? ""} onChange={(e) => update("country", e.target.value || null)} disabled={!canEdit} className={inputCls()} />
          </Field>
          <div />

          <Field label="Start date" labelZh="开始日期">
            <input type="date" value={draft.start_date ?? ""} onChange={(e) => update("start_date", e.target.value || null)} disabled={!canEdit} className={inputCls("font-mono text-[12.5px]")} />
          </Field>
          <Field label="End date" labelZh="结束日期">
            <input type="date" value={draft.end_date ?? ""} onChange={(e) => update("end_date", e.target.value || null)} disabled={!canEdit} className={inputCls("font-mono text-[12.5px]")} />
          </Field>

          <Field label="Arrival day" labelZh="抵场日" hint="Used by the airport transfer list to group arrivals within the 30-min consolidation window.">
            <input type="date" value={draft.arrival_day ?? ""} onChange={(e) => update("arrival_day", e.target.value || null)} disabled={!canEdit} className={inputCls("font-mono text-[12.5px]")} />
          </Field>
          <Field label="Departure day" labelZh="离场日" hint="Used by the airport transfer list for departure-coach grouping.">
            <input type="date" value={draft.departure_day ?? ""} onChange={(e) => update("departure_day", e.target.value || null)} disabled={!canEdit} className={inputCls("font-mono text-[12.5px]")} />
          </Field>

          <Field label="Enrollment opens" labelZh="开放报名">
            <input
              type="datetime-local"
              value={isoToLocalInput(draft.enrollment_opens_at)}
              onChange={(e) => update("enrollment_opens_at", localInputToIso(e.target.value))}
              disabled={!canEdit}
              className={inputCls("font-mono text-[12.5px]")}
            />
          </Field>
          <Field label="Enrollment closes" labelZh="截止报名">
            <input
              type="datetime-local"
              value={isoToLocalInput(draft.enrollment_closes_at)}
              onChange={(e) => update("enrollment_closes_at", localInputToIso(e.target.value))}
              disabled={!canEdit}
              className={inputCls("font-mono text-[12.5px]")}
            />
          </Field>
        </div>

        <div className="mt-2 pt-5 border-t border-dashed border-[var(--paper-shadow)] grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field
            label="Main venue hotel"
            labelZh="主场地酒店"
            hint="Short hotel name. Used by the airport transfer list (default drop-off + departure pickup) and the flight-info hotel dropdown. Distinct from the public Venue field above."
          >
            <input
              type="text"
              value={draft.main_venue_hotel_name ?? ""}
              onChange={(e) =>
                update("main_venue_hotel_name", e.target.value || null)
              }
              disabled={!canEdit}
              placeholder="St. Giles"
              className={inputCls()}
            />
          </Field>
          <Field
            label="Designated hotels"
            labelZh="指定酒店"
            hint="Extra hotels participants may stay at. Key is a slug (used internally on flight_info.hotel_key); name is what shows in the dropdown."
          >
            <DesignatedHotelsEditor
              value={draft.designated_hotels}
              onChange={(next) => update("designated_hotels", next)}
              disabled={!canEdit}
            />
          </Field>
        </div>

        <div className="mt-2 pt-5 border-t border-dashed border-[var(--paper-shadow)]">
          <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
            <span className="w-4 h-px bg-current" />
            Transfer rules · 接送规则
          </div>
          <p className="mt-2 text-[12px] leading-[1.6] text-[var(--ink-soft)] max-w-[62ch]">
            Per-event overrides for the airport-transfer generator. Leave a
            field blank to use the default. The generator merges defaults →
            event override → caller override at run time.
          </p>
          <TransferRulesEditor
            value={draft.transfer_rules ?? {}}
            onChange={(next) => update("transfer_rules", next)}
            disabled={!canEdit}
          />
        </div>

        <div className="mt-2 pt-5 border-t border-dashed border-[var(--paper-shadow)]">
          <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
            <span className="w-4 h-px bg-current" />
            Seating · 座位编排
          </div>
          <p className="mt-2 text-[12px] leading-[1.6] text-[var(--ink-soft)] max-w-[62ch]">
            Drives the M6 grouping algorithm + the floor-plan editor palette.
            Tables = round/square tables of 10–12 with 组长 + 1–2 副组长 per
            group. Cushions = meditation classes — participants are ranked by
            score and seated front-to-back, with 排长 at the leftmost and
            rightmost cushion of each row.{" "}
            <span className="text-[var(--ink-mute)]">
              Mode can&apos;t be changed once shapes or seat assignments exist
              for this event — clear the layout first.
            </span>
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(["tables", "cushions"] as const).map((mode) => {
              const checked = draft.seating_mode === mode;
              return (
                <label
                  key={mode}
                  className={`inline-flex items-center gap-2 h-9 px-3 rounded-[var(--radius-pill)] border text-[12px] tracking-[0.04em] cursor-pointer transition-[background-color,border-color,color] duration-[var(--dur-fast)]
                              ${
                                checked
                                  ? "border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
                                  : "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-soft)] hover:border-[var(--cinnabar)]/30"
                              }
                              ${!canEdit ? "cursor-not-allowed opacity-70" : ""}`}
                >
                  <input
                    type="radio"
                    name="seating-mode"
                    checked={checked}
                    onChange={() => canEdit && update("seating_mode", mode)}
                    disabled={!canEdit}
                    className="accent-[var(--cinnabar)]"
                  />
                  {mode === "tables" ? (
                    <>Tables · 桌子</>
                  ) : (
                    <>Cushions · 蒲团</>
                  )}
                </label>
              );
            })}
          </div>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-5">
            <Field
              label="Min group size"
              labelZh="最小组人数"
              hint="Lower bound on the number of people per group when generating. Most retreats run 10."
            >
              <input
                type="number"
                min={1}
                max={64}
                value={draft.group_size_min}
                onChange={(e) =>
                  update(
                    "group_size_min",
                    e.target.value === "" ? 1 : Number(e.target.value),
                  )
                }
                disabled={!canEdit || draft.seating_mode === "cushions"}
                className={inputCls("tabular-nums")}
              />
            </Field>
            <Field
              label="Max group size"
              labelZh="最大组人数"
              hint="Upper bound on the number of people per group. Default 12."
            >
              <input
                type="number"
                min={1}
                max={64}
                value={draft.group_size_max}
                onChange={(e) =>
                  update(
                    "group_size_max",
                    e.target.value === "" ? 1 : Number(e.target.value),
                  )
                }
                disabled={!canEdit || draft.seating_mode === "cushions"}
                className={inputCls("tabular-nums")}
              />
            </Field>
          </div>
          {draft.seating_mode === "cushions" ? (
            <p className="mt-2 text-[11px] text-[var(--ink-mute)]">
              Group size doesn&apos;t apply in cushion mode — every cushion seats
              exactly one person.
            </p>
          ) : null}
          {draft.group_size_min > draft.group_size_max ? (
            <p className="mt-2 text-[11.5px] text-[var(--cinnabar-deep)]">
              Min must be ≤ max.
            </p>
          ) : null}
        </div>

        {/* M7.1d — Per-event check-in method picker. Drives which scanner UI
            the /scan route renders at the door. */}
        <div className="mt-2 pt-5 border-t border-dashed border-[var(--paper-shadow)]">
          <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
            <span className="w-4 h-px bg-current" />
            Check-in method · 签到方式
          </div>
          <p className="mt-2 text-[12px] leading-[1.6] text-[var(--ink-soft)] max-w-[62ch]">
            How the door scanner identifies attendees. <strong>Face</strong> uses the
            participant&apos;s photo + face-api.js. <strong>QR</strong> reads the QR
            code embedded in the post-payment email. <strong>Both</strong> runs both
            detectors in parallel — whichever fires first wins.{" "}
            <span className="text-[var(--ink-mute)]">
              Face mode requires participants to opt in during registration + have a
              photo on file. Staff can capture photos at the door if missing.
            </span>
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(["face", "qr", "both"] as const).map((mode) => {
              const checked = draft.check_in_method === mode;
              return (
                <label
                  key={mode}
                  className={`inline-flex items-center gap-2 h-9 px-3 rounded-[var(--radius-pill)] border text-[12px] tracking-[0.04em] cursor-pointer transition-[background-color,border-color,color] duration-[var(--dur-fast)]
                              ${
                                checked
                                  ? "border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
                                  : "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-soft)] hover:border-[var(--cinnabar)]/30"
                              }
                              ${!canEdit ? "cursor-not-allowed opacity-70" : ""}`}
                >
                  <input
                    type="radio"
                    name="check-in-method"
                    checked={checked}
                    onChange={() =>
                      canEdit && update("check_in_method", mode)
                    }
                    disabled={!canEdit}
                    className="accent-[var(--cinnabar)]"
                  />
                  {mode === "face"
                    ? "Face · 人脸"
                    : mode === "qr"
                      ? "QR · 二维码"
                      : "Both · 双模"}
                </label>
              );
            })}
          </div>
        </div>
      </Section>

      {/* Commerce */}
      <Section title="Commerce" titleZh="费用" description="Pricing, capacity, and payment methods.">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <Field label="Capacity" labelZh="名额">
            <input
              type="number"
              min={0}
              value={draft.capacity ?? ""}
              onChange={(e) =>
                update("capacity", e.target.value === "" ? null : Number(e.target.value))
              }
              disabled={!canEdit}
              className={inputCls("tabular-nums")}
            />
          </Field>
          <Field label="Price" labelZh="价格">
            <input
              type="number"
              step="0.01"
              min={0}
              value={draft.price ?? ""}
              onChange={(e) =>
                update("price", e.target.value === "" ? null : Number(e.target.value))
              }
              disabled={!canEdit}
              className={inputCls("tabular-nums")}
            />
          </Field>
          <Field label="Currency" labelZh="货币">
            <input
              type="text"
              value={draft.currency}
              onChange={(e) => update("currency", e.target.value.toUpperCase().slice(0, 3))}
              disabled={!canEdit}
              maxLength={3}
              className={inputCls("font-mono uppercase")}
            />
          </Field>
        </div>

        <Field label="Payment methods" labelZh="支付方式">
          <div className="flex flex-wrap gap-2">
            {PAYMENT_METHODS.map((m) => {
              const checked = draft.payment_methods.includes(m);
              return (
                <label
                  key={m}
                  className={`inline-flex items-center gap-2 h-9 px-3 rounded-[var(--radius-pill)] border text-[12px] tracking-[0.04em] cursor-pointer transition-[background-color,border-color,color] duration-[var(--dur-fast)]
                              ${
                                checked
                                  ? "border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
                                  : "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-soft)] hover:border-[var(--cinnabar)]/30"
                              }
                              ${!canEdit ? "cursor-not-allowed opacity-70" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      if (!canEdit) return;
                      const next = e.target.checked
                        ? [...draft.payment_methods, m]
                        : draft.payment_methods.filter((x) => x !== m);
                      update("payment_methods", next);
                    }}
                    disabled={!canEdit}
                    className="accent-[var(--cinnabar)]"
                  />
                  {m === "hitpay"
                    ? "HitPay"
                    : m === "stripe"
                      ? "Stripe"
                      : m === "bank_transfer"
                        ? "Bank transfer"
                        : "TT"}
                </label>
              );
            })}
          </div>
        </Field>

        <Field label="Requires approval" labelZh="需审批" hint="If on, enrollments start as pending and must be manually approved.">
          <label className="inline-flex items-center gap-2 cursor-pointer text-[13px] text-[var(--ink)]">
            <input
              type="checkbox"
              checked={draft.requires_approval}
              onChange={(e) => update("requires_approval", e.target.checked)}
              disabled={!canEdit}
              className="accent-[var(--cinnabar)]"
            />
            {draft.requires_approval ? "Yes · manual approval" : "No · auto-approve"}
          </label>
        </Field>
      </Section>

      {/* Bank transfer instructions — rendered on the participant's /pay/<token> page */}
      <Section
        title="Bank transfer instructions"
        titleZh="银行转账说明"
        description="Shown on the participant's /pay/<token> page after approval. Leave blank to hide the bank panel on that page."
      >
        <div className="grid md:grid-cols-2 gap-5">
          <Field
            label="English"
            labelZh="英文"
            hint="Bank name · account holder · account number · SWIFT. Plain text, multi-line. Shown when payment_methods includes bank_transfer or tt."
          >
            <textarea
              rows={7}
              value={draft.bank_details?.en ?? ""}
              onChange={(e) =>
                update("bank_details", {
                  ...(draft.bank_details ?? {}),
                  en: e.target.value,
                })
              }
              disabled={!canEdit}
              placeholder={
                "Glorious Melodies Consultancy Pte Ltd\nDBS Bank · Account 123-456789-0\nSWIFT: DBSSSGSG"
              }
              className={textareaCls("font-mono text-[12.5px]")}
            />
          </Field>
          <Field label="中文" labelZh="Chinese" hint="同上 · 中文版。">
            <textarea
              rows={7}
              value={draft.bank_details?.zh ?? ""}
              onChange={(e) =>
                update("bank_details", {
                  ...(draft.bank_details ?? {}),
                  zh: e.target.value,
                })
              }
              disabled={!canEdit}
              placeholder={
                "Glorious Melodies Consultancy Pte Ltd\n星展银行 · 账号 123-456789-0\nSWIFT: DBSSSGSG"
              }
              className={textareaCls("font-mono text-[12.5px]")}
            />
          </Field>
        </div>
      </Section>

      {/* Registration form */}
      <Section
        title="Registration form"
        titleZh="报名表单"
        description="Custom questions participants see on /register. Saved independently from the main event fields."
      >
        <EventFormBuilder
          eventId={event.id}
          initial={event.form_schema}
          canEdit={canEdit}
        />
      </Section>

      {/* Target audience */}
      <Section title="Target audience" titleZh="目标学员" description="Filter DSL for WhatsApp blast + automated matching. JSON object keyed by participant column.">
        <Field
          label="target_audience_filter"
          hint={`Example: {"region": "MY", "influence_score": {"gte": 7}}. Leave as {} to target everyone.`}
        >
          <textarea
            rows={6}
            value={targetFilterText}
            onChange={(e) => {
              setTargetFilterText(e.target.value);
              setTargetFilterError(null);
            }}
            disabled={!canEdit}
            className={textareaCls("font-mono text-[12px]")}
          />
          {targetFilterError ? (
            <div className="mt-1.5 text-[11.5px] text-[var(--cinnabar-deep)]">
              {targetFilterError}
            </div>
          ) : null}
        </Field>
      </Section>

      {/* Save bar */}
      {canEdit ? (
        <div className="sticky bottom-4 z-10 rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)]/95 backdrop-blur shadow-[var(--shadow-paper-2)] p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-[11.5px] tracking-[0.14em] uppercase text-[var(--ink-mute)]">
            {dirty || targetFilterDirty
              ? <span className="text-[var(--cinnabar-deep)]">Unsaved changes</span>
              : "All changes saved"}
            {success ? (
              <span className="ml-3 text-[var(--jade-deep)]">· {success}</span>
            ) : null}
            {error ? (
              <span className="ml-3 text-[var(--cinnabar-deep)]">· {error}</span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/admin/events"
              className="inline-flex items-center gap-2 h-10 px-4 rounded-[var(--radius-pill)] text-[12.5px] text-[var(--ink-mute)] hover:text-[var(--ink)] hover:bg-[var(--paper-deep)] transition-[background-color,color] duration-[var(--dur-fast)]"
            >
              ← Back
            </Link>
            <button
              type="button"
              onClick={onSave}
              disabled={saving || (!dirty && !targetFilterDirty)}
              className={`inline-flex items-center gap-2 h-10 px-5 rounded-[var(--radius-pill)]
                          text-[13px] tracking-[0.04em] font-medium
                          transition-[background-color,color,transform] duration-[var(--dur-fast)]
                          focus-visible:shadow-[var(--shadow-focus)]
                          ${
                            !saving && (dirty || targetFilterDirty)
                              ? "bg-[var(--cinnabar)] text-[var(--paper-warm)] hover:bg-[var(--cinnabar-deep)] shadow-[0_4px_14px_rgba(37,99,235,0.25)] active:scale-[0.98]"
                              : "bg-[var(--paper-deep)] text-[var(--ink-faint)] cursor-not-allowed"
                          }`}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      ) : null}

      {/* Danger zone */}
      {canDelete ? (
        <div className="mt-4 rounded-[var(--radius-lg)] border border-[var(--cinnabar)]/25 bg-[var(--cinnabar-wash)]/40 p-5 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-[10px] tracking-[0.24em] uppercase text-[var(--cinnabar-deep)]">
              Danger zone · 危险操作
            </div>
            <div className="mt-1 text-[12.5px] text-[var(--ink-soft)]">
              Archive this event instead of deleting — enrollments reference
              this row. Deletion cascades irreversibly.
            </div>
          </div>
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-[var(--radius-pill)] border border-[var(--cinnabar)]/40 bg-[var(--paper)] text-[12.5px] text-[var(--cinnabar-deep)] hover:bg-[var(--cinnabar)] hover:text-[var(--paper-warm)] hover:border-[var(--cinnabar)] focus-visible:shadow-[var(--shadow-focus)] transition-[background-color,color,border-color] duration-[var(--dur-fast)] disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {deleting ? "Deleting…" : "Delete permanently"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Section({
  title,
  titleZh,
  description,
  children,
}: {
  title: string;
  titleZh: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)] p-6 flex flex-col gap-5">
      <header>
        <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
          <span className="w-5 h-px bg-current" />
          {title} · {titleZh}
        </div>
        {description ? (
          <p className="mt-2 text-[12.5px] leading-[1.7] text-[var(--ink-soft)] max-w-[62ch]">
            {description}
          </p>
        ) : null}
      </header>
      {children}
    </section>
  );
}

function Field({
  label,
  labelZh,
  hint,
  required,
  children,
}: {
  label: string;
  labelZh?: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="inline-flex items-center gap-2 text-[10px] tracking-[0.22em] uppercase text-[var(--ink-mute)]">
        {label}
        {labelZh ? (
          <span className="text-[var(--ink-faint)]/80 tracking-[0.14em] normal-case">
            {labelZh}
          </span>
        ) : null}
        {required ? (
          <span className="text-[var(--cinnabar)]" aria-hidden="true">·</span>
        ) : null}
      </span>
      {children}
      {hint ? (
        <span className="text-[11.5px] leading-[1.6] text-[var(--ink-faint)]">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

// Editor for the designated_hotels JSONB map. Renders as a list of
// (key, name) pairs with add/remove. Local row state is the source of
// truth — parent only receives the cleaned object via onChange, and the
// parent never feeds us back rebuilt rows. That avoids the empty-row
// vanish bug: a fresh `{key:"", name:""}` row that gets filtered out
// of the committed object would otherwise be wiped on the next parent
// re-render if we re-derived rows from `value`.
function DesignatedHotelsEditor({
  value,
  onChange,
  disabled,
}: {
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  disabled: boolean;
}) {
  type Row = { rowId: string; key: string; name: string };
  const [rows, setRows] = useState<Row[]>(() =>
    Object.entries(value ?? {}).map(([k, n], i) => ({
      rowId: `r${i}`,
      key: k,
      name: n,
    })),
  );

  function emit(next: Row[]) {
    const obj: Record<string, string> = {};
    for (const r of next) {
      const k = r.key.trim();
      const n = r.name.trim();
      if (!k || !n) continue;
      // Last write wins on duplicate keys — admin sees the conflict in the UI.
      obj[k] = n;
    }
    onChange(obj);
  }

  function updateRow(idx: number, patch: Partial<Row>) {
    const next = rows.slice();
    next[idx] = { ...next[idx], ...patch };
    setRows(next);
    emit(next);
  }

  function removeRow(idx: number) {
    const next = rows.slice();
    next.splice(idx, 1);
    setRows(next);
    emit(next);
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      { rowId: `r${Date.now()}`, key: "", name: "" },
    ]);
    // Don't emit here — empty rows contribute nothing until admin types.
  }

  return (
    <div className="flex flex-col gap-2">
      {rows.length === 0 ? (
        <p className="text-[12px] text-[var(--ink-faint)] italic">
          No designated hotels.
        </p>
      ) : null}
      {rows.map((r, i) => {
        const dupKey =
          r.key.trim() !== "" &&
          rows.findIndex((x) => x.key.trim() === r.key.trim()) !== i;
        return (
          <div key={r.rowId} className="flex items-center gap-2">
            <input
              type="text"
              value={r.key}
              onChange={(e) => updateRow(i, { key: e.target.value.toLowerCase() })}
              disabled={disabled}
              placeholder="cititel"
              className={`${inputCls("font-mono text-[12px] w-[160px]")} ${dupKey ? "border-[var(--cinnabar)]/40" : ""}`}
              aria-invalid={dupKey || undefined}
            />
            <input
              type="text"
              value={r.name}
              onChange={(e) => updateRow(i, { name: e.target.value })}
              disabled={disabled}
              placeholder="Cititel Penang"
              className={inputCls("flex-1")}
            />
            {!disabled ? (
              <button
                type="button"
                onClick={() => removeRow(i)}
                aria-label="Remove hotel"
                title="Remove hotel"
                className="inline-flex items-center justify-center w-9 h-9 rounded-[var(--radius-md)] text-[var(--ink-faint)] hover:text-[var(--cinnabar-deep)] hover:bg-[var(--paper-deep)]/60 transition-colors"
              >
                <span aria-hidden="true">✕</span>
              </button>
            ) : null}
          </div>
        );
      })}
      {!disabled ? (
        <button
          type="button"
          onClick={addRow}
          className="self-start inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-pill)] border border-dashed border-[var(--paper-shadow)] text-[11.5px] tracking-[0.06em] text-[var(--ink-soft)] hover:border-[var(--cinnabar)]/40 hover:text-[var(--cinnabar-deep)] transition-colors"
        >
          <span aria-hidden="true">＋</span>
          Add hotel
        </button>
      ) : null}
    </div>
  );
}

// Editor for events.transfer_rules JSONB. All fields optional — empty input
// removes the override and the generator falls back to its default. The hint
// next to each label shows the active default so admin knows what they're
// overriding.
function TransferRulesEditor({
  value,
  onChange,
  disabled,
}: {
  value: TransferRulesDraft;
  onChange: (next: TransferRulesDraft) => void;
  disabled: boolean;
}) {
  function patch<K extends keyof TransferRulesDraft>(
    key: K,
    next: TransferRulesDraft[K] | undefined,
  ) {
    const out: TransferRulesDraft = { ...value };
    if (next === undefined || next === null || next === ("" as never)) {
      delete out[key];
    } else {
      out[key] = next;
    }
    onChange(out);
  }

  const coachEnabled = value.coach_rule_enabled ?? RULE_DEFAULTS.coach_rule_enabled;

  return (
    <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-5">
      <Field
        label="Consolidation window"
        labelZh="合并窗口 (分钟)"
        hint={`Default: ${RULE_DEFAULTS.consolidation_window_minutes} min. Flights landing/taking off within this window combine into one vehicle.`}
      >
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={720}
            step={1}
            value={value.consolidation_window_minutes ?? ""}
            onChange={(e) =>
              patch(
                "consolidation_window_minutes",
                e.target.value === "" ? undefined : Number(e.target.value),
              )
            }
            disabled={disabled}
            placeholder={String(RULE_DEFAULTS.consolidation_window_minutes)}
            className={inputCls("tabular-nums w-[120px]")}
          />
          <span className="text-[12px] text-[var(--ink-mute)]">minutes</span>
        </div>
      </Field>

      <Field
        label="Departure lead time"
        labelZh="提前出发"
        hint={`Default: ${RULE_DEFAULTS.departure_lead_hours} hours before flight time. The generator subtracts this to compute the hotel-departure pickup.`}
      >
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            max={24}
            step={0.5}
            value={value.departure_lead_hours ?? ""}
            onChange={(e) =>
              patch(
                "departure_lead_hours",
                e.target.value === "" ? undefined : Number(e.target.value),
              )
            }
            disabled={disabled}
            placeholder={String(RULE_DEFAULTS.departure_lead_hours)}
            className={inputCls("tabular-nums w-[120px]")}
          />
          <span className="text-[12px] text-[var(--ink-mute)]">hours</span>
        </div>
      </Field>

      <div className="md:col-span-2 mt-1 pt-4 border-t border-dashed border-[var(--paper-shadow)]">
        <Field
          label="Departure-day coach rule"
          labelZh="送机日大巴规则"
          hint="When ON, late flights on departure day share a single coach pickup. When OFF, they fall back to the regular 30-min + lead-time consolidation."
        >
          <label className="inline-flex items-center gap-2 cursor-pointer text-[13px] text-[var(--ink)]">
            <input
              type="checkbox"
              checked={coachEnabled}
              onChange={(e) => patch("coach_rule_enabled", e.target.checked)}
              disabled={disabled}
              className="accent-[var(--cinnabar)]"
            />
            {coachEnabled
              ? "Enabled — late flights share a 12:00 coach"
              : "Disabled — every flight uses the lead-time rule"}
          </label>
        </Field>
      </div>

      {coachEnabled ? (
        <>
          <Field
            label="Coach cutoff hour"
            labelZh="大巴时段起点 (24h)"
            hint={`Default: ${RULE_DEFAULTS.coach_cutoff_hour_local}:00. Flights at or after this hour on departure day join the coach.`}
          >
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={23}
                step={1}
                value={value.coach_cutoff_hour_local ?? ""}
                onChange={(e) =>
                  patch(
                    "coach_cutoff_hour_local",
                    e.target.value === "" ? undefined : Number(e.target.value),
                  )
                }
                disabled={disabled}
                placeholder={String(RULE_DEFAULTS.coach_cutoff_hour_local)}
                className={inputCls("tabular-nums w-[120px]")}
              />
              <span className="text-[12px] text-[var(--ink-mute)]">:00 local</span>
            </div>
          </Field>

          <Field
            label="Coach pickup time"
            labelZh="大巴出发时间"
            hint={`Default: ${RULE_DEFAULTS.coach_hotel_departure_local}. Hotel departure time for the shared coach.`}
          >
            <input
              type="text"
              value={value.coach_hotel_departure_local ?? ""}
              onChange={(e) => patch("coach_hotel_departure_local", e.target.value)}
              disabled={disabled}
              placeholder={RULE_DEFAULTS.coach_hotel_departure_local}
              pattern="\\d{1,2}:\\d{2}"
              className={inputCls("font-mono tabular-nums w-[120px]")}
            />
          </Field>
        </>
      ) : null}
    </div>
  );
}

function inputCls(extra = ""): string {
  return `h-10 w-full px-3.5 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)]
          text-[13px] text-[var(--ink)] placeholder:text-[var(--ink-faint)]
          focus:border-[var(--cinnabar)]/50 focus:outline-none focus:shadow-[var(--shadow-focus)]
          disabled:opacity-70 disabled:cursor-not-allowed
          transition-[border-color,box-shadow] duration-[var(--dur-fast)] ${extra}`;
}

function textareaCls(extra = ""): string {
  return `w-full px-3.5 py-2.5 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)]
          text-[13px] leading-[1.65] text-[var(--ink)] placeholder:text-[var(--ink-faint)]
          focus:border-[var(--cinnabar)]/50 focus:outline-none focus:shadow-[var(--shadow-focus)]
          disabled:opacity-70 disabled:cursor-not-allowed
          transition-[border-color,box-shadow] duration-[var(--dur-fast)] resize-y ${extra}`;
}
