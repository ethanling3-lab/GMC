"use client";

import { useState } from "react";
import { CardShell } from "./CardShell";
import { Empty } from "./Field";
import { LabelRow } from "./FormControls";
import { useParticipantPatch } from "./useParticipantPatch";
import { MOTIVATIONS } from "@/lib/participant-import-schema";
import type { MotivationTag } from "@/lib/participants-query";
import { GROWTH_DIMENSION_LABEL } from "@/lib/grouping/types";
import type { GrowthDimension } from "@/lib/grouping/types";

// Algorithm Signals — the narrow set of fields the grouping algorithm
// reads. Three fields total:
//
//   motivation_tag   — categorical (clean / insurance / direct_sales /
//                      spiritual / other). LLM uses for profiling.
//   goal_dimensions  — ordered array of 1-4 growth dimensions; first =
//                      primary. balance.ts matches participants' primary
//                      goal to 组长 dimension strengths.
//   energy_profile   — soft balance (high / medium / quiet). Spread
//                      across groups so no table is all-quiet or all-loud.
//
// Other algorithm-readable fields live elsewhere:
//   - language_fluency, is_old_student → Identity card
//   - conflict_member_ids              → Relationships card
//   - student_qualification + scores   → Programme & Scoring card

export type EnrichmentData = {
  motivation_tag: MotivationTag | null;
  goal_dimensions: GrowthDimension[];
  energy_profile: "high" | "medium" | "quiet" | null;
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

const ENERGY_LABEL: Record<
  "high" | "medium" | "quiet",
  { cn: string; en: string }
> = {
  high: { cn: "高能", en: "High" },
  medium: { cn: "中等", en: "Medium" },
  quiet: { cn: "安静", en: "Quiet" },
};

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
    const ok = await patch({
      motivation_tag: draft.motivation_tag,
      goal_dimensions: draft.goal_dimensions,
      energy_profile: draft.energy_profile,
    });
    if (ok) setEditing(false);
  }

  function toggleGoal(d: GrowthDimension) {
    const next = draft.goal_dimensions.includes(d)
      ? draft.goal_dimensions.filter((x) => x !== d)
      : [...draft.goal_dimensions, d];
    setDraft({ ...draft, goal_dimensions: next });
  }

  function promoteGoal(d: GrowthDimension) {
    const next = [d, ...draft.goal_dimensions.filter((x) => x !== d)];
    setDraft({ ...draft, goal_dimensions: next });
  }

  return (
    <CardShell
      eyebrow="Algorithm signals"
      eyebrowZh="算法信号"
      title="The three fields that tune the grouping algorithm"
      editing={editing}
      saving={saving}
      error={error}
      onEdit={() => setEditing(true)}
      onCancel={cancel}
      onSave={save}
    >
      {editing ? (
        <div className="flex flex-col gap-6">
          {/* Motivation */}
          <LabelRow
            label="Motivation tag · 报名动机"
            hint="Categorical reason — used by the LLM to profile groups."
          >
            <select
              value={draft.motivation_tag ?? ""}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  motivation_tag:
                    (e.target.value || null) as MotivationTag | null,
                })
              }
              className="h-9 w-full px-3 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[13px] text-[var(--ink)] focus:border-[var(--cinnabar)]/50 focus:outline-none focus:shadow-[var(--shadow-focus)]"
            >
              <option value="">—</option>
              {MOTIVATION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </LabelRow>

          {/* Goal dimensions */}
          <LabelRow
            label="Goal dimensions · 成长维度"
            hint="Click to toggle. First selected = primary. Right-click to promote to primary."
          >
            <div className="grid grid-cols-2 gap-2">
              {DIMENSIONS.map((d) => {
                const idx = draft.goal_dimensions.indexOf(d);
                const isPrimary = idx === 0;
                const isSelected = idx >= 0;
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleGoal(d)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      promoteGoal(d);
                    }}
                    className={`flex items-center justify-between h-9 px-3 rounded-[var(--radius-md)] border text-[13px] transition-[background-color,border-color,color] duration-[var(--dur-fast)]
                      ${
                        isPrimary
                          ? "border-[var(--cinnabar)] bg-[var(--cinnabar)] text-[var(--paper-warm)]"
                          : isSelected
                            ? "border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
                            : "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-mute)] hover:border-[var(--cinnabar)]/30"
                      }`}
                  >
                    <span>
                      {GROWTH_DIMENSION_LABEL[d].icon}{" "}
                      {GROWTH_DIMENSION_LABEL[d].cn} · {GROWTH_DIMENSION_LABEL[d].en}
                    </span>
                    {isSelected ? (
                      <span className="text-[10px] tabular-nums opacity-80">
                        {isPrimary ? "PRIMARY" : `#${idx + 1}`}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </LabelRow>

          {/* Energy profile */}
          <LabelRow
            label="Energy profile · 能量水平"
            hint="Spread across groups so no table is all-quiet or all-loud."
          >
            <div className="grid grid-cols-3 gap-2">
              {(["high", "medium", "quiet"] as const).map((level) => {
                const active = draft.energy_profile === level;
                return (
                  <button
                    key={level}
                    type="button"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        energy_profile: active ? null : level,
                      })
                    }
                    className={`h-9 px-3 rounded-[var(--radius-md)] border text-[13px] transition-[background-color,border-color,color] duration-[var(--dur-fast)]
                      ${
                        active
                          ? "border-[var(--cinnabar)] bg-[var(--cinnabar)] text-[var(--paper-warm)]"
                          : "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-mute)] hover:border-[var(--cinnabar)]/30"
                      }`}
                  >
                    {ENERGY_LABEL[level].cn} · {ENERGY_LABEL[level].en}
                  </button>
                );
              })}
            </div>
          </LabelRow>
        </div>
      ) : (
        <dl className="grid md:grid-cols-3 gap-x-6 gap-y-5">
          <div className="flex flex-col gap-2">
            <dt className="text-[10px] tracking-[0.2em] uppercase text-[var(--ink-faint)]">
              Motivation
              <span className="ml-1.5 text-[var(--ink-faint)]/70 normal-case tracking-[0.14em]">报名动机</span>
            </dt>
            <dd className="text-[14px] text-[var(--ink)]">
              {initial.motivation_tag
                ? `${MOTIVATION_LABEL[initial.motivation_tag].en} · ${MOTIVATION_LABEL[initial.motivation_tag].zh}`
                : <Empty />}
            </dd>
          </div>
          <div className="flex flex-col gap-2">
            <dt className="text-[10px] tracking-[0.2em] uppercase text-[var(--ink-faint)]">
              Goal dimensions
              <span className="ml-1.5 text-[var(--ink-faint)]/70 normal-case tracking-[0.14em]">成长维度</span>
            </dt>
            <dd className="flex flex-wrap gap-1.5">
              {initial.goal_dimensions.length === 0 ? (
                <Empty />
              ) : (
                initial.goal_dimensions.map((d, i) => (
                  <span
                    key={d}
                    className={`inline-flex items-center h-5 px-2 rounded-[var(--radius-pill)] text-[11px] tracking-[0.04em]
                      ${
                        i === 0
                          ? "bg-[var(--cinnabar)] text-[var(--paper-warm)] font-medium"
                          : "bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
                      }`}
                  >
                    {GROWTH_DIMENSION_LABEL[d].icon} {GROWTH_DIMENSION_LABEL[d].cn}
                  </span>
                ))
              )}
            </dd>
          </div>
          <div className="flex flex-col gap-2">
            <dt className="text-[10px] tracking-[0.2em] uppercase text-[var(--ink-faint)]">
              Energy
              <span className="ml-1.5 text-[var(--ink-faint)]/70 normal-case tracking-[0.14em]">能量水平</span>
            </dt>
            <dd className="text-[14px] text-[var(--ink)]">
              {initial.energy_profile
                ? `${ENERGY_LABEL[initial.energy_profile].cn} · ${ENERGY_LABEL[initial.energy_profile].en}`
                : <Empty />}
            </dd>
          </div>
        </dl>
      )}
    </CardShell>
  );
}
