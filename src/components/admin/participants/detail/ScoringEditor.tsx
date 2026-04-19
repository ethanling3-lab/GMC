"use client";

import { useState } from "react";
import { CardShell } from "./CardShell";
import { ScoreBar } from "./ScoreBar";
import { LabelRow, NumberInput } from "./FormControls";
import { useParticipantPatch } from "./useParticipantPatch";

export type ScoringData = {
  financial_score: number | null;
  influence_score: number | null;
  overall_score: number | null;
};

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
    const ok = await patch(draft);
    if (ok) setEditing(false);
  }

  function setField(k: keyof ScoringData, v: number | null) {
    setDraft({ ...draft, [k]: v });
  }

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
          <div className="grid md:grid-cols-3 gap-6">
            <LabelRow label="Financial · 财务">
              <NumberInput
                value={draft.financial_score}
                onChange={(v) => setField("financial_score", v)}
                min={1}
                max={10}
                placeholder="1 – 10"
              />
            </LabelRow>
            <LabelRow label="Influence · 影响力">
              <NumberInput
                value={draft.influence_score}
                onChange={(v) => setField("influence_score", v)}
                min={1}
                max={10}
                placeholder="1 – 10"
              />
            </LabelRow>
            <LabelRow label="Overall · 综合">
              <NumberInput
                value={draft.overall_score}
                onChange={(v) => setField("overall_score", v)}
                min={1}
                max={10}
                placeholder="1 – 10"
              />
            </LabelRow>
          </div>
          <p className="mt-5 text-[12px] leading-[1.65] text-[var(--ink-mute)]">
            Overall is usually derived from Financial + Influence — set it
            manually only to override the derivation.
          </p>
        </>
      ) : (
        <>
          <div className="grid md:grid-cols-3 gap-8">
            <ScoreBar
              label="Financial"
              labelZh="财务"
              score={initial.financial_score}
            />
            <ScoreBar
              label="Influence"
              labelZh="影响力"
              score={initial.influence_score}
              accent="slate"
            />
            <ScoreBar
              label="Overall"
              labelZh="综合"
              score={initial.overall_score}
              accent="ink"
            />
          </div>
          <div className="mt-6 pt-5 border-t border-[var(--paper-shadow)] text-[12px] leading-[1.7] text-[var(--ink-mute)]">
            Overall score is derived from financial + influence with optional
            manual override.
          </div>
        </>
      )}
    </CardShell>
  );
}
