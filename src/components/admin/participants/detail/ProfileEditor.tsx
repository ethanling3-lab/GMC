"use client";

import { useState } from "react";
import { CardShell } from "./CardShell";
import { Empty } from "./Field";
import { LabelRow, TextInput, Textarea } from "./FormControls";
import { useParticipantPatch } from "./useParticipantPatch";
import { PROGRAMME_TIER_LABEL } from "@/lib/grouping/types";
import type { ProgrammeTier } from "@/lib/grouping/types";

// M6.8 Profile card — what shows up on the per-participant briefing deck.
// Owns ONLY deck-rendered fields. Identity facts (region / dharma /
// religion / training_level) live on IdentityEditor; programme & scoring
// live on the Programme & Scoring card; algorithm-readable signals live
// on Algorithm Signals.
//
// Sections inside this card mirror the GMC printed 学员名册:
//   个人信息  · health / family / dietary
//   上课信息  · interaction notes (briefing-facing only — no algorithm)
//   客服建议  · course needs + recommendations + evaluation
//   Course history + Internal notes round it off.
//
// Three qualitative briefing notes (personality / face_type /
// parameter_framework) were moved here from EnrichmentEditor — they're
// admin-readable briefing context, not algorithm input.

export type AttendedCourse = {
  course_name: string;
  programme_tier?: ProgrammeTier | null;
  date?: string | null;
};

export type ProfileData = {
  // Personal info (新 fields from migration 032)
  health_status: string | null;
  family_situation: string | null;
  dietary_needs: string | null;
  // Class info
  interaction_notes: string | null;
  // CS recommendations
  course_needs: string | null;
  suggested_group_leader_notes: string | null;
  recommended_courses: string | null;
  forbidden_courses: string | null;
  cs_evaluation: string | null;
  // Qualitative briefing notes (moved in from EnrichmentEditor)
  personality: string | null;
  face_type: string | null;
  parameter_framework: string | null;
  // Course history
  attended_courses: AttendedCourse[];
  // Internal admin notes
  cs_notes: string | null;
};

const PROGRAMME_OPTIONS: Array<{ value: ProgrammeTier | ""; label: string }> = [
  { value: "", label: "—" },
  { value: "abundance", label: "丰盛" },
  { value: "glorious_family", label: "荣贵" },
  { value: "elite_cultural_heritage", label: "精英文化财" },
  { value: "glorious_cultural_heritage", label: "荣耀文化财" },
];

const INPUT_BASE =
  "h-9 px-3 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[14px] text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--cinnabar)]/50 focus:outline-none focus:shadow-[var(--shadow-focus)] transition-[border-color,box-shadow] duration-[var(--dur-fast)]";

