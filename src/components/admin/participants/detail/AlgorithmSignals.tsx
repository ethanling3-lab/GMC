"use client";

import { Empty } from "./Field";
import { LabelRow, TextInput, Toggle } from "./FormControls";
import {
  MOTIVATIONS,
  MOTIVATION_LABEL,
  motivationCn,
  type MotivationTag,
} from "@/lib/participants/motivations";
import { GROWTH_DIMENSION_LABEL } from "@/lib/grouping/types";
import type { GrowthDimension } from "@/lib/grouping/types";

// Algorithm signals — the three grouping inputs that sit alongside the
// scores in the Programme & Scoring card (no card of their own):
//
//   motivations      — WHY they attend: ordered array, first = main reason
//                      (networking / spiritual / business / family / other).
//                      LLM uses for profiling.
//   sells_products   — CAUTION flag (DB name kept): may be here to recruit for
//                      insurance / direct sales / MLM, i.e. not 纯真. For admin
//                      + CS attention; grouping leaves them for manual placement.
//   goal_dimensions  — ordered array of 1-4 growth dimensions; first =
//                      primary. balance.ts matches participants' primary
//                      goal to 组长 dimension strengths.
//   energy_profile   — soft balance (high / medium / quiet). Spread
//                      across groups so no table is all-quiet or all-loud.
//
// Other algorithm-readable fields live elsewhere:
//   - language_fluency, is_old_student → Identity card
//   - conflict_member_ids              → Relationships card

export type AlgorithmSignalsData = {
  motivations: MotivationTag[];
  /** Free text, only kept while 'other' is ticked. */
  motivation_other: string | null;
  sells_products: boolean;
  goal_dimensions: GrowthDimension[];
  energy_profile: "high" | "medium" | "quiet" | null;
};

const DIMENSIONS: GrowthDimension[] = [
  "financial",
  "relationship",
  "health",
  "inner_peace",
];

const ENERGY_LABEL: Record<
  "high" | "medium" | "quiet",
  { cn: string; en: string }
> = {
  high: { cn: "高能", en: "High" },
  medium: { cn: "中等", en: "Medium" },
  quiet: { cn: "安静", en: "Quiet" },
};

