"use client";

import { useState } from "react";
import {
  PROGRAMME_TIER_LABEL,
  STUDENT_QUALIFICATION_LABEL,
  scoreToQualification,
} from "@/lib/grouping/types";
import type {
  ProgrammeTier,
  StudentQualification,
  UpgradePotential,
} from "@/lib/grouping/types";
import { CardShell } from "./CardShell";
import { ScoreBar } from "./ScoreBar";
import { LabelRow, NumberInput, Toggle } from "./FormControls";
import { useParticipantPatch } from "./useParticipantPatch";

export type ScoringData = {
  financial_score: number | null;
  influence_score: number | null;
  // Legacy 1-10 column. Read-only in M6.0 — the algorithm + qualification
  // logic both run off max(financial, influence) on the new 1-5 scale.
  overall_score: number | null;
  // Admin override on the derived qualification label. NULL = use the
  // computed value from max(financial, influence). Set this when soft
  // factors warrant a downgrade (credit / legal / leverage issues) —
  // the underlying scores stay truthful.
  student_qualification: StudentQualification | null;
  // Migration 023 / 032 — programme enrolment + upgrade potential.
  programme_tier: ProgrammeTier | null;
  upgrade_potential: UpgradePotential | null;
  // Migration 022 — moved here from ZuZhangProfileEditor since it's a
  // scoring-shaped signal (not a leader-role attribute).
  has_special_contribution: boolean;
};

const QUALIFICATION_OPTIONS: Array<{
  value: StudentQualification | "";
  label: string;
}> = [
  { value: "", label: "— Auto from scores" },
  { value: "basic", label: "基础级 · Basic (1)" },
  { value: "rising", label: "成长级 · Rising (2)" },
  { value: "elite", label: "精英级 · Elite (3)" },
  { value: "excellence", label: "卓越级 · Excellence (4)" },
  { value: "strategic", label: "战略级 · Strategic (5)" },
];

const PROGRAMME_OPTIONS: Array<{ value: ProgrammeTier | ""; label: string }> = [
  { value: "", label: "— Not enrolled in a programme" },
  { value: "abundance", label: "丰盛 · Abundance" },
  { value: "glorious_family", label: "荣贵 · Glorious Family" },
  { value: "elite_cultural_heritage", label: "精英文化财 · Elite Cultural Heritage" },
  { value: "glorious_cultural_heritage", label: "荣耀文化财 · Glorious Cultural Heritage" },
];

