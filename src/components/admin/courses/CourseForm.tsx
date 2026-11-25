"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  COURSE_COLOUR_SWATCHES,
  deriveCourseSlug,
  validateColour,
  validateCourseName,
  validateCourseSlug,
  validateShortLabel,
  type Course,
} from "@/lib/courses/types";

// Create / edit a course (migration 075). Slug is fixed once created.

type Props =
  | { mode: "create"; existing?: undefined }
  | { mode: "edit"; existing: Course };

const inputCls =
  "h-10 w-full px-3.5 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] " +
  "text-[13.5px] text-[var(--ink)] placeholder:text-[var(--ink-faint)] " +
  "focus:border-[var(--cinnabar)]/50 focus:outline-none focus:shadow-[var(--shadow-focus)] " +
  "transition-[border-color,box-shadow] duration-[var(--dur-fast)] disabled:opacity-60";

export function CourseForm({ mode, existing }: Props) {
  const router = useRouter();
  const isEdit = mode === "edit";
  const [slug, setSlug] = useState(existing?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(false);
  const [nameEn, setNameEn] = useState(existing?.name_en ?? "");
  const [nameCn, setNameCn] = useState(existing?.name_cn ?? "");
  const [shortLabel, setShortLabel] = useState(existing?.short_label ?? "");
  const [colour, setColour] = useState(existing?.colour ?? COURSE_COLOUR_SWATCHES[0]);
  const [description, setDescription] = useState(existing?.description ?? "");
  const [sortOrder, setSortOrder] = useState(existing ? String(existing.sort_order) : "0");
  const [active, setActive] = useState(existing?.active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleNameEn(v: string) {
    setNameEn(v);
    if (!isEdit && !slugTouched) setSlug(deriveCourseSlug(v) ?? "");
  }

  async function submit() {
    const v =
      (isEdit ? null : validateCourseSlug(slug))
      ?? validateCourseName(nameEn, "English name")
      ?? validateCourseName(nameCn, "Chinese name")
      ?? validateShortLabel(shortLabel)
      ?? validateColour(colour);
    if (v) {
      setError(v);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(isEdit ? `/api/admin/courses/${existing.id}` : "/api/admin/courses", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(isEdit ? {} : { slug: slug.trim() }),
          name_en: nameEn.trim(),
          name_cn: nameCn.trim(),
          short_label: shortLabel.trim(),
          colour,
          description: description.trim() || null,
          sort_order: Number(sortOrder) || 0,
          active,
        }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(b.detail ?? `Save failed (${res.status})`);
      }
      router.push("/admin/courses");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setSaving(false);
    }
  }

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)] p-6 flex flex-col gap-5 max-w-2xl">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <Field label="Chinese name" labelZh="中文名称" required>
          <input className={inputCls} value={nameCn} onChange={(e) => setNameCn(e.target.value)} placeholder="永不落空" />
        </Field>
        <Field label="English name" labelZh="英文名称" required>
          <input className={inputCls} value={nameEn} onChange={(e) => handleNameEn(e.target.value)} placeholder="The Infallible Power" />
        </Field>
        <Field label="Short label" labelZh="简称" hint="Shown on calendar bars, max 8 characters." required>
          <input className={inputCls} value={shortLabel} onChange={(e) => setShortLabel(e.target.value)} placeholder="永不落空" />
        </Field>
        <Field
          label="Slug"
          labelZh="标识"
          hint={isEdit ? "Locked after creation." : "Lowercase letters, digits, hyphens."}
          required
        >
          <input
            className={inputCls}
            value={slug}
            disabled={isEdit}
            onChange={(e) => {
              setSlug(e.target.value);
              setSlugTouched(true);
            }}
            placeholder="infallible-power"
          />
        </Field>
        <div className="sm:col-span-2 flex flex-col gap-1.5">
          <span className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-mute)]">
            Calendar colour <span className="text-[var(--ink-faint)]/80 tracking-[0.14em] normal-case">颜色</span>
          </span>
          <div role="group" aria-label="Calendar colour" className="flex items-center gap-2 flex-wrap">
            {COURSE_COLOUR_SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColour(c)}
                aria-label={`Colour ${c}`}
                aria-pressed={colour.toLowerCase() === c.toLowerCase()}
                className={`w-8 h-8 rounded-full border-2 focus-visible:shadow-[var(--shadow-focus)] active:scale-95 transition-[transform,border-color] duration-[var(--dur-fast)] ${
                  colour.toLowerCase() === c.toLowerCase() ? "border-[var(--ink)]" : "border-transparent hover:border-[var(--paper-shadow)]"
                }`}
                style={{ background: c }}
              />
            ))}
            <input
              className={`${inputCls} w-28 font-mono`}
              value={colour}
              onChange={(e) => setColour(e.target.value)}
              aria-label="Custom colour hex"
            />
          </div>
        </div>
        <Field label="Sort order" labelZh="排序">
          <input className={inputCls} type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Notes" labelZh="备注" hint="Optional — e.g. what the course covers.">
            <textarea
              className={`${inputCls} h-24 py-2.5`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
        </div>
      </div>

      {isEdit ? (
        <label className="inline-flex items-center gap-2.5 text-[13px] text-[var(--ink-soft)] select-none">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 accent-[var(--cinnabar)]" />
          Active · 启用 <span className="text-[var(--ink-faint)]">(inactive courses drop out of pickers; past sessions keep them)</span>
        </label>
      ) : null}

      {error ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--cinnabar)]/30 bg-[var(--cinnabar-wash)] px-4 py-3 text-[13px] leading-[1.6] text-[var(--cinnabar-deep)]">
          {error}
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={saving}
          className={`inline-flex items-center h-11 px-6 rounded-[var(--radius-pill)] text-[13px] tracking-[0.04em] font-medium focus-visible:shadow-[var(--shadow-focus)] transition-[background-color,transform] duration-[var(--dur-fast)] ${
            saving
              ? "bg-[var(--paper-deep)] text-[var(--ink-faint)] cursor-not-allowed"
              : "bg-[var(--cinnabar)] hover:bg-[var(--cinnabar-deep)] active:scale-[0.98]"
          }`}
          style={{ color: saving ? undefined : "var(--paper-warm)" }}
        >
          {saving ? "Saving…" : isEdit ? "Save course" : "Create course"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/admin/courses")}
          disabled={saving}
          className="inline-flex items-center h-11 px-5 rounded-[var(--radius-pill)] text-[12.5px] tracking-[0.04em] text-[var(--ink-soft)] hover:bg-[var(--paper-deep)] focus-visible:shadow-[var(--shadow-focus)] active:scale-[0.98] disabled:opacity-50 transition-[background-color,transform] duration-[var(--dur-fast)]"
        >
          Cancel
        </button>
      </div>
    </div>
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
        {labelZh ? <span className="text-[var(--ink-faint)]/80 tracking-[0.14em] normal-case">{labelZh}</span> : null}
        {required ? <span className="text-[var(--cinnabar)]" aria-hidden="true">·</span> : null}
      </span>
      {children}
      {hint ? <span className="text-[11.5px] leading-[1.6] text-[var(--ink-faint)]">{hint}</span> : null}
    </label>
  );
}
