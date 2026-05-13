"use client";

import { useState } from "react";
import { CardShell } from "./CardShell";
import { Field, Empty } from "./Field";
import {
  LabelRow,
  TextInput,
  Select,
  Toggle,
} from "./FormControls";
import { useParticipantPatch } from "./useParticipantPatch";
import {
  GENDERS,
  REGIONS,
} from "@/lib/participant-import-schema";
import { LANGUAGE_FLUENCIES } from "@/lib/participant-update-schema";

// Single source of truth for identity-shaped facts about a participant.
// Combines: name, contact, region+sub-region, gender, birth, occupation,
// industry, language fluency, dharma name, religion, training level, and
// the old/new student boolean. Other cards (Briefing, Scoring, Algorithm
// Signals) should NOT also write these columns — keeps the mental model
// "this card owns identity" intact.

export type IdentityData = {
  region_id: string | null;
  name_en: string | null;
  name_cn: string | null;
  email: string | null;
  phone: string | null;
  region: string | null;
  sub_region: string | null;
  language_fluency: (typeof LANGUAGE_FLUENCIES)[number] | null;
  gender: string | null;
  birth_date: string | null;
  occupation: string | null;
  industry: string | null;
  dharma_name: string | null;
  religion: string | null;
  training_level: string | null;
  is_old_student: boolean;
};

const REGION_NAME: Record<string, { en: string; cn: string }> = {
  MY: { en: "Malaysia", cn: "马来西亚" },
  SG: { en: "Singapore", cn: "新加坡" },
  TW: { en: "Taiwan", cn: "台湾" },
  HK: { en: "Hong Kong", cn: "香港" },
  CN: { en: "Mainland China", cn: "中国大陆" },
};

const REGION_OPTIONS = REGIONS.map((code) => ({
  value: code,
  label: `${code} · ${REGION_NAME[code].cn} · ${REGION_NAME[code].en}`,
}));

const GENDER_OPTIONS = GENDERS.map((g) => ({
  value: g,
  label: g.charAt(0).toUpperCase() + g.slice(1),
}));

const LANGUAGE_FLUENCY_OPTIONS = [
  { value: "cn" as const, label: "中文 · Chinese" },
  { value: "en" as const, label: "English" },
  { value: "both" as const, label: "中英文 · Both" },
];

