"use client";

import { useState } from "react";
import {
  PROGRAMME_TIER_LABEL,
} from "@/lib/grouping/types";
import type { ProgrammeTier, UpgradePotential } from "@/lib/grouping/types";
import { CardShell } from "./CardShell";
import { LabelRow } from "./FormControls";
import { useParticipantPatch } from "./useParticipantPatch";

// 学员类别 — which paid GMC programme this participant is enrolled in,
// plus admin's read on whether they could upgrade to a higher tier.
//
// Programmes (low → high):
//   丰盛 (Abundance)              — entry tier
//   荣贵 (Glorious Family)        — mid tier
//   精英文化财 (Elite Cultural)   — high tier
//   荣耀文化财 (Glorious Cultural)— top tier
//
// Each programme grants attendance to events for just the 会务 fee.
// Upgrade potential = admin's qualitative read on whether this person
// could move up to a higher programme.

export type StudentCategoryData = {
  programme_tier: ProgrammeTier | null;
  upgrade_potential: UpgradePotential | null;
};

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

const SELECT_CLASS =
  "h-9 w-full px-3 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[13px] text-[var(--ink)] focus:border-[var(--cinnabar)]/50 focus:outline-none focus:shadow-[var(--shadow-focus)]";

function fmtSgd(n: number): string {
  return `S$${n.toLocaleString()}`;
}

export function StudentCategoryEditor({
  participantId,
  initial,
}: {
  participantId: string;
  initial: StudentCategoryData;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<StudentCategoryData>(initial);
  const { saving, error, setError, patch } = useParticipantPatch(participantId);

  function cancel() {
    setDraft(initial);
    setEditing(false);
    setError(null);
  }

  async function save() {
    const ok = await patch({
      programme_tier: draft.programme_tier,
      upgrade_potential: draft.upgrade_potential,
    });
    if (ok) setEditing(false);
  }

  const programmeLabel =
    initial.programme_tier
      ? `${PROGRAMME_TIER_LABEL[initial.programme_tier].cn} · ${PROGRAMME_TIER_LABEL[initial.programme_tier].en}`
      : "Not enrolled · 未报名课程";
  const programmePrice = initial.programme_tier
    ? `${fmtSgd(PROGRAMME_TIER_LABEL[initial.programme_tier].price_sgd)} (on-site ${fmtSgd(PROGRAMME_TIER_LABEL[initial.programme_tier].on_site_sgd)})`
    : null;

  return (
    <CardShell
      eyebrow="Student Category"
      eyebrowZh="学员类别"
      title="Programme enrolment + upgrade potential"
      editing={editing}
      saving={saving}
      error={error}
      onEdit={() => setEditing(true)}
      onCancel={cancel}
      onSave={save}
    >
      {editing ? (
        <div className="grid md:grid-cols-2 gap-6">
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
      ) : (
        <div className="grid md:grid-cols-2 gap-6">
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] tracking-[0.2em] uppercase text-[var(--ink-faint)]">
              Programme · 课程
            </span>
            <span className="text-[14px] text-[var(--ink)] font-display tracking-[-0.005em]">
              {programmeLabel}
            </span>
            {programmePrice ? (
              <span className="text-[11px] text-[var(--ink-faint)] tabular-nums">
                {programmePrice}
              </span>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] tracking-[0.2em] uppercase text-[var(--ink-faint)]">
              Upgrade potential · 升级潜力
            </span>
            <span className="text-[14px] text-[var(--ink)]">
              {initial.upgrade_potential
                ? initial.upgrade_potential.charAt(0).toUpperCase()
                  + initial.upgrade_potential.slice(1)
                : "—"}
            </span>
          </div>
        </div>
      )}
    </CardShell>
  );
}