export function AlgorithmSignalsEdit({
  value,
  onChange,
}: {
  value: AlgorithmSignalsData;
  onChange: (next: AlgorithmSignalsData) => void;
}) {
  function toggleMotivation(m: MotivationTag) {
    const removing = value.motivations.includes(m);
    const next = removing
      ? value.motivations.filter((x) => x !== m)
      : [...value.motivations, m];
    onChange({
      ...value,
      motivations: next,
      // Unticking Other drops its free text.
      ...(removing && m === "other" ? { motivation_other: null } : {}),
    });
  }

  function promoteMotivation(m: MotivationTag) {
    onChange({ ...value, motivations: [m, ...value.motivations.filter((x) => x !== m)] });
  }

  function toggleGoal(d: GrowthDimension) {
    const next = value.goal_dimensions.includes(d)
      ? value.goal_dimensions.filter((x) => x !== d)
      : [...value.goal_dimensions, d];
    onChange({ ...value, goal_dimensions: next });
  }

  function promoteGoal(d: GrowthDimension) {
    const next = [d, ...value.goal_dimensions.filter((x) => x !== d)];
    onChange({ ...value, goal_dimensions: next });
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Motivation — why they attend */}
      <LabelRow
        group
        label="Motivation · 报名动机"
        hint="Why they are attending. Click to toggle; first selected = main reason. Right-click to make main."
      >
        <div className="grid grid-cols-2 gap-2">
          {MOTIVATIONS.map((m) => {
            const idx = value.motivations.indexOf(m);
            const isMain = idx === 0;
            const isSelected = idx >= 0;
            return (
              <button
                key={m}
                type="button"
                onClick={() => toggleMotivation(m)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  promoteMotivation(m);
                }}
                className={`flex items-center justify-between h-9 px-3 rounded-[var(--radius-md)] border text-[13px] transition-[background-color,border-color,color] duration-[var(--dur-fast)] focus-visible:shadow-[var(--shadow-focus)] active:scale-[0.98]
                  ${
                    isMain
                      ? "border-[var(--cinnabar)] bg-[var(--cinnabar)] text-[var(--paper-warm)]"
                      : isSelected
                        ? "border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
                        : "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-mute)] hover:border-[var(--cinnabar)]/30"
                  }`}
              >
                <span>
                  {MOTIVATION_LABEL[m].cn} · {MOTIVATION_LABEL[m].en}
                </span>
                {isSelected ? (
                  <span className="text-[10px] tabular-nums opacity-80">
                    {isMain ? "MAIN" : `#${idx + 1}`}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        {value.motivations.includes("other") ? (
          <div className="mt-1">
            <TextInput
              value={value.motivation_other ?? ""}
              onChange={(v) => onChange({ ...value, motivation_other: v })}
              placeholder="Other reason · 请填写其他原因"
            />
          </div>
        ) : null}
      </LabelRow>

      {/* Caution flag — may recruit for insurance / direct sales / MLM */}
      <LabelRow
        label="Caution: may recruit for insurance / direct sales / MLM · 注意：可能拉保险/直销/传销"
        hint="Not here purely to learn (不纯真). Flags this person for admin and CS attention."
      >
        <Toggle
          value={value.sells_products}
          onChange={(v) => onChange({ ...value, sells_products: v })}
          labels={{ on: "Yes · 是", off: "No · 否" }}
        />
      </LabelRow>

      {/* Goal dimensions */}
      <LabelRow
        group
        label="Goal dimensions · 成长维度"
        hint="Click to toggle. First selected = primary. Right-click to promote to primary."
      >
        <div className="grid grid-cols-2 gap-2">
          {DIMENSIONS.map((d) => {
            const idx = value.goal_dimensions.indexOf(d);
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
        group
        label="Energy profile · 能量水平"
        hint="Spread across groups so no table is all-quiet or all-loud."
      >
        <div className="grid grid-cols-3 gap-2">
          {(["high", "medium", "quiet"] as const).map((level) => {
            const active = value.energy_profile === level;
            return (
              <button
                key={level}
                type="button"
                onClick={() =>
                  onChange({ ...value, energy_profile: active ? null : level })
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
  );
}

export function AlgorithmSignalsRead({ value }: { value: AlgorithmSignalsData }) {
  return (
    <dl className="grid md:grid-cols-3 gap-x-6 gap-y-5">
      <div className="flex flex-col gap-2">
        <dt className="text-[10px] tracking-[0.2em] uppercase text-[var(--ink-faint)]">
          Motivation
          <span className="ml-1.5 text-[var(--ink-faint)]/70 normal-case tracking-[0.14em]">报名动机</span>
        </dt>
        <dd className="flex flex-wrap gap-1.5">
          {value.motivations.length === 0 ? (
            <Empty />
          ) : (
            value.motivations.map((m, i) => (
              <span
                key={m}
                className={`inline-flex items-center h-5 px-2 rounded-[var(--radius-pill)] text-[11px] tracking-[0.04em]
                  ${
                    i === 0
                      ? "bg-[var(--cinnabar)] text-[var(--paper-warm)] font-medium"
                      : "bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
                  }`}
              >
                {motivationCn(m, value.motivation_other)}
              </span>
            ))
          )}
          {value.sells_products ? (
            <span className="inline-flex items-center h-5 px-2 rounded-[var(--radius-pill)] border border-[#b7791f]/40 bg-[#fdf3e1] text-[11px] tracking-[0.04em] text-[#8a5a12]">
              ⚠ 可能拉保险/直销/传销
            </span>
          ) : null}
        </dd>
      </div>
      <div className="flex flex-col gap-2">
        <dt className="text-[10px] tracking-[0.2em] uppercase text-[var(--ink-faint)]">
          Goal dimensions
          <span className="ml-1.5 text-[var(--ink-faint)]/70 normal-case tracking-[0.14em]">成长维度</span>
        </dt>
        <dd className="flex flex-wrap gap-1.5">
          {value.goal_dimensions.length === 0 ? (
            <Empty />
          ) : (
            value.goal_dimensions.map((d, i) => (
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
          {value.energy_profile
            ? `${ENERGY_LABEL[value.energy_profile].cn} · ${ENERGY_LABEL[value.energy_profile].en}`
            : <Empty />}
        </dd>
      </div>
    </dl>
  );
}
