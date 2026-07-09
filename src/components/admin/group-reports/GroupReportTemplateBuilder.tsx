"use client";

import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import {
  CUSTOM_FIELD_TYPES,
  suggestFieldId,
  type CustomField,
  type CustomFieldType,
  type FormSchema,
} from "@/lib/event-form-schema";
import {
  defaultGroupReportSchema,
  normalizeGroupReportSchema,
  type GroupReportSchema,
  type GroupReportSection,
} from "@/lib/group-report-schema";
import { DynamicFormFields } from "@/components/forms/DynamicFormFields";

// Google-Forms-style builder for a group-report template. Two sections:
// a group summary (汇总, filled once per group) and a per-member section
// (组员, repeated for each group member). Reuses the event-form CustomField
// engine + the DynamicFormFields renderer for the live preview.

const TYPE_LABELS: Record<CustomFieldType, { en: string; cn: string }> = {
  section_header: { en: "Section heading", cn: "分节标题" },
  short_text: { en: "Short text", cn: "短答" },
  long_text: { en: "Paragraph", cn: "长答" },
  single_select: { en: "Single choice (MCQ)", cn: "单选" },
  multi_select: { en: "Multiple choice", cn: "多选" },
  checkbox_ack: { en: "Acknowledgement", cn: "确认" },
  date: { en: "Date", cn: "日期" },
};

type SectionKey = "group_section" | "member_section";

const inputCls =
  "w-full px-3 h-9 rounded-[var(--radius-md)] bg-[var(--paper-warm)] border border-[var(--paper-shadow)] text-[13.5px] text-[var(--ink)] placeholder:text-[var(--ink-faint)] outline-none focus:border-[var(--cinnabar)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.14)] transition-[border-color,box-shadow] duration-[var(--dur-fast)]";
const labelCls = "text-[10px] tracking-[0.2em] uppercase text-[var(--ink-faint)]";

