"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";

const TYPES: { code: string; label: string }[] = [
  { code: "retreat", label: "Retreat · 静修" },
  { code: "course", label: "Course · 课程" },
  { code: "single_class", label: "Single class · 单课" },
  { code: "delivery_class", label: "Delivery class · 交付课" },
  { code: "other", label: "Other · 其他" },
];

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function NewEventForm() {
  const router = useRouter();
  const [titleEn, setTitleEn] = useState("");
  const [titleCn, setTitleCn] = useState("");
  const [slug, setSlug] = useState("");
  const [slugDirty, setSlugDirty] = useState(false);
  const [type, setType] = useState("course");
  const [mode, setMode] = useState<"online" | "offline">("offline");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleTitleEnChange(v: string) {
    setTitleEn(v);
    if (!slugDirty) setSlug(slugify(v));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const finalSlug = slug.trim();
    if (!finalSlug) {
      setError("Slug is required.");
      return;
    }
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(finalSlug)) {
      setError(
        "Slug must be lowercase letters, numbers, and hyphens (no leading/trailing hyphen).",
      );
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/admin/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: finalSlug,
          title_en: titleEn.trim() || null,
          title_cn: titleCn.trim() || null,
          type,
          mode,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload.error ?? `Create failed (${res.status})`);
      }
      router.push(`/admin/events/${payload.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <div className="rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)] p-6 flex flex-col gap-5">
        <div>
          <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
            <span className="w-5 h-px bg-current" />
            New event · 新建
          </div>
          <h2 className="mt-3 font-display text-[24px] leading-[1.2] tracking-[-0.01em] text-[var(--ink)]">
            Start with the basics
          </h2>
          <p className="mt-2 text-[13px] leading-[1.7] text-[var(--ink-soft)] max-w-[60ch]">
            You can fill in the rest — pricing, venue, target audience,
            accommodations — after the event is created.
          </p>
        </div>

        <Field label="Title (English)" labelZh="标题">
          <input
            type="text"
            value={titleEn}
            onChange={(e) => handleTitleEnChange(e.target.value)}
            placeholder="GMC April 2026 — Philosophy & Cultivation"
            className="h-10 w-full px-3.5 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)]
                       text-[13.5px] text-[var(--ink)] placeholder:text-[var(--ink-faint)]
                       focus:border-[var(--cinnabar)]/50 focus:outline-none focus:shadow-[var(--shadow-focus)]
                       transition-[border-color,box-shadow] duration-[var(--dur-fast)]"
          />
        </Field>

        <Field label="Title (中文)" labelZh="中文标题">
          <input
            type="text"
            value={titleCn}
            onChange={(e) => setTitleCn(e.target.value)}
            placeholder="GMC 2026年4月 — 经典与修心"
            className="h-10 w-full px-3.5 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)]
                       text-[13.5px] text-[var(--ink)] placeholder:text-[var(--ink-faint)]
                       focus:border-[var(--cinnabar)]/50 focus:outline-none focus:shadow-[var(--shadow-focus)]
                       transition-[border-color,box-shadow] duration-[var(--dur-fast)]"
          />
        </Field>

        <Field
          label="Slug"
          labelZh="链接标识"
          hint="Used in the public URL. Auto-generated from the English title — edit freely."
          required
        >
          <div className="flex items-center gap-2">
            <span className="font-mono text-[12px] text-[var(--ink-faint)] flex-none">
              /events/
            </span>
            <input
              type="text"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugDirty(true);
              }}
              placeholder="gmc-apr-2026-penang"
              required
              className="flex-1 h-10 px-3.5 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)]
                         font-mono text-[12.5px] text-[var(--ink)] placeholder:text-[var(--ink-faint)]
                         focus:border-[var(--cinnabar)]/50 focus:outline-none focus:shadow-[var(--shadow-focus)]
                         transition-[border-color,box-shadow] duration-[var(--dur-fast)]"
            />
          </div>
        </Field>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field label="Type" labelZh="类型">
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="h-10 w-full px-3.5 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)]
                         text-[13px] text-[var(--ink)]
                         focus:border-[var(--cinnabar)]/50 focus:outline-none focus:shadow-[var(--shadow-focus)]"
            >
              {TYPES.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Mode" labelZh="形式">
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as "online" | "offline")}
              className="h-10 w-full px-3.5 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)]
                         text-[13px] text-[var(--ink)]
                         focus:border-[var(--cinnabar)]/50 focus:outline-none focus:shadow-[var(--shadow-focus)]"
            >
              <option value="offline">In-person · 实体</option>
              <option value="online">Online · 线上</option>
            </select>
          </Field>
        </div>

        {error ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--cinnabar)]/30 bg-[var(--cinnabar-wash)] px-4 py-3 text-[13px] leading-[1.6] text-[var(--cinnabar-deep)]">
            {error}
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Link
          href="/admin/events"
          className="inline-flex items-center gap-2 h-10 px-4 rounded-[var(--radius-pill)] text-[12.5px] text-[var(--ink-mute)] hover:text-[var(--ink)] hover:bg-[var(--paper-deep)] transition-[background-color,color] duration-[var(--dur-fast)]"
        >
          ← Cancel
        </Link>
        <button
          type="submit"
          disabled={saving}
          className={`inline-flex items-center gap-2.5 h-11 px-6 rounded-[var(--radius-pill)]
                      text-[13px] tracking-[0.04em] font-medium
                      transition-[background-color,color,box-shadow,transform] duration-[var(--dur-fast)]
                      focus-visible:shadow-[var(--shadow-focus)]
                      ${
                        !saving
                          ? "bg-[var(--cinnabar)] text-[var(--paper-warm)] hover:bg-[var(--cinnabar-deep)] shadow-[0_4px_14px_rgba(37,99,235,0.25)] active:scale-[0.98]"
                          : "bg-[var(--paper-deep)] text-[var(--ink-faint)] cursor-not-allowed"
                      }`}
        >
          {saving ? "Creating…" : "Create event →"}
        </button>
      </div>
    </form>
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
          <span className="text-[var(--cinnabar)]" aria-hidden="true">
            ·
          </span>
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
