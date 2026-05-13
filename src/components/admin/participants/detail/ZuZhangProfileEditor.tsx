"use client";

import { useState } from "react";
import {
  GROWTH_DIMENSION_LABEL,
  STUDENT_QUALIFICATION_LABEL,
  ZU_ZHANG_TIER_LABEL,
  ZU_ZHANG_TRAIT_LABEL,
  scoreToQualification,
} from "@/lib/grouping/types";
import type {
  GrowthDimension,
  StudentQualification,
  ZuZhangCoreTrait,
  ZuZhangTier,
} from "@/lib/grouping/types";
import { CardShell } from "./CardShell";
import { LabelRow } from "./FormControls";
import { useParticipantPatch } from "./useParticipantPatch";

// Per-participant 组长 profile.
//
// Edits (all gated on tier being set):
//   * zu_zhang_tier — global eligibility tag (4 tiers + "Not eligible")
//   * zu_zhang_dimensions — growth dimensions this leader excels in
//     (rendered as "Group Leader Key Strengths · 组长核心优势")
//   * zu_zhang_core_traits — multi-select of the 5 trait categories
//
// `has_special_contribution` moved to the Programme & Scoring card —
// it's a soft scoring signal, not a leader-role attribute.
//
// Read-only:
//   * times_led_groups — cached counter from zu_zhang_history
//
// Goal dimensions (成长方向) live on the CS Enrichment / Qualitative
// profile card — they're a participant-wide concept, not 组长-specific.
// Upgrade potential lives on the Student Category card.
// Qualification override lives on the Scoring card — it modifies the
// derived qualification regardless of whether someone is a 组长.

export type ZuZhangProfileData = {
  financial_score: number | null;
  influence_score: number | null;
  zu_zhang_tier: ZuZhangTier | null;
  zu_zhang_grade: number | null;
  zu_zhang_dimensions: GrowthDimension[];
  zu_zhang_core_traits: ZuZhangCoreTrait[];
  times_led_groups: number;
};

const TIER_OPTIONS: Array<{ value: ZuZhangTier | ""; label: string }> = [
  { value: "", label: "— Not eligible / 非组长" },
  { value: "key_recruitment", label: "重点感召型 · Key Recruitment" },
  { value: "recruitment", label: "感召型 · Recruitment" },
  { value: "maintenance", label: "维护型 · Maintenance" },
  { value: "auxiliary", label: "辅助 · Auxiliary" },
];

const DIMENSIONS: GrowthDimension[] = [
  "financial",
  "relationship",
  "health",
  "inner_peace",
];

const CORE_TRAITS: ZuZhangCoreTrait[] = [
  "logical_thinking",
  "social_intelligence",
  "adaptability",
  "goal_orientation",
  "attention_to_detail",
];

const SELECT_CLASS =
  "h-9 w-full px-3 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[13px] text-[var(--ink)] focus:border-[var(--cinnabar)]/50 focus:outline-none focus:shadow-[var(--shadow-focus)]";

function eligibilityHint(
  tier: ZuZhangTier | null,
  qualification: StudentQualification | null,
  timesLed: number,
): string | null {
  if (!tier) return null;
  const qScore = qualification
    ? STUDENT_QUALIFICATION_LABEL[qualification].score
    : 0;
  if (tier === "key_recruitment") {
    if (timesLed >= 20 && qScore >= 4) return null;
    return `重点感召型 typically requires 带组 ≥20 + 卓越级+, OR 区域负责人, OR 特殊贡献 (now tracked on Programme & Scoring card). This person has 带组 ${timesLed}${qualification ? ` + ${STUDENT_QUALIFICATION_LABEL[qualification].cn}` : ""} — confirm before saving.`;
  }
  if (tier === "recruitment") {
    if (timesLed >= 10 && qScore >= 3) return null;
    return `感召型 typically requires 带组 ≥10 + 精英级+. This person has 带组 ${timesLed}${qualification ? ` + ${STUDENT_QUALIFICATION_LABEL[qualification].cn}` : ""} — confirm before saving.`;
  }
  if (tier === "maintenance") {
    if (timesLed >= 5 && qScore >= 2) return null;
    return `维护型 typically requires 带组 ≥5 + 成长级+. This person has 带组 ${timesLed}${qualification ? ` + ${STUDENT_QUALIFICATION_LABEL[qualification].cn}` : ""} — confirm before saving.`;
  }
  if (tier === "auxiliary") {
    if (qScore >= 2) return null;
    return `辅助 typically requires 成长级+. This person has${qualification ? ` ${STUDENT_QUALIFICATION_LABEL[qualification].cn}` : " no qualification yet"} — confirm before saving.`;
  }
  return null;
}

