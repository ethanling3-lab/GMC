"use client";

import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import type { CustomField, FormSchema } from "@/lib/event-form-schema";
import type { GroupReportFillData } from "@/lib/group-report-portal-types";
import { DynamicFormFields } from "@/components/forms/DynamicFormFields";

// Leader-facing group report — a section stepper (summary 汇总 + one section per
// member) mirroring the bambooclass layout. Reuses DynamicFormFields to render
// each section's questions. Section answers are held in local state and synced
// on every section switch / save so nothing is lost while navigating.

type Answers = Record<string, unknown>;
const GROUP_KEY = "__group__";

function buildDefaults(fields: CustomField[], stored: Answers | undefined): Answers {
  const out: Answers = {};
  for (const f of fields) {
    if (f.type === "section_header") continue;
    const s = stored?.[f.id];
    if (f.type === "multi_select") out[f.id] = Array.isArray(s) ? s : [];
    else if (f.type === "checkbox_ack") out[f.id] = s === true;
    else out[f.id] = typeof s === "string" ? s : "";
    if (f.allow_other) {
      const o = stored?.[`${f.id}__other`];
      out[`${f.id}__other`] = typeof o === "string" ? o : "";
    }
  }
  return out;
}

export function GroupReportForm({ fill }: { fill: GroupReportFillData }) {
  const router = useRouter();
  const { schema, members, submission } = fill;

  // section list: group summary, then each member.
  const sections = useMemo(
    () => [
      { key: GROUP_KEY, label: schema.group_section.title_cn || schema.group_section.title_en || "汇总", fields: schema.group_section.fields, sub: null as string | null },
      ...members.map((m, i) => ({
        key: m.participant_id,
        label: `组员${i + 1} · ${m.name_cn ?? m.name_en ?? m.region_id ?? ""}`,
        fields: schema.member_section.fields,
        sub: m.region_id,
      })),
    ],
    [schema, members],
  );

  // Local answer store, seeded from the existing submission.
  const [store, setStore] = useState<Record<string, Answers>>(() => {
    const s: Record<string, Answers> = { [GROUP_KEY]: submission?.group_answers ?? {} };
    for (const m of members) s[m.participant_id] = submission?.member_answers?.[m.participant_id] ?? {};
    return s;
  });

  const [activeIdx, setActiveIdx] = useState(0);
  const active = sections[activeIdx];

  const form = useForm<{ answers: Answers }>({
    defaultValues: { answers: buildDefaults(sections[0].fields, submission?.group_answers) },
  });

  const [status, setStatus] = useState<"draft" | "submitted" | null>(submission?.status ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  function persistCurrent(): Record<string, Answers> {
    const values = form.getValues().answers ?? {};
    const next = { ...store, [active.key]: values };
    setStore(next);
    return next;
  }

  function goTo(idx: number) {
    if (idx === activeIdx) return;
    persistCurrent();
    const target = sections[idx];
    form.reset({ answers: buildDefaults(target.fields, store[target.key]) });
    setActiveIdx(idx);
    setError(null);
    setSaved(null);
  }

  async function save(action: "draft" | "submit") {
    setError(null);
    setSaved(null);
    const merged = persistCurrent();
    const memberAnswers: Record<string, Answers> = {};
    for (const m of members) memberAnswers[m.participant_id] = merged[m.participant_id] ?? {};

    setBusy(true);
    try {
      const res = await fetch(`/api/me/group-reports/${fill.group.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          group_answers: merged[GROUP_KEY] ?? {},
          member_answers: memberAnswers,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Jump to the offending member section if the server named one.
        if (json?.participant_id) {
          const idx = sections.findIndex((s) => s.key === json.participant_id);
          if (idx >= 0) goTo(idx);
        }
        throw new Error(json?.detail ?? "Could not save");
      }
      setStatus(json.status ?? (action === "submit" ? "submitted" : "draft"));
      setSaved(action === "submit" ? "Submitted · 已提交" : "Draft saved · 已保存草稿");
      if (action === "submit") {
        setTimeout(() => router.push("/me/group"), 1000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  const activeSchema = { version: 1, identity: {}, fields: active.fields } as unknown as FormSchema;
  const answerable = active.fields.filter((f) => f.type !== "section_header").length;

  return (
    <div className="mt-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-[24px] md:text-[28px] leading-[1.15] tracking-[-0.015em] text-[var(--ink)]">
            {fill.event.title_cn ?? fill.event.title_en ?? "Group report"}
          </h1>
          <div className="mt-1 text-[13px] text-[var(--ink-soft)]">
            Group {fill.group.group_no} · 第 {fill.group.group_no} 组 · 小组报告
          </div>
        </div>
        {status === "submitted" ? (
          <span className="text-[10.5px] tracking-[0.12em] uppercase px-2.5 py-1.5 rounded-[var(--radius-pill)] bg-[#5b9a5d]/12 text-[#3a6b3b]">
            ✓ Submitted · 已提交
          </span>
        ) : status === "draft" ? (
          <span className="text-[10.5px] tracking-[0.12em] uppercase px-2.5 py-1.5 rounded-[var(--radius-pill)] bg-[var(--paper-deep)] text-[var(--ink-mute)]">
            Draft · 草稿
          </span>
        ) : null}
      </div>

      <div className="mt-6 md:flex md:gap-6">
        {/* Sections sidebar */}
        <aside className="md:w-[220px] md:flex-none mb-4 md:mb-0">
          <div className="text-[9px] tracking-[0.28em] uppercase text-[var(--ink-faint)] mb-2 px-1">Sections</div>
          <ol className="flex md:flex-col gap-1.5 overflow-x-auto md:overflow-visible pb-2 md:pb-0">
            {sections.map((s, i) => {
              const activeS = i === activeIdx;
              return (
                <li key={s.key} className="flex-none">
                  <button
                    type="button"
                    onClick={() => goTo(i)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-[var(--radius-md)] text-left transition-colors duration-[var(--dur-fast)] ${
                      activeS ? "bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]" : "text-[var(--ink-soft)] hover:bg-[var(--paper-deep)]"
                    }`}
                  >
                    <span className={`flex-none inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] tabular-nums ${activeS ? "bg-[var(--cinnabar)] text-[var(--paper-warm)]" : "bg-[var(--paper-deep)] text-[var(--ink-mute)]"}`}>
                      {i + 1}
                    </span>
                    <span className="min-w-0 truncate text-[13px]">{s.label}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </aside>

        {/* Active section */}
        <div className="flex-1 min-w-0">
          <div className="rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] p-5 md:p-6 shadow-[var(--shadow-paper-1)]">
            <h2 className="font-display text-[18px] text-[var(--ink)]">{active.label}</h2>
            {active.sub ? <div className="text-[11px] tracking-[0.14em] uppercase text-[var(--ink-faint)] tabular-nums mt-0.5">{active.sub}</div> : null}

            <div className="mt-5">
              {answerable === 0 ? (
                <p className="text-[13px] text-[var(--ink-mute)]">No questions in this section.</p>
              ) : (
                <DynamicFormFields
                  schema={activeSchema}
                  locale="zh"
                  register={form.register}
                  control={form.control}
                  errors={form.formState.errors}
                />
              )}
            </div>
          </div>

          {error ? (
            <div role="alert" className="mt-4 rounded-[var(--radius-md)] border border-[var(--cinnabar)]/30 bg-[var(--cinnabar-wash)] px-4 py-3 text-[13px] text-[var(--cinnabar-deep)]">
              {error}
            </div>
          ) : null}
          {saved ? (
            <div className="mt-4 rounded-[var(--radius-md)] border border-[#5b9a5d]/30 bg-[#5b9a5d]/8 px-4 py-3 text-[13px] text-[#3a6b3b]">
              ✓ {saved}
            </div>
          ) : null}

          {/* Nav + actions */}
          <div className="mt-5 flex items-center gap-2.5 flex-wrap">
            <button
              type="button"
              onClick={() => goTo(Math.max(0, activeIdx - 1))}
              disabled={activeIdx === 0}
              className="px-3.5 h-10 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[12.5px] tracking-[0.06em] uppercase text-[var(--ink-soft)] hover:bg-[var(--paper-deep)] disabled:opacity-40 transition-colors"
            >
              ← Previous
            </button>
            {activeIdx < sections.length - 1 ? (
              <button
                type="button"
                onClick={() => goTo(Math.min(sections.length - 1, activeIdx + 1))}
                className="px-3.5 h-10 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[12.5px] tracking-[0.06em] uppercase text-[var(--ink-soft)] hover:bg-[var(--paper-deep)] transition-colors"
              >
                Next →
              </button>
            ) : null}

            <div className="flex-1" />

            <button
              type="button"
              onClick={() => save("draft")}
              disabled={busy}
              className="px-4 h-10 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[12.5px] tracking-[0.06em] uppercase text-[var(--ink-soft)] hover:bg-[var(--paper-deep)] active:translate-y-px disabled:opacity-50 transition-[background-color,transform] duration-[var(--dur-fast)]"
            >
              Save draft · 存草稿
            </button>
            <button
              type="button"
              onClick={() => save("submit")}
              disabled={busy}
              className="px-4 h-10 rounded-[var(--radius-md)] bg-[var(--cinnabar)] text-[var(--paper-warm)] text-[12.5px] tracking-[0.06em] uppercase hover:bg-[var(--cinnabar-deep)] active:translate-y-px disabled:opacity-50 transition-[background-color,transform] duration-[var(--dur-fast)]"
              style={{ color: "var(--paper-warm)" }}
            >
              {busy ? "Saving…" : status === "submitted" ? "Re-submit · 重新提交" : "Submit · 提交"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