export function GroupReportTemplateBuilder({
  templateId,
  initialNameEn,
  initialNameCn,
  initialSchema,
}: {
  templateId: string;
  initialNameEn: string | null;
  initialNameCn: string | null;
  initialSchema: unknown;
}) {
  const router = useRouter();
  const [nameEn, setNameEn] = useState(initialNameEn ?? "");
  const [nameCn, setNameCn] = useState(initialNameCn ?? "");
  const [schema, setSchema] = useState<GroupReportSchema>(() =>
    normalizeGroupReportSchema(initialSchema ?? defaultGroupReportSchema()),
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<SectionKey | null>(null);

  const original = useMemo(
    () => JSON.stringify({ nameEn: initialNameEn ?? "", nameCn: initialNameCn ?? "", schema: normalizeGroupReportSchema(initialSchema) }),
    [initialNameEn, initialNameCn, initialSchema],
  );
  const dirty = JSON.stringify({ nameEn, nameCn, schema }) !== original;

  function patchSection(key: SectionKey, patch: Partial<GroupReportSection>) {
    setSchema((s) => ({ ...s, [key]: { ...s[key], ...patch } }));
  }

  function allIds(key: SectionKey): string[] {
    return schema[key].fields.map((f) => f.id);
  }

  function addField(key: SectionKey, type: CustomFieldType) {
    const id = suggestFieldId(type === "section_header" ? "section" : "question", allIds(key));
    const field: CustomField = {
      id,
      type,
      label_en: "",
      label_cn: "",
      hint_en: "",
      hint_cn: "",
      required: false,
      options:
        type === "single_select" || type === "multi_select"
          ? [
              { value: "opt_1", label_en: "", label_cn: "" },
              { value: "opt_2", label_en: "", label_cn: "" },
            ]
          : [],
      allow_other: false,
    };
    patchSection(key, { fields: [...schema[key].fields, field] });
  }

  function updateField(key: SectionKey, id: string, patch: Partial<CustomField>) {
    patchSection(key, {
      fields: schema[key].fields.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    });
  }

  function removeField(key: SectionKey, id: string) {
    patchSection(key, { fields: schema[key].fields.filter((f) => f.id !== id) });
  }

  function moveField(key: SectionKey, id: string, dir: -1 | 1) {
    const fields = [...schema[key].fields];
    const i = fields.findIndex((f) => f.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= fields.length) return;
    [fields[i], fields[j]] = [fields[j], fields[i]];
    patchSection(key, { fields });
  }

  async function save() {
    setError(null);
    if (!nameEn.trim() && !nameCn.trim()) {
      setError("Give the template a name (EN or 中文).");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/group-report-templates/${templateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name_en: nameEn.trim() || null,
          name_cn: nameCn.trim() || null,
          schema,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.detail ?? "Could not save");
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-8 space-y-6">
      {/* Name */}
      <section className="rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] p-6 shadow-[var(--shadow-paper-1)]">
        <div className={labelCls}>Template name · 模板名称</div>
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input value={nameCn} onChange={(e) => setNameCn(e.target.value)} placeholder="模板名称 (中文)" className={inputCls} maxLength={200} />
          <input value={nameEn} onChange={(e) => setNameEn(e.target.value)} placeholder="Template name (English)" className={inputCls} maxLength={200} />
        </div>
      </section>

      <SectionEditor
        title="Group summary · 汇总"
        hint="Filled once per group — overall report."
        section={schema.group_section}
        onTitle={(patch) => patchSection("group_section", patch)}
        onAdd={(t) => addField("group_section", t)}
        onUpdate={(id, patch) => updateField("group_section", id, patch)}
        onRemove={(id) => removeField("group_section", id)}
        onMove={(id, dir) => moveField("group_section", id, dir)}
        onPreview={() => setPreview("group_section")}
      />

      <SectionEditor
        title="Per-member · 组员"
        hint="Repeated once for every member of the group."
        section={schema.member_section}
        onTitle={(patch) => patchSection("member_section", patch)}
        onAdd={(t) => addField("member_section", t)}
        onUpdate={(id, patch) => updateField("member_section", id, patch)}
        onRemove={(id) => removeField("member_section", id)}
        onMove={(id, dir) => moveField("member_section", id, dir)}
        onPreview={() => setPreview("member_section")}
      />

      {/* Save bar */}
      <div className="sticky bottom-4 z-10 flex items-center gap-3 flex-wrap rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)]/95 backdrop-blur p-3 shadow-[var(--shadow-paper-2)]">
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty}
          className="inline-flex items-center gap-2 px-4 h-10 rounded-[var(--radius-md)] bg-[var(--cinnabar)] text-[var(--paper-warm)] text-[12.5px] tracking-[0.06em] uppercase hover:bg-[var(--cinnabar-deep)] active:translate-y-px disabled:opacity-50 transition-[background-color,transform] duration-[var(--dur-fast)]"
          style={{ color: "var(--paper-warm)" }}
        >
          {saving ? "Saving…" : dirty ? "Save template · 保存" : "Saved · 已保存"}
        </button>
        {saved ? <span className="text-[12px] text-[#3a6b3b]">✓ Saved</span> : null}
        {error ? <span className="text-[12px] text-[var(--cinnabar-deep)]">{error}</span> : null}
        {dirty ? <span className="text-[11px] text-[var(--ink-faint)] tracking-[0.1em] uppercase">Unsaved changes</span> : null}
      </div>

      {preview ? (
        <PreviewModal section={schema[preview]} onClose={() => setPreview(null)} />
      ) : null}
    </div>
  );
}

function SectionEditor({
  title,
  hint,
  section,
  onTitle,
  onAdd,
  onUpdate,
  onRemove,
  onMove,
  onPreview,
}: {
  title: string;
  hint: string;
  section: GroupReportSection;
  onTitle: (patch: Partial<GroupReportSection>) => void;
  onAdd: (t: CustomFieldType) => void;
  onUpdate: (id: string, patch: Partial<CustomField>) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onPreview: () => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] p-6 shadow-[var(--shadow-paper-1)]">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
            <span className="w-4 h-px bg-current" />
            {title}
          </div>
          <p className="mt-1 text-[12px] text-[var(--ink-mute)]">{hint}</p>
        </div>
        <button
          type="button"
          onClick={onPreview}
          className="text-[11px] tracking-[0.1em] uppercase text-[var(--ink-mute)] hover:text-[var(--cinnabar-deep)] px-3 h-8 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)]"
        >
          Preview · 预览
        </button>
      </div>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <input value={section.title_cn} onChange={(e) => onTitle({ title_cn: e.target.value })} placeholder="分节标题 (中文)" className={inputCls} maxLength={200} />
        <input value={section.title_en} onChange={(e) => onTitle({ title_en: e.target.value })} placeholder="Section title (English)" className={inputCls} maxLength={200} />
      </div>

      <div className="mt-4 space-y-2.5">
        {section.fields.length === 0 ? (
          <p className="text-[12.5px] text-[var(--ink-mute)]">No questions yet.</p>
        ) : (
          section.fields.map((f, i) => (
            <FieldRow
              key={f.id}
              field={f}
              existingIds={section.fields.filter((x) => x.id !== f.id).map((x) => x.id)}
              isFirst={i === 0}
              isLast={i === section.fields.length - 1}
              onUpdate={(patch) => onUpdate(f.id, patch)}
              onRemove={() => onRemove(f.id)}
              onMove={(dir) => onMove(f.id, dir)}
            />
          ))
        )}
      </div>

      {/* Add field menu */}
      <div className="relative mt-4 inline-block">
        <button
          type="button"
          onClick={() => setAddOpen((o) => !o)}
          className="inline-flex items-center gap-2 px-3.5 h-9 rounded-[var(--radius-md)] border border-dashed border-[var(--paper-shadow)] text-[12px] tracking-[0.06em] uppercase text-[var(--ink-soft)] hover:border-[var(--cinnabar)]/50 hover:text-[var(--cinnabar-deep)] transition-colors"
        >
          + Add question · 添加
        </button>
        {addOpen ? (
          <ul className="absolute left-0 top-full mt-1.5 z-20 min-w-[220px] rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-2)] py-1.5">
            {CUSTOM_FIELD_TYPES.map((t) => (
              <li key={t}>
                <button
                  type="button"
                  onClick={() => {
                    onAdd(t);
                    setAddOpen(false);
                  }}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-[var(--paper-deep)] transition-colors"
                >
                  <span className="text-[13px] text-[var(--ink)]">{TYPE_LABELS[t].en}</span>
                  <span className="text-[11px] text-[var(--ink-faint)]">{TYPE_LABELS[t].cn}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

function FieldRow({
  field,
  existingIds,
  isFirst,
  isLast,
  onUpdate,
  onRemove,
  onMove,
}: {
  field: CustomField;
  existingIds: string[];
  isFirst: boolean;
  isLast: boolean;
  onUpdate: (patch: Partial<CustomField>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const [open, setOpen] = useState(!field.label_en && !field.label_cn);
  const isSelect = field.type === "single_select" || field.type === "multi_select";
  const summary = field.label_cn || field.label_en || "(untitled)";
  const idDup = existingIds.includes(field.id);

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)]">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className="text-[9.5px] tracking-[0.12em] uppercase px-1.5 py-0.5 rounded-full bg-[var(--paper-deep)] text-[var(--ink-mute)] flex-none">
          {TYPE_LABELS[field.type].en}
        </span>
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex-1 min-w-0 text-left text-[13px] text-[var(--ink)] truncate">
          {summary}
          {field.required ? <span className="text-[var(--cinnabar)]">*</span> : null}
        </button>
        <div className="flex items-center gap-1 flex-none text-[var(--ink-mute)]">
          <button type="button" onClick={() => onMove(-1)} disabled={isFirst} className="w-6 h-6 rounded hover:bg-[var(--paper-deep)] disabled:opacity-30" aria-label="Move up">↑</button>
          <button type="button" onClick={() => onMove(1)} disabled={isLast} className="w-6 h-6 rounded hover:bg-[var(--paper-deep)] disabled:opacity-30" aria-label="Move down">↓</button>
          <button type="button" onClick={onRemove} className="w-6 h-6 rounded hover:bg-[var(--cinnabar-wash)] hover:text-[var(--cinnabar-deep)]" aria-label="Remove">✕</button>
        </div>
      </div>

      {open ? (
        <div className="px-3 pb-3 pt-1 border-t border-[var(--paper-shadow)] space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <label className="block">
              <span className={labelCls}>Label · 标题 (中文)</span>
              <input value={field.label_cn} onChange={(e) => onUpdate({ label_cn: e.target.value })} className={inputCls + " mt-1"} maxLength={400} />
            </label>
            <label className="block">
              <span className={labelCls}>Label · Label (EN)</span>
              <input value={field.label_en} onChange={(e) => onUpdate({ label_en: e.target.value })} className={inputCls + " mt-1"} maxLength={400} />
            </label>
          </div>

          <label className="block">
            <span className={labelCls}>Field id (answer key)</span>
            <input
              value={field.id}
              onChange={(e) => onUpdate({ id: e.target.value })}
              className={inputCls + " mt-1 font-mono " + (idDup ? "border-[var(--cinnabar)]" : "")}
              maxLength={64}
            />
            {idDup ? <span className="text-[11px] text-[var(--cinnabar-deep)]">Duplicate id in this section.</span> : null}
          </label>

          {field.type !== "section_header" && field.type !== "checkbox_ack" ? (
            <label className="inline-flex items-center gap-2 text-[13px] text-[var(--ink-soft)]">
              <input type="checkbox" checked={field.required} onChange={(e) => onUpdate({ required: e.target.checked })} />
              Required · 必填
            </label>
          ) : null}
          {field.type === "checkbox_ack" ? (
            <label className="inline-flex items-center gap-2 text-[13px] text-[var(--ink-soft)]">
              <input type="checkbox" checked={field.required} onChange={(e) => onUpdate({ required: e.target.checked })} />
              Must be checked · 必须勾选
            </label>
          ) : null}

          {isSelect ? (
            <OptionsEditor field={field} onUpdate={onUpdate} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function OptionsEditor({ field, onUpdate }: { field: CustomField; onUpdate: (patch: Partial<CustomField>) => void }) {
  function updateOption(i: number, patch: Partial<CustomField["options"][number]>) {
    const options = field.options.map((o, idx) => (idx === i ? { ...o, ...patch } : o));
    onUpdate({ options });
  }
  function addOption() {
    const n = field.options.length + 1;
    onUpdate({ options: [...field.options, { value: `opt_${n}`, label_en: "", label_cn: "" }] });
  }
  function removeOption(i: number) {
    onUpdate({ options: field.options.filter((_, idx) => idx !== i) });
  }
  return (
    <div>
      <span className={labelCls}>Options · 选项</span>
      <div className="mt-1.5 space-y-1.5">
        {field.options.map((o, i) => (
          <div key={i} className="flex items-center gap-2">
            <input value={o.value} onChange={(e) => updateOption(i, { value: e.target.value })} placeholder="value" className={inputCls + " font-mono max-w-[120px]"} maxLength={80} />
            <input value={o.label_cn} onChange={(e) => updateOption(i, { label_cn: e.target.value })} placeholder="中文" className={inputCls} maxLength={240} />
            <input value={o.label_en} onChange={(e) => updateOption(i, { label_en: e.target.value })} placeholder="English" className={inputCls} maxLength={240} />
            <button type="button" onClick={() => removeOption(i)} className="w-7 h-7 rounded hover:bg-[var(--cinnabar-wash)] text-[var(--ink-mute)] hover:text-[var(--cinnabar-deep)] flex-none" aria-label="Remove option">✕</button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-4">
        <button type="button" onClick={addOption} className="text-[11.5px] tracking-[0.08em] uppercase text-[var(--ink-mute)] hover:text-[var(--cinnabar-deep)]">+ Add option</button>
        <label className="inline-flex items-center gap-2 text-[12.5px] text-[var(--ink-soft)]">
          <input type="checkbox" checked={field.allow_other} onChange={(e) => onUpdate({ allow_other: e.target.checked })} />
          Allow &quot;Other&quot; · 其他
        </label>
      </div>
    </div>
  );
}

function PreviewModal({ section, onClose }: { section: GroupReportSection; onClose: () => void }) {
  const { register, control, formState } = useForm<{ answers: Record<string, unknown> }>({ defaultValues: { answers: {} } });
  const previewSchema = { version: 1, identity: {}, fields: section.fields } as unknown as FormSchema;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-[640px] max-h-[85vh] overflow-y-auto rounded-[var(--radius-lg)] bg-[var(--paper)] border border-[var(--paper-shadow)] shadow-[var(--shadow-paper-2)] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-[18px] text-[var(--ink)]">
            {section.title_cn || section.title_en || "Preview"}
          </h3>
          <button type="button" onClick={onClose} className="text-[var(--ink-mute)] hover:text-[var(--ink)] w-8 h-8">✕</button>
        </div>
        {section.fields.length === 0 ? (
          <p className="text-[13px] text-[var(--ink-mute)]">No questions to preview.</p>
        ) : (
          <DynamicFormFields schema={previewSchema} locale="zh" register={register} control={control} errors={formState.errors} />
        )}
      </div>
    </div>
  );
}