export function ZuZhangProfileEditor({
  participantId,
  initial,
}: {
  participantId: string;
  initial: ZuZhangProfileData;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ZuZhangProfileData>(initial);
  const { saving, error, setError, patch } = useParticipantPatch(participantId);

  function cancel() {
    setDraft(initial);
    setEditing(false);
    setError(null);
  }

  async function save() {
    // Tier=null wipes grade — an ungraded leader's queue position is
    // tier-relative, so a null tier has nowhere to put a grade.
    const payload: Record<string, unknown> = {
      zu_zhang_tier: draft.zu_zhang_tier,
      zu_zhang_grade: draft.zu_zhang_tier ? draft.zu_zhang_grade : null,
      zu_zhang_dimensions: draft.zu_zhang_dimensions,
      zu_zhang_core_traits: draft.zu_zhang_core_traits,
    };
    const ok = await patch(payload);
    if (ok) setEditing(false);
  }

  function toggleStrength(d: GrowthDimension) {
    const has = draft.zu_zhang_dimensions.includes(d);
    setDraft({
      ...draft,
      zu_zhang_dimensions: has
        ? draft.zu_zhang_dimensions.filter((x) => x !== d)
        : [...draft.zu_zhang_dimensions, d],
    });
  }

  function toggleCoreTrait(t: ZuZhangCoreTrait) {
    const has = draft.zu_zhang_core_traits.includes(t);
    setDraft({
      ...draft,
      zu_zhang_core_traits: has
        ? draft.zu_zhang_core_traits.filter((x) => x !== t)
        : [...draft.zu_zhang_core_traits, t],
    });
  }

  // Eligibility hint judges against RAW scores (override is a separate
  // concept on the Scoring card and would muddy the tier-eligibility
  // signal — admin should know if someone *would* qualify by their
  // underlying scores, regardless of any soft-factor downgrade).
  const computedQualification = scoreToQualification(
    Math.max(initial.financial_score ?? 0, initial.influence_score ?? 0) || null,
  );

  const tierSet = !!draft.zu_zhang_tier;
  const hint = editing
    ? eligibilityHint(
        draft.zu_zhang_tier,
        computedQualification,
        initial.times_led_groups,
      )
    : null;

  return (
    <CardShell
      eyebrow="Group Leader Profile"
      eyebrowZh="组长档案"
      title="Group leader curation"
      editing={editing}
      saving={saving}
      error={error}
      onEdit={() => setEditing(true)}
      onCancel={cancel}
      onSave={save}
    >
      {editing ? (
        <div className="flex flex-col gap-7">
          {/* Tier — always visible. Everything below it gates on tier set. */}
          <LabelRow label="Tier · 组长等级">
            <select
              value={draft.zu_zhang_tier ?? ""}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  zu_zhang_tier: (e.target.value || null) as ZuZhangTier | null,
                })
              }
              className={SELECT_CLASS}
            >
              {TIER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </LabelRow>

          {hint ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--gold)]/30 bg-[var(--gold-soft)]/40 px-4 py-3 text-[12px] leading-[1.6] text-[var(--ink-mute)]">
              {hint}
            </div>
          ) : null}

          {tierSet ? (
            <>
              {/* Leader Grade — intra-tier priority order. */}
              <div>
                <span className="text-[10px] tracking-[0.2em] uppercase text-[var(--ink-faint)]">
                  Leader Grade · 组长评分
                </span>
                <div className="mt-2 flex items-center gap-2">
                  {[1, 2, 3, 4, 5].map((n) => {
                    const on = draft.zu_zhang_grade === n;
                    return (
                      <button
                        type="button"
                        key={n}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            zu_zhang_grade: on ? null : n,
                          })
                        }
                        className={`w-9 h-9 rounded-full text-[13px] font-display tabular-nums border transition-colors duration-[var(--dur-fast)] ${
                          on
                            ? "border-[var(--cinnabar)] bg-[var(--cinnabar)] text-[var(--paper)]"
                            : "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-mute)] hover:border-[var(--cinnabar)]/40"
                        }`}
                        aria-pressed={on}
                        aria-label={`Grade ${n}`}
                      >
                        {n}
                      </button>
                    );
                  })}
                  {draft.zu_zhang_grade != null ? (
                    <button
                      type="button"
                      onClick={() => setDraft({ ...draft, zu_zhang_grade: null })}
                      className="ml-1 text-[11px] text-[var(--ink-faint)] hover:text-[var(--ink-mute)]"
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
                <p className="mt-2 text-[11.5px] leading-[1.55] text-[var(--ink-faint)]">
                  Higher = more prominent placement within the same tier. M6.6
                  floor-plan auto-place pairs the highest-graded leader of each
                  tier with priority tables on the venue layout.
                </p>
              </div>

              {/* Group Leader Key Strengths — growth dimensions covered. */}
              <div>
                <span className="text-[10px] tracking-[0.2em] uppercase text-[var(--ink-faint)]">
                  Group Leader Key Strengths · 组长核心优势
                </span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {DIMENSIONS.map((d) => {
                    const on = draft.zu_zhang_dimensions.includes(d);
                    const lab = GROWTH_DIMENSION_LABEL[d];
                    return (
                      <button
                        type="button"
                        key={d}
                        onClick={() => toggleStrength(d)}
                        className={`px-3 py-1.5 rounded-full text-[12px] tracking-[0.04em] border transition-colors duration-[var(--dur-fast)] ${
                          on
                            ? "border-[var(--cinnabar)] bg-[var(--cinnabar)]/10 text-[var(--cinnabar)]"
                            : "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-mute)]"
                        }`}
                      >
                        {lab.icon} {lab.cn} · {lab.en}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Core Traits — categorical multi-select. */}
              <div>
                <span className="text-[10px] tracking-[0.2em] uppercase text-[var(--ink-faint)]">
                  Core Traits · 核心特质
                </span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {CORE_TRAITS.map((t) => {
                    const on = draft.zu_zhang_core_traits.includes(t);
                    const lab = ZU_ZHANG_TRAIT_LABEL[t];
                    return (
                      <button
                        type="button"
                        key={t}
                        onClick={() => toggleCoreTrait(t)}
                        className={`px-3 py-1.5 rounded-full text-[12px] tracking-[0.04em] border transition-colors duration-[var(--dur-fast)] ${
                          on
                            ? "border-[var(--cinnabar)] bg-[var(--cinnabar)]/10 text-[var(--cinnabar)]"
                            : "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-mute)]"
                        }`}
                      >
                        {lab.cn} · {lab.en}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          ) : null}

          <div className="text-[11px] text-[var(--ink-faint)]">
            带组次数 · Times led groups:{" "}
            <span className="text-[var(--ink)]">{initial.times_led_groups}</span>{" "}
            (auto-maintained from zu_zhang_history)
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <ReadRow
            label="Tier · 组长等级"
            value={
              initial.zu_zhang_tier
                ? `${ZU_ZHANG_TIER_LABEL[initial.zu_zhang_tier].cn} · ${ZU_ZHANG_TIER_LABEL[initial.zu_zhang_tier].en}`
                : "Not eligible · 非组长"
            }
          />

          {initial.zu_zhang_tier ? (
            <>
              <ReadRow
                label="Leader Grade · 组长评分"
                value={
                  initial.zu_zhang_grade != null
                    ? `${initial.zu_zhang_grade} / 5`
                    : "—"
                }
              />
              <ReadRow
                label="Key Strengths · 组长核心优势"
                value={
                  initial.zu_zhang_dimensions.length === 0
                    ? "—"
                    : initial.zu_zhang_dimensions
                        .map(
                          (d) =>
                            `${GROWTH_DIMENSION_LABEL[d].icon} ${GROWTH_DIMENSION_LABEL[d].cn}`,
                        )
                        .join(" · ")
                }
              />
              <ReadRow
                label="Core Traits · 核心特质"
                value={
                  initial.zu_zhang_core_traits.length === 0
                    ? "—"
                    : initial.zu_zhang_core_traits
                        .map((t) => ZU_ZHANG_TRAIT_LABEL[t].cn)
                        .join(" · ")
                }
              />
            </>
          ) : null}

          <div className="pt-4 border-t border-[var(--paper-shadow)] text-[11px] text-[var(--ink-faint)]">
            带组次数 · Times led groups:{" "}
            <span className="text-[var(--ink)] tabular-nums">
              {initial.times_led_groups}
            </span>
          </div>
        </div>
      )}
    </CardShell>
  );
}

function ReadRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] tracking-[0.2em] uppercase text-[var(--ink-faint)]">
        {label}
      </span>
      <span className="text-[13px] text-[var(--ink)]">{value}</span>
    </div>
  );
}
