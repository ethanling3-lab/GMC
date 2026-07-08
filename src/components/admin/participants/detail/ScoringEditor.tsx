"use client";

import { useState } from "react";
import {
  STUDENT_QUALIFICATION_LABEL,
  scoreToQualification,
} from "@/lib/grouping/types";
import type {
  StudentQualification,
  UpgradePotential,
} from "@/lib/grouping/types";
import { validityLabel } from "@/lib/programmes/types";
import { CardShell } from "./CardShell";
import { ScoreBar } from "./ScoreBar";
import { LabelRow, NumberInput, Toggle } from "./FormControls";
import { useParticipantPatch } from "./useParticipantPatch";

// The active programmes (+ the participant's current one even if since
// deactivated) passed from the server parent for the dropdown + display.
export type ProgrammeOption = {
  id: string;
  name_en: string;
  name_cn: string;
  price_sgd: number;
  on_site_sgd: number | null;
  validity_months: number | null;
  active: boolean;
};

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
  // Migration 043 — programme membership (FK + frozen validity window).
  programme_id: string | null;
  programme_started_at: string | null;
  programme_expires_at: string | null;
  upgrade_potential: UpgradePotential | null;
  // Migration 022 — moved here from ZuZhangProfileEditor since it's a
  // scoring-shaped signal (not a leader-role attribute).
  has_special_contribution: boolean;
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-SG", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// Bilingual validity status for the read view, given the frozen expiry +
// the programme's validity term.
function validityStatus(
  expiresAt: string | null,
  validityMonths: number | null,
): { text: string; tone: "ok" | "warn" | "muted" } {
  if (validityMonths == null) return { text: "No expiry · 永久有效", tone: "muted" };
  if (!expiresAt) return { text: "Anchors on first payment · 付款后生效", tone: "warn" };
  const expired = new Date(expiresAt).getTime() <= Date.now();
  return expired
    ? { text: `Expired ${fmtDate(expiresAt)} · 已过期（按新/老学员计价）`, tone: "warn" }
    : { text: `Valid until ${fmtDate(expiresAt)} · 有效至`, tone: "ok" };
}

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
  programmes,
}: {
  participantId: string;
  initial: ScoringData;
  programmes: ProgrammeOption[];
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ScoringData>(initial);
  const { saving, error, setError, patch } = useParticipantPatch(participantId);

  const programmeById = (id: string | null) =>
    id ? programmes.find((p) => p.id === id) ?? null : null;
  const initialProgramme = programmeById(initial.programme_id);
  const draftProgramme = programmeById(draft.programme_id);

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
      // Server derives the frozen validity window + legacy programme_tier
      // enum from these. Empty start date ⇒ auto-anchor to latest paid enrol.
      programme_id: draft.programme_id,
      programme_started_at: draft.programme_started_at,
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
                value={draft.programme_id ?? ""}
                onChange={(e) => {
                  const id = e.target.value || null;
                  setDraft({
                    ...draft,
                    programme_id: id,
                    // Clearing the programme clears the membership window.
                    ...(id ? {} : { programme_started_at: null, programme_expires_at: null }),
                  });
                }}
                className={SELECT_CLASS}
              >
                <option value="">— Not enrolled in a programme</option>
                {programmes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name_cn} · {p.name_en}
                    {p.active ? "" : " (inactive)"}
                  </option>
                ))}
              </select>
              {draft.programme_id ? (
                <div className="mt-2 space-y-1.5">
                  <label className="block text-[11px] tracking-[0.04em] text-[var(--ink-mute)]">
                    Member since · 入会日期{" "}
                    <span className="text-[var(--ink-faint)]">(optional — blank auto-anchors to latest paid enrolment)</span>
                  </label>
                  <input
                    type="date"
                    value={draft.programme_started_at ? draft.programme_started_at.slice(0, 10) : ""}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        programme_started_at: e.target.value
                          ? new Date(e.target.value).toISOString()
                          : null,
                      })
                    }
                    className={SELECT_CLASS}
                  />
                  <p className="text-[11px] text-[var(--ink-faint)] leading-[1.5]">
                    {draftProgramme
                      ? `Validity: ${validityLabel(draftProgramme.validity_months)}. ${
                          draftProgramme.validity_months == null
                            ? "Never expires."
                            : "Expiry is frozen at save (start + validity); a later payment won't extend it."
                        }`
                      : ""}
                  </p>
                </div>
              ) : null}
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
                {initialProgramme
                  ? `${initialProgramme.name_cn} · ${initialProgramme.name_en}`
                  : "Not enrolled · 未报名课程"}
              </span>
              {initialProgramme ? (
                <>
                  <span className="text-[11px] text-[var(--ink-faint)] tabular-nums">
                    {fmtSgd(initialProgramme.price_sgd)}
                    {initialProgramme.on_site_sgd != null
                      ? ` (on-site ${fmtSgd(initialProgramme.on_site_sgd)})`
                      : ""}
                  </span>
                  {(() => {
                    const st = validityStatus(initial.programme_expires_at, initialProgramme.validity_months);
                    const color =
                      st.tone === "ok"
                        ? "text-[#3a6b3b]"
                        : st.tone === "warn"
                          ? "text-[var(--cinnabar-deep)]"
                          : "text-[var(--ink-faint)]";
                    return <span className={`text-[11px] ${color}`}>{st.text}</span>;
                  })()}
                </>
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
