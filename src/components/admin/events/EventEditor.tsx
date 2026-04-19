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
  created_at: string;
  updated_at: string;
};

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
        poster_url: draft.poster_url,
        gallery: draft.gallery,
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
                {draft.mode === "online" ? "Online" : "In-person"}
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

        <Field label="Poster URL" labelZh="海报链接" hint="Use a CDN URL for now — uploader comes in a later slice.">
          <input type="url" value={draft.poster_url ?? ""} onChange={(e) => update("poster_url", e.target.value || null)} placeholder="https://…" disabled={!canEdit} className={inputCls("font-mono text-[12px]")} />
        </Field>

        <Field label="Gallery URLs" labelZh="图库" hint="One URL per line.">
          <textarea
            rows={4}
            value={draft.gallery.join("\n")}
            onChange={(e) =>
              update(
                "gallery",
                e.target.value
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean),
              )
            }
            disabled={!canEdit}
            className={textareaCls("font-mono text-[12px]")}
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
              <option value="offline">In-person · 实体</option>
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
