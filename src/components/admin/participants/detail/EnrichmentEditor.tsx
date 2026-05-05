"use client";

import { useState } from "react";
import { CardShell } from "./CardShell";
import { Field, Empty } from "./Field";
import { LabelRow, Select, Textarea, Toggle } from "./FormControls";
import { useParticipantPatch } from "./useParticipantPatch";
import {
  ConflictPairsEditor,
  ConflictPartnersDisplay,
  type ConflictPartner,
} from "./ConflictPairsEditor";
import { MOTIVATIONS } from "@/lib/participant-import-schema";
import type { MotivationTag } from "@/lib/participants-query";
import { GROWTH_DIMENSION_LABEL } from "@/lib/grouping/types";
import type { GrowthDimension } from "@/lib/grouping/types";

export type EnrichmentData = {
  motivation_tag: MotivationTag | null;
  is_old_student: boolean;
  personality: string | null;
  face_type: string | null;
  parameter_framework: string | null;
  goal_dimensions: GrowthDimension[];
  // Migration 030 — grouping signals.
  energy_profile: "high" | "medium" | "quiet" | null;
  language_fluency: "en" | "cn" | "both" | null;
  conflict_partners: ConflictPartner[];
};

const DIMENSIONS: GrowthDimension[] = [
  "financial",
  "relationship",
  "health",
  "inner_peace",
];

const MOTIVATION_LABEL: Record<MotivationTag, { en: string; zh: string }> = {
  clean: { en: "Clean", zh: "纯粹" },
  insurance: { en: "Insurance", zh: "保险" },
  direct_sales: { en: "Direct sales", zh: "直销" },
  spiritual: { en: "Spiritual", zh: "灵性" },
  other: { en: "Other", zh: "其他" },
};

const MOTIVATION_OPTIONS = (MOTIVATIONS as readonly MotivationTag[]).map((m) => ({
  value: m,
  label: `${MOTIVATION_LABEL[m].en} · ${MOTIVATION_LABEL[m].zh}`,
}));

const ENERGY_LABEL: Record<"high" | "medium" | "quiet", { cn: string; en: string }> = {
  high: { cn: "高能", en: "High" },
  medium: { cn: "中等", en: "Medium" },
  quiet: { cn: "安静", en: "Quiet" },
};

const LANGUAGE_LABEL: Record<"en" | "cn" | "both", { cn: string; en: string }> = {
  en: { cn: "英语", en: "EN" },
  cn: { cn: "中文", en: "CN" },
  both: { cn: "双语", en: "Both" },
};

// Inline tag — sits next to a field label so admin sees which fields
// the algorithm reads.
function FeedsBuilder() {
  return (
    <span
      title="This field feeds the GroupBuilder algorithm."
      className="ml-2 inline-flex items-center px-1.5 h-[15px] rounded-[var(--radius-pill)] border border-[var(--cinnabar)]/30 bg-[var(--cinnabar-wash)]/40 text-[8.5px] tracking-[0.18em] uppercase text-[var(--cinnabar-deep)] align-middle"
    >
      feeds groupBuilder
    </span>
  );
}

function SectionHeader({
  eyebrow,
  eyebrowZh,
  tone,
}: {
  eyebrow: string;
  eyebrowZh: string;
  tone: "cinnabar" | "paper";
}) {
  const color =
    tone === "cinnabar"
      ? "text-[var(--cinnabar)]"
      : "text-[var(--ink-faint)]";
  return (
    <div
      className={`inline-flex items-center gap-2 text-[10px] tracking-[0.22em] uppercase ${color}`}
    >
      <span className={tone === "cinnabar" ? "w-4 h-px bg-current" : "w-4 h-px bg-current opacity-60"} />
      <span>{eyebrow}</span>
      <span className="opacity-70">·</span>
      <span>{eyebrowZh}</span>
    </div>
  );
}

