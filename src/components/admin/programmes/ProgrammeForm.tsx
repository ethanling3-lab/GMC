"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  validateSlug,
  validateAbbrev,
  validateName,
  validatePrice,
  validateValidityMonths,
  deriveSlug,
  validityLabel,
  type Programme,
} from "@/lib/programmes/types";

// Create / edit form for a programme. `slug` is the immutable pricing
// contract, so it's only editable when creating.

type Props =
  | { mode: "create"; existing?: undefined }
  | { mode: "edit"; existing: Programme };

const inputCls =
  "h-10 w-full px-3.5 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] " +
  "text-[13.5px] text-[var(--ink)] placeholder:text-[var(--ink-faint)] " +
  "focus:border-[var(--cinnabar)]/50 focus:outline-none focus:shadow-[var(--shadow-focus)] " +
  "transition-[border-color,box-shadow] duration-[var(--dur-fast)] disabled:opacity-60";

export function ProgrammeForm({ mode, existing }: Props) {
  const router = useRouter();
  const isEdit = mode === "edit";

  const [slug, setSlug] = useState(existing?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(false);
  const [nameEn, setNameEn] = useState(existing?.name_en ?? "");
  const [nameCn, setNameCn] = useState(existing?.name_cn ?? "");
  const [abbrev, setAbbrev] = useState(existing?.abbrev ?? "");
  const [validityMonths, setValidityMonths] = useState<string>(
    existing?.validity_months != null ? String(existing.validity_months) : "",
  );
  const [priceSgd, setPriceSgd] = useState<string>(
    existing ? String(existing.price_sgd) : "",
  );
  const [onSiteSgd, setOnSiteSgd] = useState<string>(
    existing?.on_site_sgd != null ? String(existing.on_site_sgd) : "",
  );
  const [active, setActive] = useState(existing?.active ?? true);
  const [sortOrder, setSortOrder] = useState<string>(
    existing ? String(existing.sort_order) : "0",
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-derive slug from English name while creating, until the admin
  // edits the slug field directly.
  function handleNameEn(v: string) {
    setNameEn(v);
    if (!isEdit && !slugTouched) {
      setSlug(deriveSlug(v) ?? "");
    }
  }

  const validityNum = validityMonths.trim() === "" ? null : Number(validityMonths);
  const priceNum = Number(priceSgd);
  const onSiteNum = onSiteSgd.trim() === "" ? null : Number(onSiteSgd);

  function clientValidate(): string | null {
    if (!isEdit) {
      const e = validateSlug(slug);
      if (e) return e;
    }
    return (
      validateName(nameEn, "English name") ??
      validateName(nameCn, "Chinese name") ??
      validateAbbrev(abbrev) ??
      validatePrice(priceNum, "Price") ??
      (onSiteNum !== null ? validatePrice(onSiteNum, "On-site price") : null) ??
      validateValidityMonths(validityNum)
    );
  }

  async function submit() {
    const v = clientValidate();
    if (v) {
      setError(v);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        ...(isEdit ? {} : { slug: slug.trim() }),
        name_en: nameEn.trim(),
        name_cn: nameCn.trim(),
        abbrev: abbrev.trim(),
        validity_months: validityNum,
        price_sgd: priceNum,
        on_site_sgd: onSiteNum,
        active,
        sort_order: Number(sortOrder) || 0,
      };
      const res = await fetch(
        isEdit ? `/api/admin/programmes/${existing.id}` : "/api/admin/programmes",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(b.detail ?? `Save failed (${res.status})`);
      }
      router.push("/admin/programmes");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setSaving(false);
    }
  }

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)] p-6 flex flex-col gap-5 max-w-2xl">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <Field label="English name" labelZh="英文名称" required>
          <input
            className={inputCls}
            value={nameEn}
            onChange={(e) => handleNameEn(e.target.value)}
            placeholder="Glorious Family"
          />
        </Field>
        <Field label="Chinese name" labelZh="中文名称" required>
          <input
            className={inputCls}
            value={nameCn}
            onChange={(e) => setNameCn(e.target.value)}
            placeholder="荣贵"
          />
        </Field>
        <Field
          label="Slug"
          labelZh="标识"
          hint={isEdit ? "Locked — the slug is the pricing key and can't change." : "Lowercase, digits, underscores. The pricing key."}
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
            placeholder="glorious_family"
          />
        </Field>
        <Field label="Abbreviation" labelZh="缩写" hint="1–2 chars for floor-plan badges." required>
          <input
            className={inputCls}
            value={abbrev}
            onChange={(e) => setAbbrev(e.target.value)}
            placeholder="贵"
          />
        </Field>
        <Field
          label="Validity (months)"
          labelZh="有效期（月）"
          hint={`Empty = no expiry. ${validityLabel(validityNum)}.`}
        >
          <input
            className={inputCls}
            type="number"
            min={1}
            value={validityMonths}
            onChange={(e) => setValidityMonths(e.target.value)}
            placeholder="36"
          />
        </Field>
        <Field label="Sort order" labelZh="排序">
          <input
            className={inputCls}
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
          />
        </Field>
        <Field label="Price (SGD)" labelZh="价格" required>
          <input
            className={inputCls}
            type="number"
            min={0}
            step="0.01"
            value={priceSgd}
            onChange={(e) => setPriceSgd(e.target.value)}
            placeholder="38135"
          />
        </Field>
        <Field label="On-site price (SGD)" labelZh="现场价" hint="Optional.">
          <input
            className={inputCls}
            type="number"
            min={0}
            step="0.01"
            value={onSiteSgd}
            onChange={(e) => setOnSiteSgd(e.target.value)}
            placeholder="36135"
          />
        </Field>
      </div>

      {isEdit ? (
        <label className="inline-flex items-center gap-2.5 text-[13px] text-[var(--ink-soft)] select-none">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="h-4 w-4 accent-[var(--cinnabar)]"
          />
          Active · 启用 <span className="text-[var(--ink-faint)]">(inactive programmes drop out of pickers)</span>
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
          className={`inline-flex items-center gap-2.5 h-11 px-6 rounded-[var(--radius-pill)] text-[13px] tracking-[0.04em] font-medium transition-[background-color,color,box-shadow,transform] duration-[var(--dur-fast)] focus-visible:shadow-[var(--shadow-focus)] ${
            !saving
              ? "bg-[var(--cinnabar)] text-[var(--paper-warm)] hover:bg-[var(--cinnabar-deep)] active:scale-[0.98]"
              : "bg-[var(--paper-deep)] text-[var(--ink-faint)] cursor-not-allowed"
          }`}
          style={{ color: saving ? undefined : "var(--paper-warm)" }}
        >
          {saving ? "Saving…" : isEdit ? "Save changes" : "Create programme →"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/admin/programmes")}
          disabled={saving}
          className="inline-flex items-center h-11 px-5 rounded-[var(--radius-pill)] text-[12.5px] tracking-[0.04em] text-[var(--ink-soft)] hover:bg-[var(--paper-deep)] disabled:opacity-50 transition-colors"
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
        {labelZh ? (
          <span className="text-[var(--ink-faint)]/80 tracking-[0.14em] normal-case">{labelZh}</span>
        ) : null}
        {required ? (
          <span className="text-[var(--cinnabar)]" aria-hidden="true">·</span>
        ) : null}
      </span>
      {children}
      {hint ? (
        <span className="text-[11.5px] leading-[1.6] text-[var(--ink-faint)]">{hint}</span>
      ) : null}
    </label>
  );
}
