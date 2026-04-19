"use client";

import { useState } from "react";
import { CardShell } from "./CardShell";
import { Field, Empty } from "./Field";
import { LabelRow, Select, Textarea, Toggle } from "./FormControls";
import { useParticipantPatch } from "./useParticipantPatch";
import { MOTIVATIONS } from "@/lib/participant-import-schema";
import type { MotivationTag } from "@/lib/participants-query";

export type EnrichmentData = {
  motivation_tag: MotivationTag | null;
  is_old_student: boolean;
  personality: string | null;
  face_type: string | null;
  parameter_framework: string | null;
};

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
    const ok = await patch(draft);
    if (ok) setEditing(false);
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
        <div className="flex flex-col gap-5">
          <div className="grid md:grid-cols-2 gap-x-8 gap-y-5">
            <LabelRow label="Motivation" labelZh="动机">
              <Select
                value={draft.motivation_tag}
                onChange={(v) => setDraft({ ...draft, motivation_tag: v })}
                options={MOTIVATION_OPTIONS}
              />
            </LabelRow>
            <LabelRow label="Old student" labelZh="老学员">
              <Toggle
                value={draft.is_old_student}
                onChange={(v) => setDraft({ ...draft, is_old_student: v })}
              />
            </LabelRow>
          </div>
          <LabelRow label="Personality" labelZh="性格">
            <Textarea
              rows={3}
              value={draft.personality ?? ""}
              onChange={(v) => setDraft({ ...draft, personality: v })}
              placeholder="Observations on temperament, decision style, energy…"
            />
          </LabelRow>
          <LabelRow label="Face type" labelZh="面相">
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
      ) : (
        <dl className="grid md:grid-cols-2 gap-x-8 gap-y-5">
          <Field label="Motivation">
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
          <Field label="Old student">
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
      )}
    </CardShell>
  );
}