export function EnrichmentEditor({
  participantId,
  initial,
}: {
  participantId: string;
  initial: EnrichmentData;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<EnrichmentData>(initial);
  const { saving, error, setError, patch } = useParticipantPatch(participantId);

  function cancel() {
    setDraft(initial);
    setEditing(false);
    setError(null);
  }

  async function save() {
    // Send only fields the schema accepts. conflict_partners is the
    // hydrated UI shape; the PATCH route wants conflict_member_ids.
    const ok = await patch({
      motivation_tag: draft.motivation_tag,
      is_old_student: draft.is_old_student,
      personality: draft.personality,
      face_type: draft.face_type,
      parameter_framework: draft.parameter_framework,
      goal_dimensions: draft.goal_dimensions,
      energy_profile: draft.energy_profile,
      language_fluency: draft.language_fluency,
      conflict_member_ids: draft.conflict_partners.map((p) => p.id),
    });
    if (ok) setEditing(false);
  }

  function toggleGoalDimension(d: GrowthDimension) {
    const has = draft.goal_dimensions.includes(d);
    if (has) {
      setDraft({
        ...draft,
        goal_dimensions: draft.goal_dimensions.filter((x) => x !== d),
      });
    } else {
      setDraft({ ...draft, goal_dimensions: [...draft.goal_dimensions, d] });
    }
  }

  function moveGoalToFront(d: GrowthDimension) {
    if (!draft.goal_dimensions.includes(d)) return;
    setDraft({
      ...draft,
      goal_dimensions: [d, ...draft.goal_dimensions.filter((x) => x !== d)],
    });
  }

  return (
    <CardShell
      eyebrow="CS Enrichment"
      eyebrowZh="资料"
      title="Qualitative profile"
      editing={editing}
      saving={saving}
      error={error}
      onEdit={() => setEditing(true)}
      onCancel={cancel}
      onSave={save}
    >
      {editing ? (
        <div className="flex flex-col gap-7">
          {/* SECTION A — GROUPING SIGNALS */}
          <div className="flex flex-col gap-5">
            <SectionHeader
              eyebrow="Grouping signals"
              eyebrowZh="编排信号"
              tone="cinnabar"
            />

            <div>
              <span className="text-[10px] tracking-[0.2em] uppercase text-[var(--ink-faint)]">
                Goal Dimensions · 成长方向 (first = primary)
                <FeedsBuilder />
              </span>
              <div className="mt-2 flex flex-wrap gap-2">
                {DIMENSIONS.map((d) => {
                  const idx = draft.goal_dimensions.indexOf(d);
                  const on = idx >= 0;
                  const isPrimary = idx === 0;
                  const lab = GROWTH_DIMENSION_LABEL[d];
                  return (
                    <button
                      type="button"
                      key={d}
                      onClick={() => toggleGoalDimension(d)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        moveGoalToFront(d);
                      }}
                      title={
                        on
                          ? "Click to remove · right-click to make primary"
                          : "Click to add"
                      }
                      className={`px-3 py-1.5 rounded-full text-[12px] tracking-[0.04em] border transition-colors duration-[var(--dur-fast)] ${
                        isPrimary
                          ? "border-[var(--cinnabar)] bg-[var(--cinnabar)] text-[var(--paper)]"
                          : on
                            ? "border-[var(--cinnabar)]/60 bg-[var(--cinnabar)]/10 text-[var(--cinnabar)]"
                            : "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-mute)]"
                      }`}
                    >
                      {isPrimary ? "★ " : ""}
                      {lab.icon} {lab.cn}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-[11px] text-[var(--ink-faint)]">
                Right-click a chip to make it primary. The algorithm matches each
                participant's primary goal to a 组长's strengths.
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-x-8 gap-y-5">
              <LabelRow
                label="Motivation"
                labelZh="动机"
                trailing={<FeedsBuilder />}
              >
                <Select
                  value={draft.motivation_tag}
                  onChange={(v) => setDraft({ ...draft, motivation_tag: v })}
                  options={MOTIVATION_OPTIONS}
                />
              </LabelRow>
              <LabelRow
                label="Old student"
                labelZh="老学员"
                trailing={<FeedsBuilder />}
              >
                <Toggle
                  value={draft.is_old_student}
                  onChange={(v) => setDraft({ ...draft, is_old_student: v })}
                />
              </LabelRow>
            </div>

            <div className="grid md:grid-cols-2 gap-x-8 gap-y-5">
              <div>
                <span className="text-[10px] tracking-[0.2em] uppercase text-[var(--ink-faint)]">
                  Energy profile · 能量
                  <FeedsBuilder />
                </span>
                <div className="mt-2 flex gap-2">
                  {(["high", "medium", "quiet"] as const).map((v) => {
                    const on = draft.energy_profile === v;
                    const lab = ENERGY_LABEL[v];
                    return (
                      <button
                        type="button"
                        key={v}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            energy_profile: on ? null : v,
                          })
                        }
                        className={`px-3 py-1.5 rounded-full text-[12px] tracking-[0.04em] border transition-colors duration-[var(--dur-fast)] ${
                          on
                            ? "border-[var(--cinnabar)] bg-[var(--cinnabar)] text-[var(--paper)]"
                            : "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-mute)]"
                        }`}
                      >
                        {lab.cn} · {lab.en}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-[11px] text-[var(--ink-faint)]">
                  Algorithm spreads energy levels evenly across groups.
                </p>
              </div>

              <div>
                <span className="text-[10px] tracking-[0.2em] uppercase text-[var(--ink-faint)]">
                  Language fluency · 语言
                  <FeedsBuilder />
                </span>
                <div className="mt-2 flex gap-2">
                  {(["cn", "en", "both"] as const).map((v) => {
                    const on = draft.language_fluency === v;
                    const lab = LANGUAGE_LABEL[v];
                    return (
                      <button
                        type="button"
                        key={v}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            language_fluency: on ? null : v,
                          })
                        }
                        className={`px-3 py-1.5 rounded-full text-[12px] tracking-[0.04em] border transition-colors duration-[var(--dur-fast)] ${
                          on
                            ? "border-[var(--cinnabar)] bg-[var(--cinnabar)] text-[var(--paper)]"
                            : "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-mute)]"
                        }`}
                      >
                        {lab.en} · {lab.cn}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-[11px] text-[var(--ink-faint)]">
                  Each group needs ≥1 speaker of each language present.
                </p>
              </div>
            </div>

            <div>
              <span className="text-[10px] tracking-[0.2em] uppercase text-[var(--ink-faint)]">
                Conflict pairs · 冲突
                <FeedsBuilder />
              </span>
              <ConflictPairsEditor
                participantId={participantId}
                partners={draft.conflict_partners}
                onChange={(next) =>
                  setDraft({ ...draft, conflict_partners: next })
                }
              />
            </div>
          </div>

          {/* SECTION B — QUALITATIVE NOTES */}
          <div className="flex flex-col gap-5 pt-4 border-t border-[var(--paper-shadow)]/60">
            <SectionHeader
              eyebrow="Qualitative notes"
              eyebrowZh="资料备注"
              tone="paper"
            />

            <LabelRow label="Personality" labelZh="性格">
              <Textarea
                rows={3}
                value={draft.personality ?? ""}
                onChange={(v) => setDraft({ ...draft, personality: v })}
                placeholder="Observations on temperament, decision style, energy…"
              />
            </LabelRow>
            <LabelRow
              label="Face type"
              labelZh="面相"
              hint="Free-text notes. Distinct from the auto-classified 面相 archetype in the Face reading card below."
            >
              <Textarea
                rows={3}
                value={draft.face_type ?? ""}
                onChange={(v) => setDraft({ ...draft, face_type: v })}
                placeholder="Qualitative notes per Dr Wu's framework"
              />
            </LabelRow>
            <LabelRow label="Parameter framework" labelZh="参数体系">
              <Textarea
                rows={3}
                value={draft.parameter_framework ?? ""}
                onChange={(v) =>
                  setDraft({ ...draft, parameter_framework: v })
                }
                placeholder="Framework-specific parameters"
              />
            </LabelRow>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {/* SECTION A — GROUPING SIGNALS (view) */}
          <div className="flex flex-col gap-4">
            <SectionHeader
              eyebrow="Grouping signals"
              eyebrowZh="编排信号"
              tone="cinnabar"
            />
            <dl className="grid md:grid-cols-2 gap-x-8 gap-y-5">
              <Field label="Goal dimensions" labelZh="成长方向">
                {initial.goal_dimensions.length === 0 ? (
                  <Empty />
                ) : (
                  <span className="inline-flex flex-wrap gap-1.5">
                    {initial.goal_dimensions.map((d, i) => (
                      <span
                        key={d}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] ${
                          i === 0
                            ? "border-[var(--cinnabar)] bg-[var(--cinnabar)] text-[var(--paper)]"
                            : "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink)]"
                        }`}
                      >
                        {i === 0 ? "★ " : ""}
                        {GROWTH_DIMENSION_LABEL[d].icon} {GROWTH_DIMENSION_LABEL[d].cn}
                      </span>
                    ))}
                  </span>
                )}
              </Field>
              <Field label="Motivation" labelZh="动机">
                {initial.motivation_tag ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-full border border-[var(--paper-shadow)] bg-[var(--paper)] text-[11px] tracking-[0.1em] uppercase text-[var(--ink)]">
                      {MOTIVATION_LABEL[initial.motivation_tag].en}
                    </span>
                    <span className="text-[var(--ink-mute)] text-[12px]">
                      {MOTIVATION_LABEL[initial.motivation_tag].zh}
                    </span>
                  </span>
                ) : (
                  <Empty />
                )}
              </Field>
              <Field label="Old student" labelZh="老学员">
                {initial.is_old_student ? (
                  <span className="inline-flex items-center gap-1.5 text-[var(--cinnabar-deep)]">
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-[var(--cinnabar)]"
                      aria-hidden="true"
                    />
                    Yes · 是
                  </span>
                ) : (
                  <span className="text-[var(--ink-mute)]">No · 否</span>
                )}
              </Field>
              <Field label="Energy profile" labelZh="能量">
                {initial.energy_profile ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-full border border-[var(--paper-shadow)] bg-[var(--paper)] text-[11px] tracking-[0.06em] text-[var(--ink)]">
                      {ENERGY_LABEL[initial.energy_profile].en}
                    </span>
                    <span className="text-[var(--ink-mute)] text-[12px]">
                      {ENERGY_LABEL[initial.energy_profile].cn}
                    </span>
                  </span>
                ) : (
                  <Empty />
                )}
              </Field>
              <Field label="Language fluency" labelZh="语言">
                {initial.language_fluency ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-full border border-[var(--paper-shadow)] bg-[var(--paper)] text-[11px] tracking-[0.06em] text-[var(--ink)]">
                      {LANGUAGE_LABEL[initial.language_fluency].en}
                    </span>
                    <span className="text-[var(--ink-mute)] text-[12px]">
                      {LANGUAGE_LABEL[initial.language_fluency].cn}
                    </span>
                  </span>
                ) : (
                  <Empty />
                )}
              </Field>
              <Field label="Conflict pairs" labelZh="冲突">
                <ConflictPartnersDisplay partners={initial.conflict_partners} />
              </Field>
            </dl>
          </div>

          {/* SECTION B — QUALITATIVE NOTES (view) */}
          <div className="flex flex-col gap-4 pt-4 border-t border-[var(--paper-shadow)]/60">
            <SectionHeader
              eyebrow="Qualitative notes"
              eyebrowZh="资料备注"
              tone="paper"
            />
            <dl className="grid md:grid-cols-2 gap-x-8 gap-y-5">
              <Field label="Personality" labelZh="性格" multiline>
                {initial.personality ?? <Empty />}
              </Field>
              <Field label="Face type" labelZh="面相" multiline>
                {initial.face_type ?? <Empty />}
              </Field>
              <Field label="Parameter framework" labelZh="参数体系" multiline>
                {initial.parameter_framework ?? <Empty />}
              </Field>
            </dl>
          </div>
        </div>
      )}
    </CardShell>
  );
}
