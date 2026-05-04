"use client";

import { useState } from "react";
import {
  STUDENT_QUALIFICATION_LABEL,
  scoreToQualification,
} from "@/lib/grouping/types";
import type { StudentQualification } from "@/lib/grouping/types";
import { CardShell } from "./CardShell";
import { ScoreBar } from "./ScoreBar";
import { LabelRow, NumberInput } from "./FormControls";
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
      eyebrow="Scoring"
      eyebrowZh="评分"
      title="Qualitative scoring"
      editing={editing}
      saving={saving}
      error={error}
      onEdit={() => setEditing(true)}
      onCancel={cancel}
      onSave={save}
    >
      {editing ? (
        <>
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
        </>
      ) : (
        <>
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
        </>
      )}
    </CardShell>
  );
}