export function ProfileEditor({
  participantId,
  initial,
}: {
  participantId: string;
  initial: ProfileData;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ProfileData>(initial);
  const { saving, error, setError, patch } = useParticipantPatch(participantId);

  function cancel() {
    setDraft(initial);
    setEditing(false);
    setError(null);
  }

  async function save() {
    const trim = (s: string | null) => s?.trim() || null;
    const cleaned = draft.attended_courses
      .map((c) => ({
        course_name: c.course_name.trim(),
        programme_tier: c.programme_tier ?? null,
        date: c.date?.trim() || null,
      }))
      .filter((c) => c.course_name !== "");

    const ok = await patch({
      health_status: trim(draft.health_status),
      family_situation: trim(draft.family_situation),
      dietary_needs: trim(draft.dietary_needs),
      interaction_notes: trim(draft.interaction_notes),
      course_needs: trim(draft.course_needs),
      suggested_group_leader_notes: trim(draft.suggested_group_leader_notes),
      recommended_courses: trim(draft.recommended_courses),
      forbidden_courses: trim(draft.forbidden_courses),
      cs_evaluation: trim(draft.cs_evaluation),
      personality: trim(draft.personality),
      face_type: trim(draft.face_type),
      parameter_framework: trim(draft.parameter_framework),
      attended_courses: cleaned,
      cs_notes: trim(draft.cs_notes),
    });
    if (ok) {
      setDraft({ ...draft, attended_courses: cleaned });
      setEditing(false);
    }
  }

  function updateCourse(idx: number, p: Partial<AttendedCourse>) {
    const next = draft.attended_courses.slice();
    next[idx] = { ...next[idx], ...p };
    setDraft({ ...draft, attended_courses: next });
  }

  function removeCourse(idx: number) {
    const next = draft.attended_courses.slice();
    next.splice(idx, 1);
    setDraft({ ...draft, attended_courses: next });
  }

  function addCourse() {
    setDraft({
      ...draft,
      attended_courses: [
        ...draft.attended_courses,
        { course_name: "", programme_tier: null, date: null },
      ],
    });
  }

  return (
    <CardShell
      eyebrow="Briefing"
      eyebrowZh="名册"
      title="What appears on the per-participant briefing deck"
      editing={editing}
      saving={saving}
      error={error}
      onEdit={() => setEditing(true)}
      onCancel={cancel}
      onSave={save}
    >
      {editing ? (
        <div className="flex flex-col gap-7">
          {/* Section: Personal info */}
          <SectionDivider title="Personal info" titleZh="个人信息" />
          <div className="grid md:grid-cols-3 gap-x-6 gap-y-5">
            <LabelRow label="Health status · 健康状况">
              <TextInput
                value={draft.health_status ?? ""}
                onChange={(v) => setDraft({ ...draft, health_status: v })}
                placeholder="健康 / 亚健康 / 调理中"
              />
            </LabelRow>
            <LabelRow label="Family situation · 家庭情况">
              <TextInput
                value={draft.family_situation ?? ""}
                onChange={(v) => setDraft({ ...draft, family_situation: v })}
                placeholder="已婚 · 2 个孩子"
              />
            </LabelRow>
            <LabelRow label="Dietary needs · 饮食需求">
              <TextInput
                value={draft.dietary_needs ?? ""}
                onChange={(v) => setDraft({ ...draft, dietary_needs: v })}
                placeholder="荤食 / 素食 / 半素"
              />
            </LabelRow>
          </div>

          {/* Section: Class info */}
          <SectionDivider title="Class info" titleZh="上课信息" />
          <LabelRow
            label="Interaction notes · 注意事项"
            hint="How the CS team should approach this person."
          >
            <TextInput
              value={draft.interaction_notes ?? ""}
              onChange={(v) => setDraft({ ...draft, interaction_notes: v })}
              placeholder="正常对接 / 须谨慎沟通"
            />
          </LabelRow>

          {/* Section: CS recommendations */}
          <SectionDivider
            title="CS recommendations"
            titleZh="客服 / 介绍人建议"
          />
          <div className="flex flex-col gap-5">
            <LabelRow
              label="Course needs · 上课的需求点"
              hint="Why are they here? What problem do they want to solve?"
            >
              <Textarea
                value={draft.course_needs ?? ""}
                onChange={(v) => setDraft({ ...draft, course_needs: v })}
                placeholder="带领团队实现未来五年的愿景，达成真正的健康与真正的财富。"
                rows={3}
              />
            </LabelRow>
            <div className="grid md:grid-cols-2 gap-x-8 gap-y-5">
              <LabelRow label="Suggested 组长 · 建议在谁的小组">
                <TextInput
                  value={draft.suggested_group_leader_notes ?? ""}
                  onChange={(v) =>
                    setDraft({ ...draft, suggested_group_leader_notes: v })
                  }
                  placeholder="李鳳鏑 / 周佩娴"
                />
              </LabelRow>
              <LabelRow label="Recommend courses · 引导报名什么课程">
                <TextInput
                  value={draft.recommended_courses ?? ""}
                  onChange={(v) =>
                    setDraft({ ...draft, recommended_courses: v })
                  }
                  placeholder="精英文化财 · 荣贵 ..."
                />
              </LabelRow>
              <LabelRow label="Forbid courses · 不能报名什么课程">
                <TextInput
                  value={draft.forbidden_courses ?? ""}
                  onChange={(v) =>
                    setDraft({ ...draft, forbidden_courses: v })
                  }
                  placeholder="—"
                />
              </LabelRow>
            </div>
            <LabelRow
              label="CS evaluation · 备注 / 客服评价"
              hint="Public briefing remark — appears on the profile deck."
            >
              <Textarea
                value={draft.cs_evaluation ?? ""}
                onChange={(v) => setDraft({ ...draft, cs_evaluation: v })}
                placeholder="前商会会长，影响力高 ..."
                rows={3}
              />
            </LabelRow>
          </div>

          {/* Section: Qualitative notes (moved from EnrichmentEditor) */}
          <SectionDivider
            title="Qualitative notes"
            titleZh="性格 · 面相 · 框架"
          />
          <div className="grid md:grid-cols-3 gap-x-6 gap-y-5">
            <LabelRow label="Personality · 性格">
              <TextInput
                value={draft.personality ?? ""}
                onChange={(v) => setDraft({ ...draft, personality: v })}
                placeholder="随和 / 严谨 / ..."
              />
            </LabelRow>
            <LabelRow label="Face type · 面相">
              <TextInput
                value={draft.face_type ?? ""}
                onChange={(v) => setDraft({ ...draft, face_type: v })}
                placeholder="—"
              />
            </LabelRow>
            <LabelRow label="Parameter framework · 框架">
              <TextInput
                value={draft.parameter_framework ?? ""}
                onChange={(v) => setDraft({ ...draft, parameter_framework: v })}
                placeholder="—"
              />
            </LabelRow>
          </div>

          {/* Course history */}
          <SectionDivider title="Course history" titleZh="曾参加课程" />
          <div className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[11px] text-[var(--ink-faint)]">
                {draft.attended_courses.filter((c) => c.course_name.trim()).length}{" "}
                entries
              </span>
            </div>
            {draft.attended_courses.length === 0 ? (
              <p className="text-[13px] text-[var(--ink-faint)] italic">
                No courses recorded yet.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {draft.attended_courses.map((c, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={c.course_name}
                      onChange={(e) =>
                        updateCourse(i, { course_name: e.target.value })
                      }
                      placeholder="丰盛系列 · Abundance Series"
                      className={`${INPUT_BASE} flex-1 min-w-0`}
                    />
                    <select
                      value={c.programme_tier ?? ""}
                      onChange={(e) =>
                        updateCourse(i, {
                          programme_tier: (e.target.value ||
                            null) as ProgrammeTier | null,
                        })
                      }
                      className={`${INPUT_BASE} w-[140px]`}
                    >
                      {PROGRAMME_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={c.date ?? ""}
                      onChange={(e) =>
                        updateCourse(i, { date: e.target.value })
                      }
                      placeholder="2024-03"
                      className={`${INPUT_BASE} font-mono text-[13px] w-[110px]`}
                    />
                    <button
                      type="button"
                      onClick={() => removeCourse(i)}
                      aria-label="Remove course"
                      title="Remove course"
                      className="inline-flex items-center justify-center w-9 h-9 rounded-[var(--radius-md)] text-[var(--ink-faint)] hover:text-[var(--cinnabar-deep)] hover:bg-[var(--paper-deep)]/60 transition-colors"
                    >
                      <span aria-hidden="true">✕</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={addCourse}
              className="self-start inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-pill)] border border-dashed border-[var(--paper-shadow)] text-[11.5px] tracking-[0.06em] text-[var(--ink-soft)] hover:border-[var(--cinnabar)]/40 hover:text-[var(--cinnabar-deep)] transition-colors"
            >
              <span aria-hidden="true">＋</span>
              Add course · 添加课程
            </button>
          </div>

          {/* Internal notes */}
          <SectionDivider title="Internal notes" titleZh="内部备注" />
          <LabelRow
            label="Notes / Remarks · 备注"
            hint='Admin-internal. Visible on the deck under "备注" section.'
          >
            <textarea
              value={draft.cs_notes ?? ""}
              onChange={(e) => setDraft({ ...draft, cs_notes: e.target.value })}
              rows={5}
              placeholder="Anything Dr Wu should know before this person walks in… "
              className="w-full resize-y px-3 py-2.5 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[14px] leading-[1.7] text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--cinnabar)]/50 focus:outline-none focus:shadow-[var(--shadow-focus)] transition-[border-color,box-shadow] duration-[var(--dur-fast)]"
            />
          </LabelRow>
        </div>
      ) : (
        <div className="flex flex-col gap-7">
          {/* Section: Personal info (read) */}
          <SectionDivider title="Personal info" titleZh="个人信息" />
          <dl className="grid md:grid-cols-3 gap-x-6 gap-y-5">
            <ReadField label="Health status" labelZh="健康状况">
              {textOrEmpty(initial.health_status)}
            </ReadField>
            <ReadField label="Family situation" labelZh="家庭情况">
              {textOrEmpty(initial.family_situation)}
            </ReadField>
            <ReadField label="Dietary needs" labelZh="饮食需求">
              {textOrEmpty(initial.dietary_needs)}
            </ReadField>
          </dl>

          {/* Section: Class info (read) */}
          <SectionDivider title="Class info" titleZh="上课信息" />
          <ReadField label="Interaction notes" labelZh="注意事项">
            {textOrEmpty(initial.interaction_notes)}
          </ReadField>

          {/* Section: CS recommendations (read) */}
          <SectionDivider
            title="CS recommendations"
            titleZh="客服 / 介绍人建议"
          />
          <div className="flex flex-col gap-5">
            <ReadField label="Course needs" labelZh="上课的需求点">
              {initial.course_needs ? (
                <p className="text-[15px] leading-[1.75] text-[var(--ink)] whitespace-pre-wrap">
                  {initial.course_needs}
                </p>
              ) : (
                <Empty />
              )}
            </ReadField>
            <dl className="grid md:grid-cols-2 gap-x-8 gap-y-5">
              <ReadField label="Suggested 组长" labelZh="建议在谁的小组">
                {textOrEmpty(initial.suggested_group_leader_notes)}
              </ReadField>
              <ReadField label="Recommend courses" labelZh="引导报名什么课程">
                {textOrEmpty(initial.recommended_courses)}
              </ReadField>
              <ReadField label="Forbid courses" labelZh="不能报名什么课程">
                {textOrEmpty(initial.forbidden_courses)}
              </ReadField>
            </dl>
            <ReadField label="CS evaluation" labelZh="备注 / 客服评价">
              {initial.cs_evaluation ? (
                <p className="text-[15px] leading-[1.75] text-[var(--ink)] whitespace-pre-wrap">
                  {initial.cs_evaluation}
                </p>
              ) : (
                <Empty />
              )}
            </ReadField>
          </div>

          {/* Section: Qualitative notes (read) */}
          <SectionDivider
            title="Qualitative notes"
            titleZh="性格 · 面相 · 框架"
          />
          <dl className="grid md:grid-cols-3 gap-x-6 gap-y-5">
            <ReadField label="Personality" labelZh="性格">
              {textOrEmpty(initial.personality)}
            </ReadField>
            <ReadField label="Face type" labelZh="面相">
              {textOrEmpty(initial.face_type)}
            </ReadField>
            <ReadField label="Parameter framework" labelZh="框架">
              {textOrEmpty(initial.parameter_framework)}
            </ReadField>
          </dl>

          {/* Course history (read) */}
          <SectionDivider title="Course history" titleZh="曾参加课程" />
          {initial.attended_courses.length === 0 ? (
            <p className="text-[14px] text-[var(--ink-faint)] italic">
              No courses recorded.
            </p>
          ) : (
            <ol className="flex flex-col">
              {initial.attended_courses.map((c, i) => (
                <li
                  key={i}
                  className="flex items-baseline gap-3 py-3 border-t border-[var(--paper-shadow)]/60 first:border-t-0"
                >
                  <span className="text-[11px] tabular-nums text-[var(--ink-faint)] w-6">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="flex-1 text-[16px] text-[var(--ink)] font-display tracking-[-0.005em]">
                    {c.course_name}
                  </span>
                  {c.programme_tier ? (
                    <span className="inline-flex items-center h-5 px-2.5 rounded-[var(--radius-pill)] bg-[var(--cinnabar-wash)] text-[11px] tracking-[0.12em] text-[var(--cinnabar-deep)]">
                      {PROGRAMME_TIER_LABEL[c.programme_tier].cn}
                    </span>
                  ) : null}
                  {c.date ? (
                    <span className="text-[12px] font-mono tabular-nums text-[var(--ink-faint)]">
                      {c.date}
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          )}

          {/* Internal notes (read) */}
          <SectionDivider title="Internal notes" titleZh="内部备注" />
          {initial.cs_notes ? (
            <p className="text-[15px] leading-[1.75] text-[var(--ink)] whitespace-pre-wrap">
              {initial.cs_notes}
            </p>
          ) : (
            <p className="text-[14px] text-[var(--ink-faint)] italic">
              No notes yet.
            </p>
          )}
        </div>
      )}
    </CardShell>
  );
}

function textOrEmpty(s: string | null): React.ReactNode {
  return s ? <span className="text-[15px]">{s}</span> : <Empty />;
}

function ReadField({
  label,
  labelZh,
  children,
}: {
  label: string;
  labelZh?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <dt className="text-[10px] tracking-[0.2em] uppercase text-[var(--ink-faint)]">
        {label}
        {labelZh ? (
          <span className="ml-1.5 text-[var(--ink-faint)]/70 normal-case tracking-[0.14em]">
            {labelZh}
          </span>
        ) : null}
      </dt>
      <dd className="text-[var(--ink)]">{children}</dd>
    </div>
  );
}

function SectionDivider({
  title,
  titleZh,
}: {
  title: string;
  titleZh: string;
}) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <span
        aria-hidden="true"
        className="h-px w-6 bg-[var(--cinnabar)]/70"
      />
      <div className="flex items-baseline gap-2">
        <span className="text-[11px] tracking-[0.28em] uppercase text-[var(--cinnabar)] font-medium">
          {title}
        </span>
        <span className="text-[13px] font-display tracking-[-0.005em] text-[var(--ink)]">
          {titleZh}
        </span>
      </div>
      <span
        aria-hidden="true"
        className="flex-1 h-px bg-[var(--paper-shadow)]"
      />
    </div>
  );
}