function computeAge(birth: string | null): number | null {
  if (!birth) return null;
  const d = new Date(birth);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function IdentityEditor({
  participantId,
  initial,
}: {
  participantId: string;
  initial: IdentityData;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<IdentityData>(initial);
  const { saving, error, setError, patch } = useParticipantPatch(participantId);

  function cancel() {
    setDraft(initial);
    setEditing(false);
    setError(null);
  }

  async function save() {
    const trim = (s: string | null) => s?.trim() || null;
    const ok = await patch({
      region_id: trim(draft.region_id),
      name_en: trim(draft.name_en),
      name_cn: trim(draft.name_cn),
      email: trim(draft.email),
      phone: trim(draft.phone),
      region: draft.region,
      sub_region: trim(draft.sub_region),
      language_fluency: draft.language_fluency,
      gender: draft.gender,
      birth_date: draft.birth_date,
      occupation: trim(draft.occupation),
      industry: trim(draft.industry),
      dharma_name: trim(draft.dharma_name),
      religion: trim(draft.religion),
      training_level: trim(draft.training_level),
      is_old_student: draft.is_old_student,
    });
    if (ok) setEditing(false);
  }

  const age = computeAge(initial.birth_date);
  const regionLabel = initial.region
    ? REGION_NAME[initial.region]
      ? `${REGION_NAME[initial.region].cn} · ${REGION_NAME[initial.region].en}`
      : initial.region
    : null;

  return (
    <CardShell
      eyebrow="Identity"
      eyebrowZh="身份"
      title="Contact, demographics, language, dharma, training stage"
      editing={editing}
      saving={saving}
      error={error}
      onEdit={() => setEditing(true)}
      onCancel={cancel}
      onSave={save}
    >
      {editing ? (
        <div className="flex flex-col gap-7">
          {/* Row A — student id + names */}
          <div className="grid md:grid-cols-2 gap-x-8 gap-y-5">
            <LabelRow label="Student ID · 学员编号">
              <TextInput
                mono
                value={draft.region_id ?? ""}
                onChange={(v) => setDraft({ ...draft, region_id: v })}
                placeholder="MY001 · auto-assigned if empty"
              />
            </LabelRow>
            <LabelRow label="Name · EN">
              <TextInput
                value={draft.name_en ?? ""}
                onChange={(v) => setDraft({ ...draft, name_en: v })}
                placeholder="Jane Doe"
              />
            </LabelRow>
            <LabelRow label="Name · 中文">
              <TextInput
                value={draft.name_cn ?? ""}
                onChange={(v) => setDraft({ ...draft, name_cn: v })}
                placeholder="陈美丽"
              />
            </LabelRow>
            <LabelRow label="Dharma name · 法名">
              <TextInput
                value={draft.dharma_name ?? ""}
                onChange={(v) => setDraft({ ...draft, dharma_name: v })}
                placeholder="觉明"
              />
            </LabelRow>
          </div>

          {/* Row B — contact */}
          <div className="grid md:grid-cols-2 gap-x-8 gap-y-5">
            <LabelRow label="Email">
              <TextInput
                type="email"
                value={draft.email ?? ""}
                onChange={(v) => setDraft({ ...draft, email: v })}
                placeholder="name@example.com"
              />
            </LabelRow>
            <LabelRow label="Phone">
              <TextInput
                type="tel"
                mono
                value={draft.phone ?? ""}
                onChange={(v) => setDraft({ ...draft, phone: v })}
                placeholder="+60 12-345 6789"
              />
            </LabelRow>
          </div>

          {/* Row C — region + sub-region + language */}
          <div className="grid md:grid-cols-3 gap-x-6 gap-y-5">
            <LabelRow label="Region · 地区">
              <Select
                value={draft.region as (typeof REGIONS)[number] | null}
                onChange={(v) => setDraft({ ...draft, region: v })}
                options={REGION_OPTIONS}
              />
            </LabelRow>
            <LabelRow label="Sub-region · 子地区">
              <TextInput
                value={draft.sub_region ?? ""}
                onChange={(v) => setDraft({ ...draft, sub_region: v })}
                placeholder="北马 / 中马 / 南马"
              />
            </LabelRow>
            <LabelRow label="Language · 上课语种">
              <Select
                value={draft.language_fluency}
                onChange={(v) =>
                  setDraft({ ...draft, language_fluency: v })
                }
                options={LANGUAGE_FLUENCY_OPTIONS}
              />
            </LabelRow>
          </div>

          {/* Row D — gender + birth + religion */}
          <div className="grid md:grid-cols-3 gap-x-6 gap-y-5">
            <LabelRow label="Gender · 性别">
              <Select
                value={draft.gender as (typeof GENDERS)[number] | null}
                onChange={(v) => setDraft({ ...draft, gender: v })}
                options={GENDER_OPTIONS}
              />
            </LabelRow>
            <LabelRow label="Birth date · 出生日期">
              <TextInput
                type="date"
                mono
                value={draft.birth_date ?? ""}
                onChange={(v) => setDraft({ ...draft, birth_date: v })}
              />
            </LabelRow>
            <LabelRow label="Religion · 宗教">
              <TextInput
                value={draft.religion ?? ""}
                onChange={(v) => setDraft({ ...draft, religion: v })}
                placeholder="佛教 / 基督教 / 无宗教 ..."
              />
            </LabelRow>
          </div>

          {/* Row E — occupation + industry */}
          <div className="grid md:grid-cols-2 gap-x-8 gap-y-5">
            <LabelRow label="Occupation · 职业职位">
              <TextInput
                value={draft.occupation ?? ""}
                onChange={(v) => setDraft({ ...draft, occupation: v })}
              />
            </LabelRow>
            <LabelRow label="Industry · 公司行业">
              <TextInput
                value={draft.industry ?? ""}
                onChange={(v) => setDraft({ ...draft, industry: v })}
              />
            </LabelRow>
          </div>

          {/* Row F — training stage */}
          <div className="grid md:grid-cols-2 gap-x-8 gap-y-5">
            <LabelRow
              label="Training level · 上课等级"
              hint="初训 / 复训 / 进阶 — free text per Dr Wu's terminology"
            >
              <TextInput
                value={draft.training_level ?? ""}
                onChange={(v) => setDraft({ ...draft, training_level: v })}
                placeholder="初训"
              />
            </LabelRow>
            <LabelRow label="Old student · 旧学员">
              <Toggle
                value={draft.is_old_student}
                onChange={(v) => setDraft({ ...draft, is_old_student: v })}
                labels={{ on: "旧学员 · Returning", off: "新人 · New" }}
              />
            </LabelRow>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-7">
          <dl className="grid md:grid-cols-2 gap-x-8 gap-y-5">
            <Field label="Name · EN">{initial.name_en ?? <Empty />}</Field>
            <Field label="Name · 中文">{initial.name_cn ?? <Empty />}</Field>
            <Field label="Student ID" labelZh="学员编号" mono>
              {initial.region_id ?? <Empty />}
            </Field>
            <Field label="Dharma name" labelZh="法名">
              {initial.dharma_name ? (
                <span className="font-display tracking-[-0.005em] text-[15px] text-[var(--cinnabar-deep)]">
                  {initial.dharma_name}
                </span>
              ) : (
                <Empty />
              )}
            </Field>
            <Field label="Email">
              {initial.email ? (
                <a
                  href={`mailto:${initial.email}`}
                  className="text-[var(--ink)] hover:text-[var(--cinnabar)] underline-offset-2 hover:underline decoration-[var(--cinnabar)]/40 transition-colors duration-[var(--dur-fast)]"
                >
                  {initial.email}
                </a>
              ) : (
                <Empty />
              )}
            </Field>
            <Field label="Phone">
              {initial.phone ? (
                <a
                  href={`tel:${initial.phone.replace(/\s+/g, "")}`}
                  className="text-[var(--ink)] hover:text-[var(--cinnabar)] underline-offset-2 hover:underline decoration-[var(--cinnabar)]/40 transition-colors duration-[var(--dur-fast)] font-mono text-[12.5px]"
                >
                  {initial.phone}
                </a>
              ) : (
                <Empty />
              )}
            </Field>
            <Field label="Region">
              {regionLabel ? (
                <span>
                  <span className="font-medium">{initial.region}</span>
                  <span className="ml-2 text-[var(--ink-mute)]">{regionLabel}</span>
                  {initial.sub_region ? (
                    <span className="ml-3 inline-flex items-center h-5 px-2 rounded-[var(--radius-pill)] bg-[var(--cinnabar-wash)] text-[11.5px] text-[var(--cinnabar-deep)]">
                      {initial.sub_region}
                    </span>
                  ) : null}
                </span>
              ) : (
                <Empty />
              )}
            </Field>
            <Field label="Language" labelZh="上课语种">
              {initial.language_fluency
                ? labelFluency(initial.language_fluency)
                : <Empty />}
            </Field>
            <Field label="Gender">
              {initial.gender
                ? initial.gender[0].toUpperCase() + initial.gender.slice(1)
                : <Empty />}
            </Field>
            <Field label="Birth date">
              {initial.birth_date ? (
                <span>
                  {formatDate(initial.birth_date)}
                  {age !== null ? (
                    <span className="ml-2 text-[var(--ink-mute)] text-[12px]">· {age}y</span>
                  ) : null}
                </span>
              ) : (
                <Empty />
              )}
            </Field>
            <Field label="Religion">{initial.religion ?? <Empty />}</Field>
            <Field label="Occupation">{initial.occupation ?? <Empty />}</Field>
            <Field label="Industry">{initial.industry ?? <Empty />}</Field>
            <Field label="Training level" labelZh="上课等级">
              {initial.training_level ? (
                <span className="inline-flex items-center h-5 px-2 rounded-[var(--radius-pill)] bg-[var(--cinnabar-wash)] text-[12px] text-[var(--cinnabar-deep)]">
                  {initial.training_level}
                </span>
              ) : (
                <Empty />
              )}
            </Field>
            <Field label="Student status">
              {initial.is_old_student ? (
                <span className="text-[var(--cinnabar-deep)] font-medium">旧学员 · Returning</span>
              ) : (
                <span className="text-[var(--ink)]">新人 · New</span>
              )}
            </Field>
          </dl>
        </div>
      )}
    </CardShell>
  );
}

function labelFluency(v: "en" | "cn" | "both"): string {
  switch (v) {
    case "cn":
      return "中文 · Chinese";
    case "en":
      return "English";
    case "both":
      return "中英文 · Both";
  }
}