const UPGRADE_OPTIONS: Array<{ value: UpgradePotential | ""; label: string }> = [
  { value: "", label: "—" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

function fmtSgd(n: number): string {
  return `S$${n.toLocaleString()}`;
}

const SELECT_CLASS =
  "h-9 w-full px-3 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[13px] text-[var(--ink)] focus:border-[var(--cinnabar)]/50 focus:outline-none focus:shadow-[var(--shadow-focus)]";

export function ScoringEditor({
  participantId,
  initial,
}: {
  participantId: string;
  initial: ScoringData;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ScoringData>(initial);
  const { saving, error, setError, patch } = useParticipantPatch(participantId);

  function cancel() {
    setDraft(initial);
    setEditing(false);
    setError(null);
  }

  async function save() {
    const ok = await patch({
      financial_score: draft.financial_score,
      influence_score: draft.influence_score,
      student_qualification: draft.student_qualification,
      programme_tier: draft.programme_tier,
      upgrade_potential: draft.upgrade_potential,
      has_special_contribution: draft.has_special_contribution,
    });
    if (ok) setEditing(false);
  }

  function setField(k: "financial_score" | "influence_score", v: number | null) {
    setDraft({ ...draft, [k]: v });
  }

  const computedQualification = scoreToQualification(
    Math.max(draft.financial_score ?? 0, draft.influence_score ?? 0) || null,
  );
  const initialComputed = scoreToQualification(
    Math.max(initial.financial_score ?? 0, initial.influence_score ?? 0) || null,
  );
  const initialEffective = initial.student_qualification ?? initialComputed;
  const draftEffective = draft.student_qualification ?? computedQualification;

  return (
    <CardShell
      eyebrow="Programme & Scoring"
      eyebrowZh="课程与评分"
      title="Programme tier · financial / influence · qualification"
      editing={editing}
      saving={saving}
      error={error}
      onEdit={() => setEditing(true)}
      onCancel={cancel}
      onSave={save}
    >
      {editing ? (
        <>
          {/* Programme tier + upgrade potential */}
          <div className="grid md:grid-cols-2 gap-6 mb-6 pb-6 border-b border-[var(--paper-shadow)]">
            <LabelRow label="Programme · 课程">
              <select
                value={draft.programme_tier ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    programme_tier:
                      (e.target.value || null) as ProgrammeTier | null,
                  })
                }
                className={SELECT_CLASS}
              >
                {PROGRAMME_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </LabelRow>
            <LabelRow label="Upgrade potential · 升级潜力">
              <select
                value={draft.upgrade_potential ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    upgrade_potential:
                      (e.target.value || null) as UpgradePotential | null,
                  })
                }
                className={SELECT_CLASS}
              >
                {UPGRADE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </LabelRow>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <LabelRow label="Financial · 财力">
              <NumberInput
                value={draft.financial_score}
                onChange={(v) => setField("financial_score", v)}
                min={1}
                max={5}
                placeholder="1 – 5"
              />
            </LabelRow>
            <LabelRow label="Influence · 影响力">
              <NumberInput
                value={draft.influence_score}
                onChange={(v) => setField("influence_score", v)}
                min={1}
                max={5}
                placeholder="1 – 5"
              />
            </LabelRow>
          </div>
          <p className="mt-5 text-[12px] leading-[1.65] text-[var(--ink-mute)]">
            Computed qualification ={" "}
            <span className="font-display tracking-[-0.005em] text-[var(--ink)]">
              {computedQualification
                ? `${STUDENT_QUALIFICATION_LABEL[computedQualification].cn} · ${STUDENT_QUALIFICATION_LABEL[computedQualification].en}`
                : "—"}
            </span>{" "}
            (max of Financial + Influence). 1=基础级, 2=成长级, 3=精英级,
            4=卓越级, 5=战略级.
          </p>
          <div className="mt-5 pt-5 border-t border-[var(--paper-shadow)]">
            <LabelRow label="Qualification override · 等级覆写">
              <select
                value={draft.student_qualification ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    student_qualification:
                      (e.target.value || null) as StudentQualification | null,
                  })
                }
                className={SELECT_CLASS}
              >
                {QUALIFICATION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.value === ""
                      ? `${opt.label}${computedQualification ? ` (${STUDENT_QUALIFICATION_LABEL[computedQualification].cn})` : ""}`
                      : opt.label}
                  </option>
                ))}
              </select>
            </LabelRow>
            <p className="mt-2 text-[11.5px] leading-[1.55] text-[var(--ink-faint)]">
              Use only when soft factors warrant deviating from the
              computed value — e.g., excessive leverage, legal disputes,
              or credit issues. Underlying scores stay truthful; this
              override is what the grouping algorithm consumes.
            </p>
            {draft.student_qualification
              && computedQualification
              && draft.student_qualification !== computedQualification ? (
              <p className="mt-2 text-[11.5px] text-[var(--cinnabar-deep)]">
                Effective qualification: {STUDENT_QUALIFICATION_LABEL[draftEffective!].cn} (override) — was{" "}
                {STUDENT_QUALIFICATION_LABEL[computedQualification].cn} from scores
              </p>
            ) : null}
          </div>

          <div className="mt-5 pt-5 border-t border-[var(--paper-shadow)]">
            <LabelRow
              label="Special contribution · 特殊贡献"
              hint="Mark when this person has given meaningful value beyond fees — speaking, intros, donations. Algorithm respects this as a soft priority signal."
            >
              <Toggle
                value={draft.has_special_contribution}
                onChange={(v) =>
                  setDraft({ ...draft, has_special_contribution: v })
                }
                labels={{ on: "Yes · 是", off: "No · 否" }}
              />
            </LabelRow>
          </div>
        </>
      ) : (
        <>
          {/* Programme tier + upgrade potential (read) */}
          <div className="grid md:grid-cols-2 gap-6 mb-6 pb-6 border-b border-[var(--paper-shadow)]">
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] tracking-[0.2em] uppercase text-[var(--ink-faint)]">
                Programme
                <span className="ml-1.5 text-[var(--ink-faint)]/70 normal-case tracking-[0.14em]">课程</span>
              </span>
              <span className="text-[14px] text-[var(--ink)] font-display tracking-[-0.005em]">
                {initial.programme_tier
                  ? `${PROGRAMME_TIER_LABEL[initial.programme_tier].cn} · ${PROGRAMME_TIER_LABEL[initial.programme_tier].en}`
                  : "Not enrolled · 未报名课程"}
              </span>
              {initial.programme_tier ? (
                <span className="text-[11px] text-[var(--ink-faint)] tabular-nums">
                  {fmtSgd(PROGRAMME_TIER_LABEL[initial.programme_tier].price_sgd)} (on-site {fmtSgd(PROGRAMME_TIER_LABEL[initial.programme_tier].on_site_sgd)})
                </span>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] tracking-[0.2em] uppercase text-[var(--ink-faint)]">
                Upgrade potential
                <span className="ml-1.5 text-[var(--ink-faint)]/70 normal-case tracking-[0.14em]">升级潜力</span>
              </span>
              <span className="text-[14px] text-[var(--ink)]">
                {initial.upgrade_potential
                  ? initial.upgrade_potential.charAt(0).toUpperCase()
                    + initial.upgrade_potential.slice(1)
                  : "—"}
              </span>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            <ScoreBar
              label="Financial"
              labelZh="财力"
              score={initial.financial_score}
              max={5}
            />
            <ScoreBar
              label="Influence"
              labelZh="影响力"
              score={initial.influence_score}
              accent="slate"
              max={5}
            />
          </div>
          <div className="mt-6 pt-5 border-t border-[var(--paper-shadow)] text-[12px] leading-[1.7] text-[var(--ink-mute)]">
            Qualification:{" "}
            <span className="text-[var(--ink)]">
              {initialEffective
                ? `${STUDENT_QUALIFICATION_LABEL[initialEffective].cn} (${STUDENT_QUALIFICATION_LABEL[initialEffective].en})`
                : "Unscored"}
            </span>
            {initial.student_qualification && initialComputed
              && initial.student_qualification !== initialComputed ? (
              <span className="ml-2 px-2 py-0.5 rounded-full border border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)] text-[10px] tracking-[0.18em] uppercase text-[var(--cinnabar-deep)]">
                Override · was {STUDENT_QUALIFICATION_LABEL[initialComputed].cn}
              </span>
            ) : null}
          </div>
          {initial.has_special_contribution ? (
            <div className="mt-4 inline-flex items-center gap-2 text-[12px] tracking-[0.04em]">
              <span className="inline-flex items-center h-5 px-2 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] text-[10.5px] text-[var(--paper-warm)] font-medium tracking-[0.12em] uppercase">
                Special contribution
              </span>
              <span className="text-[var(--ink-mute)]">特殊贡献</span>
            </div>
          ) : null}
        </>
      )}
    </CardShell>
  );
}
