"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  CUSTOM_FIELD_TYPES,
  type CustomField,
  type CustomFieldType,
  buildAnswersSchema,
  defaultFormSchema,
  normalizeFormSchema,
  suggestFieldId,
  type FormSchema,
} from "@/lib/event-form-schema";
import { DynamicFormFields } from "@/components/forms/DynamicFormFields";

const TYPE_LABELS: Record<CustomFieldType, { en: string; cn: string }> = {
  section_header: { en: "Section header", cn: "分节标题" },
  short_text: { en: "Short text", cn: "短文本" },
  long_text: { en: "Long text", cn: "长文本" },
  single_select: { en: "Single choice", cn: "单选" },
  multi_select: { en: "Multiple choice", cn: "多选" },
  checkbox_ack: { en: "Acknowledgement", cn: "确认勾选" },
  date: { en: "Date", cn: "日期" },
};

type Props = {
  eventId: string;
  initial: unknown;
  canEdit: boolean;
};

export function EventFormBuilder({ eventId, initial, canEdit }: Props) {
  const [draft, setDraft] = useState<FormSchema>(() =>
    normalizeFormSchema(initial),
  );
  const [original, setOriginal] = useState<FormSchema>(() =>
    normalizeFormSchema(initial),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLocale, setPreviewLocale] = useState<"zh" | "en">("zh");
  const addMenuRef = useRef<HTMLDivElement>(null);

  // Close the add-field menu on outside click / Escape.
  useEffect(() => {
    if (!addMenuOpen) return;
    function onDown(e: MouseEvent) {
      if (!addMenuRef.current?.contains(e.target as Node)) {
        setAddMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setAddMenuOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [addMenuOpen]);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(original),
    [draft, original],
  );

  function updateIdentity<K extends keyof FormSchema["identity"]>(
    key: K,
    value: FormSchema["identity"][K],
  ) {
    setDraft((d) => ({ ...d, identity: { ...d.identity, [key]: value } }));
  }

  function addField(type: CustomFieldType) {
    const existingIds = draft.fields.map((f) => f.id);
    const id = suggestFieldId(
      type === "section_header" ? "section" : "question",
      existingIds,
    );
    const defaults: CustomField = {
      id,
      type,
      label_en: "",
      label_cn: "",
      hint_en: "",
      hint_cn: "",
      required: type !== "section_header",
      options:
        type === "single_select" || type === "multi_select"
          ? [
              { value: "option_1", label_en: "Option 1", label_cn: "选项一" },
              { value: "option_2", label_en: "Option 2", label_cn: "选项二" },
            ]
          : [],
    };
    setDraft((d) => ({ ...d, fields: [...d.fields, defaults] }));
    setExpandedId(id);
    setAddMenuOpen(false);
  }

  function updateField(id: string, patch: Partial<CustomField>) {
    setDraft((d) => ({
      ...d,
      fields: d.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    }));
  }

  function removeField(id: string) {
    setDraft((d) => ({ ...d, fields: d.fields.filter((f) => f.id !== id) }));
    if (expandedId === id) setExpandedId(null);
  }

  function moveField(id: string, direction: -1 | 1) {
    setDraft((d) => {
      const idx = d.fields.findIndex((f) => f.id === id);
      if (idx < 0) return d;
      const next = idx + direction;
      if (next < 0 || next >= d.fields.length) return d;
      const copy = [...d.fields];
      [copy[idx], copy[next]] = [copy[next], copy[idx]];
      return { ...d, fields: copy };
    });
  }

  async function onSave() {
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/events/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ form_schema: draft }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? `Save failed (${res.status})`);
      }
      setOriginal(draft);
      setSuccess("Form saved");
      setTimeout(() => setSuccess(null), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function onReset() {
    setDraft(original);
    setExpandedId(null);
    setError(null);
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Identity block toggles */}
      <div>
        <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.22em] uppercase text-[var(--ink-mute)]">
          Identity block · 必填身份字段
        </div>
        <p className="mt-2 text-[12px] leading-[1.7] text-[var(--ink-soft)] max-w-[62ch]">
          Name (EN), email, phone and region are always required. Toggle the
          others as needed for this event.
        </p>

        <div className="mt-4 grid md:grid-cols-2 gap-2">
          <IdentityToggle
            label="Require Chinese name"
            zh="需要中文姓名"
            checked={draft.identity.require_name_cn}
            onChange={(v) => updateIdentity("require_name_cn", v)}
            disabled={!canEdit}
          />
          <IdentityToggle
            label="Require birth date"
            zh="需要出生日期"
            checked={draft.identity.require_birth_date}
            onChange={(v) => updateIdentity("require_birth_date", v)}
            disabled={!canEdit}
          />
          <IdentityToggle
            label="Require gender"
            zh="需要性别"
            checked={draft.identity.require_gender}
            onChange={(v) => updateIdentity("require_gender", v)}
            disabled={!canEdit}
          />
          <IdentityToggle
            label="Require occupation"
            zh="需要职业"
            checked={draft.identity.require_occupation}
            onChange={(v) => updateIdentity("require_occupation", v)}
            disabled={!canEdit}
          />
          <IdentityToggle
            label="Require industry"
            zh="需要行业"
            checked={draft.identity.require_industry}
            onChange={(v) => updateIdentity("require_industry", v)}
            disabled={!canEdit}
          />
          <IdentityToggle
            label="Require referrer"
            zh="需要介绍人"
            checked={draft.identity.require_referrer}
            onChange={(v) => updateIdentity("require_referrer", v)}
            disabled={!canEdit}
          />
        </div>
      </div>

      {/* Custom fields list */}
      <div className="border-t border-[var(--paper-shadow)] pt-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.22em] uppercase text-[var(--ink-mute)]">
              Custom questions · 自定义问题
            </div>
            <p className="mt-2 text-[12px] leading-[1.7] text-[var(--ink-soft)] max-w-[62ch]">
              Add event-specific questions. Answers are stored with each
              enrollment (not on the participant record).
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPreviewOpen(true)}
              className="inline-flex items-center gap-2 h-9 px-3.5 rounded-[var(--radius-pill)]
                         border border-[var(--paper-shadow)] bg-[var(--paper)]
                         text-[12px] tracking-[0.04em] text-[var(--ink)]
                         hover:border-[var(--cinnabar)]/40 hover:bg-[var(--cinnabar-wash)] hover:text-[var(--cinnabar-deep)]
                         transition-[background-color,border-color,color] duration-[var(--dur-fast)]"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M1.5 8S3.8 3 8 3s6.5 5 6.5 5-2.3 5-6.5 5S1.5 8 1.5 8z" />
                <circle cx="8" cy="8" r="2" />
              </svg>
              Preview
            </button>

            {canEdit ? (
              <div ref={addMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setAddMenuOpen((v) => !v)}
                  className="inline-flex items-center gap-2 h-9 px-4 rounded-[var(--radius-pill)]
                             bg-[var(--cinnabar)] text-[var(--paper-warm)]
                             text-[12px] tracking-[0.04em] font-medium
                             hover:bg-[var(--cinnabar-deep)]
                             shadow-[0_4px_14px_rgba(37,99,235,0.25)]
                             transition-[background-color] duration-[var(--dur-fast)]"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                    <path d="M6 2v8M2 6h8" />
                  </svg>
                  Add field
                </button>
                {addMenuOpen ? (
                  <div className="absolute right-0 top-[calc(100%+6px)] z-20 w-56 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-2)] p-1.5">
                    {CUSTOM_FIELD_TYPES.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => addField(t)}
                        className="w-full text-left px-3 py-2 rounded-[var(--radius-sm)] text-[12.5px] text-[var(--ink)]
                                   hover:bg-[var(--cinnabar-wash)] hover:text-[var(--cinnabar-deep)]
                                   transition-[background-color,color] duration-[var(--dur-fast)]"
                      >
                        <div>{TYPE_LABELS[t].en}</div>
                        <div className="text-[11px] text-[var(--ink-mute)] mt-0.5">
                          {TYPE_LABELS[t].cn}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        {draft.fields.length === 0 ? (
          <div className="mt-4 rounded-[var(--radius-md)] border border-dashed border-[var(--paper-shadow)] bg-[var(--paper)] p-6 text-center text-[12.5px] text-[var(--ink-mute)]">
            No custom questions yet. Click <span className="font-medium text-[var(--ink-soft)]">Add field</span> above to add one.
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            {draft.fields.map((f, i) => (
              <FieldRow
                key={f.id}
                field={f}
                isFirst={i === 0}
                isLast={i === draft.fields.length - 1}
                expanded={expandedId === f.id}
                onToggle={() =>
                  setExpandedId((cur) => (cur === f.id ? null : f.id))
                }
                onChange={(patch) => updateField(f.id, patch)}
                onMoveUp={() => moveField(f.id, -1)}
                onMoveDown={() => moveField(f.id, 1)}
                onRemove={() => removeField(f.id)}
                canEdit={canEdit}
                existingIds={draft.fields
                  .filter((x) => x.id !== f.id)
                  .map((x) => x.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Save bar */}
      {canEdit ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] p-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-[11.5px] tracking-[0.14em] uppercase text-[var(--ink-mute)]">
            {dirty ? (
              <span className="text-[var(--cinnabar-deep)]">
                Unsaved form changes
              </span>
            ) : (
              "Form saved"
            )}
            {success ? (
              <span className="ml-3 text-[var(--jade-deep)]">· {success}</span>
            ) : null}
            {error ? (
              <span className="ml-3 text-[var(--cinnabar-deep)]">· {error}</span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onReset}
              disabled={!dirty || saving}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-[var(--radius-pill)] text-[12.5px] text-[var(--ink-mute)] hover:text-[var(--ink)] hover:bg-[var(--paper-deep)] disabled:opacity-40 disabled:cursor-not-allowed transition-[background-color,color] duration-[var(--dur-fast)]"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={!dirty || saving}
              className={`inline-flex items-center gap-2 h-9 px-5 rounded-[var(--radius-pill)]
                          text-[12.5px] tracking-[0.04em] font-medium
                          transition-[background-color,color,transform] duration-[var(--dur-fast)]
                          focus-visible:shadow-[var(--shadow-focus)]
                          ${
                            dirty && !saving
                              ? "bg-[var(--cinnabar)] text-[var(--paper-warm)] hover:bg-[var(--cinnabar-deep)] shadow-[0_4px_14px_rgba(37,99,235,0.25)] active:scale-[0.98]"
                              : "bg-[var(--paper-deep)] text-[var(--ink-faint)] cursor-not-allowed"
                          }`}
            >
              {saving ? "Saving…" : "Save form"}
            </button>
          </div>
        </div>
      ) : null}

      {previewOpen ? (
        <PreviewModal
          schema={draft}
          locale={previewLocale}
          onToggleLocale={() =>
            setPreviewLocale((l) => (l === "zh" ? "en" : "zh"))
          }
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}
    </div>
  );
}

function IdentityToggle({
  label,
  zh,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  zh: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-start gap-3 px-4 py-3 rounded-[var(--radius-md)] border
                  bg-[var(--paper)] text-[13px] text-[var(--ink)]
                  transition-[background-color,border-color] duration-[var(--dur-fast)]
                  ${
                    checked
                      ? "border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)]"
                      : "border-[var(--paper-shadow)]"
                  }
                  ${disabled ? "opacity-70 cursor-not-allowed" : "cursor-pointer hover:border-[var(--cinnabar)]/30"}`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="mt-1 h-4 w-4 accent-[var(--cinnabar)]"
      />
      <div className="min-w-0">
        <div>{label}</div>
        <div className="text-[11px] text-[var(--ink-mute)] mt-0.5">{zh}</div>
      </div>
    </label>
  );
}

function FieldRow({
  field,
  isFirst,
  isLast,
  expanded,
  onToggle,
  onChange,
  onMoveUp,
  onMoveDown,
  onRemove,
  canEdit,
  existingIds,
}: {
  field: CustomField;
  isFirst: boolean;
  isLast: boolean;
  expanded: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<CustomField>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  canEdit: boolean;
  existingIds: string[];
}) {
  const typeLabel = TYPE_LABELS[field.type];
  const displayLabel =
    field.label_en.trim() ||
    field.label_cn.trim() ||
    (field.type === "section_header" ? "Untitled section" : "Untitled question");

  return (
    <div
      className={`rounded-[var(--radius-md)] border bg-[var(--paper)]
                  ${expanded ? "border-[var(--cinnabar)]/40 shadow-[var(--shadow-paper-1)]" : "border-[var(--paper-shadow)]"}
                  transition-[border-color,box-shadow] duration-[var(--dur-fast)]`}
    >
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="flex flex-col gap-1 pt-1">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={isFirst || !canEdit}
            aria-label="Move up"
            className="w-6 h-6 rounded-[var(--radius-sm)] text-[var(--ink-mute)] hover:bg-[var(--paper-deep)] hover:text-[var(--ink)] disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-[background-color,color] duration-[var(--dur-fast)]"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2 6l3-3 3 3" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={isLast || !canEdit}
            aria-label="Move down"
            className="w-6 h-6 rounded-[var(--radius-sm)] text-[var(--ink-mute)] hover:bg-[var(--paper-deep)] hover:text-[var(--ink)] disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-[background-color,color] duration-[var(--dur-fast)]"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2 4l3 3 3-3" />
            </svg>
          </button>
        </div>

        <button
          type="button"
          onClick={onToggle}
          className="flex-1 min-w-0 text-left"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center h-6 px-2 rounded-[var(--radius-pill)] bg-[var(--paper-deep)] text-[10.5px] tracking-[0.12em] uppercase text-[var(--ink-mute)]">
              {typeLabel.en}
            </span>
            {field.required && field.type !== "section_header" ? (
              <span className="inline-flex items-center h-6 px-2 rounded-[var(--radius-pill)] bg-[var(--cinnabar-wash)] text-[10.5px] tracking-[0.12em] uppercase text-[var(--cinnabar-deep)]">
                Required
              </span>
            ) : null}
            <span className="font-mono text-[10.5px] text-[var(--ink-faint)]">
              {field.id}
            </span>
          </div>
          <div className="mt-1 text-[13.5px] text-[var(--ink)] truncate">
            {displayLabel}
          </div>
          {field.label_en && field.label_cn && field.label_en !== field.label_cn ? (
            <div className="text-[11.5px] text-[var(--ink-mute)] truncate">
              {field.label_en === displayLabel ? field.label_cn : field.label_en}
            </div>
          ) : null}
        </button>

        {canEdit ? (
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove field"
            className="w-8 h-8 rounded-[var(--radius-sm)] text-[var(--ink-mute)] hover:bg-[var(--cinnabar-wash)] hover:text-[var(--cinnabar-deep)] flex items-center justify-center transition-[background-color,color] duration-[var(--dur-fast)]"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 3.5h8M5.5 3.5V2.5a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1M4.5 3.5l.5 8a1 1 0 0 0 1 .9h2a1 1 0 0 0 1-.9l.5-8" />
            </svg>
          </button>
        ) : null}
      </div>

      {expanded ? (
        <FieldEditor
          field={field}
          onChange={onChange}
          existingIds={existingIds}
          canEdit={canEdit}
        />
      ) : null}
    </div>
  );
}

function FieldEditor({
  field,
  onChange,
  existingIds,
  canEdit,
}: {
  field: CustomField;
  onChange: (patch: Partial<CustomField>) => void;
  existingIds: string[];
  canEdit: boolean;
}) {
  const idConflict = existingIds.includes(field.id);

  const needsLabel = field.type !== "section_header";
  const needsOptions =
    field.type === "single_select" || field.type === "multi_select";

  return (
    <div className="px-4 pt-2 pb-4 border-t border-[var(--paper-shadow)] flex flex-col gap-4">
      <div className="grid md:grid-cols-[1fr_200px] gap-3">
        <MiniField label="Label — English" zh="问题（英文）">
          <input
            type="text"
            value={field.label_en}
            onChange={(e) => onChange({ label_en: e.target.value })}
            disabled={!canEdit}
            placeholder={
              field.type === "section_header"
                ? "e.g. Agreements"
                : "e.g. Have you attended before?"
            }
            className={inputCls()}
          />
        </MiniField>
        <MiniField label="Field ID" zh="字段 ID" hint={idConflict ? "Duplicate id — must be unique." : undefined}>
          <input
            type="text"
            value={field.id}
            onChange={(e) => {
              const value = e.target.value
                .toLowerCase()
                .replace(/[^a-z0-9_]/g, "_");
              onChange({ id: value });
            }}
            disabled={!canEdit}
            className={`${inputCls("font-mono text-[12px]")} ${idConflict ? "border-[var(--cinnabar)]/60" : ""}`}
          />
        </MiniField>
      </div>

      <MiniField label="Label — 中文" zh="问题（中文）">
        <input
          type="text"
          value={field.label_cn}
          onChange={(e) => onChange({ label_cn: e.target.value })}
          disabled={!canEdit}
          placeholder={
            field.type === "section_header" ? "例如：承诺书" : "例如：您之前参加过吗？"
          }
          className={inputCls()}
        />
      </MiniField>

      {needsLabel ? (
        <>
          <div className="grid md:grid-cols-2 gap-3">
            <MiniField label="Hint — English" zh="提示（英文）">
              <input
                type="text"
                value={field.hint_en}
                onChange={(e) => onChange({ hint_en: e.target.value })}
                disabled={!canEdit}
                className={inputCls()}
              />
            </MiniField>
            <MiniField label="Hint — 中文" zh="提示（中文）">
              <input
                type="text"
                value={field.hint_cn}
                onChange={(e) => onChange({ hint_cn: e.target.value })}
                disabled={!canEdit}
                className={inputCls()}
              />
            </MiniField>
          </div>

          <label className="inline-flex items-center gap-2 text-[12.5px] text-[var(--ink)] cursor-pointer">
            <input
              type="checkbox"
              checked={field.required}
              onChange={(e) => onChange({ required: e.target.checked })}
              disabled={!canEdit}
              className="h-4 w-4 accent-[var(--cinnabar)]"
            />
            Required · 必填
          </label>
        </>
      ) : null}

      {needsOptions ? (
        <OptionsEditor
          options={field.options}
          onChange={(options) => onChange({ options })}
          canEdit={canEdit}
        />
      ) : null}
    </div>
  );
}

function OptionsEditor({
  options,
  onChange,
  canEdit,
}: {
  options: CustomField["options"];
  onChange: (next: CustomField["options"]) => void;
  canEdit: boolean;
}) {
  function updateOption(idx: number, patch: Partial<(typeof options)[number]>) {
    onChange(options.map((o, i) => (i === idx ? { ...o, ...patch } : o)));
  }
  function removeOption(idx: number) {
    onChange(options.filter((_, i) => i !== idx));
  }
  function addOption() {
    const n = options.length + 1;
    onChange([
      ...options,
      {
        value: `option_${n}`,
        label_en: `Option ${n}`,
        label_cn: `选项 ${n}`,
      },
    ]);
  }

  return (
    <div>
      <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.22em] uppercase text-[var(--ink-mute)]">
        Options · 选项
      </div>
      <div className="mt-2 flex flex-col gap-2">
        {options.map((o, i) => (
          <div
            key={i}
            className="grid grid-cols-[120px_1fr_1fr_32px] gap-2 items-center"
          >
            <input
              type="text"
              value={o.value}
              onChange={(e) => {
                const value = e.target.value
                  .replace(/[^a-zA-Z0-9_-]/g, "_")
                  .slice(0, 80);
                updateOption(i, { value });
              }}
              disabled={!canEdit}
              placeholder="option_value"
              className={inputCls("font-mono text-[12px]")}
            />
            <input
              type="text"
              value={o.label_en}
              onChange={(e) => updateOption(i, { label_en: e.target.value })}
              disabled={!canEdit}
              placeholder="English label"
              className={inputCls()}
            />
            <input
              type="text"
              value={o.label_cn}
              onChange={(e) => updateOption(i, { label_cn: e.target.value })}
              disabled={!canEdit}
              placeholder="中文"
              className={inputCls()}
            />
            {canEdit ? (
              <button
                type="button"
                onClick={() => removeOption(i)}
                aria-label="Remove option"
                className="w-8 h-8 rounded-[var(--radius-sm)] text-[var(--ink-mute)] hover:bg-[var(--cinnabar-wash)] hover:text-[var(--cinnabar-deep)] flex items-center justify-center transition-[background-color,color] duration-[var(--dur-fast)]"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                  <path d="M3 3l6 6M9 3l-6 6" />
                </svg>
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {canEdit ? (
        <button
          type="button"
          onClick={addOption}
          className="mt-3 inline-flex items-center gap-2 h-8 px-3 rounded-[var(--radius-pill)] border border-dashed border-[var(--paper-shadow)] text-[12px] text-[var(--ink-mute)] hover:border-[var(--cinnabar)]/40 hover:text-[var(--cinnabar-deep)] hover:bg-[var(--cinnabar-wash)] transition-[background-color,border-color,color] duration-[var(--dur-fast)]"
        >
          + Add option
        </button>
      ) : null}
    </div>
  );
}

function MiniField({
  label,
  zh,
  hint,
  children,
}: {
  label: string;
  zh?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="inline-flex items-center gap-2 text-[10px] tracking-[0.22em] uppercase text-[var(--ink-mute)]">
        {label}
        {zh ? (
          <span className="text-[var(--ink-faint)]/80 tracking-[0.14em] normal-case">
            {zh}
          </span>
        ) : null}
      </span>
      {children}
      {hint ? (
        <span className="text-[11.5px] leading-[1.6] text-[var(--cinnabar-deep)]">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

function inputCls(extra = ""): string {
  return `h-9 w-full px-3 rounded-[var(--radius-sm)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)]
          text-[13px] text-[var(--ink)] placeholder:text-[var(--ink-faint)]
          focus:border-[var(--cinnabar)]/60 focus:outline-none focus:shadow-[var(--shadow-focus)]
          disabled:opacity-70 disabled:cursor-not-allowed
          transition-[border-color,box-shadow] duration-[var(--dur-fast)] ${extra}`;
}

// ---------- Preview modal ---------- //

function PreviewModal({
  schema,
  locale,
  onToggleLocale,
  onClose,
}: {
  schema: FormSchema;
  locale: "zh" | "en";
  onToggleLocale: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Preview-only: validation here is cosmetic. Just need the resolver shape
  // to satisfy react-hook-form so the dynamic renderer can hydrate fields.
  const resolver = useMemo(
    () => zodResolver(buildAnswersSchema(schema).partial()),
    [schema],
  );

  const {
    register,
    control,
    formState: { errors },
  } = useForm<{ answers: Record<string, unknown> }>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: resolver as any,
    defaultValues: { answers: {} },
    mode: "onBlur",
  });

  return (
    <div
      className="fixed inset-0 z-50 bg-[rgba(11,41,84,0.52)] backdrop-blur-sm flex items-start md:items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[760px] my-8 rounded-[var(--radius-lg)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-3)] border border-[var(--paper-shadow)]"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-4 px-6 py-4 border-b border-[var(--paper-shadow)] bg-[var(--paper-warm)]/95 backdrop-blur rounded-t-[var(--radius-lg)]">
          <div>
            <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.22em] uppercase text-[var(--cinnabar)]">
              Preview · 预览
            </div>
            <div className="mt-1 text-[13px] text-[var(--ink-mute)]">
              What participants will see on <span className="font-mono">/register</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onToggleLocale}
              className="inline-flex items-center gap-2 h-8 px-3 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[11.5px] tracking-[0.04em] text-[var(--ink)] hover:border-[var(--cinnabar)]/40 hover:bg-[var(--cinnabar-wash)] transition-[background-color,border-color] duration-[var(--dur-fast)]"
            >
              {locale === "zh" ? "中文 / EN" : "EN / 中文"}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close preview"
              className="w-8 h-8 rounded-[var(--radius-sm)] text-[var(--ink-mute)] hover:bg-[var(--paper-deep)] hover:text-[var(--ink)] flex items-center justify-center transition-[background-color,color] duration-[var(--dur-fast)]"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                <path d="M3 3l8 8M11 3l-8 8" />
              </svg>
            </button>
          </div>
        </div>
        <div className="px-6 py-8">
          {schema.fields.length === 0 ? (
            <p className="text-[13px] text-[var(--ink-mute)]">
              No custom questions. The identity block still appears on{" "}
              <span className="font-mono">/register</span>.
            </p>
          ) : (
            <form className="flex flex-col gap-6" onSubmit={(e) => e.preventDefault()}>
              <DynamicFormFields
                schema={schema}
                locale={locale}
                register={register}
                errors={errors}
                control={control}
              />
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
