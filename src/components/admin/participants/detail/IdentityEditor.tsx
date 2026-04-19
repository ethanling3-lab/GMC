"use client";

import { useState } from "react";
import { CardShell } from "./CardShell";
import { Field, Empty } from "./Field";
import {
  LabelRow,
  TextInput,
  Select,
} from "./FormControls";
import { useParticipantPatch } from "./useParticipantPatch";
import {
  GENDERS,
  LANGUAGES,
  REGIONS,
} from "@/lib/participant-import-schema";

export type IdentityData = {
  region_id: string | null;
  name_en: string | null;
  name_cn: string | null;
  email: string | null;
  phone: string | null;
  region: string | null;
  language: string | null;
  gender: string | null;
  birth_date: string | null;
  occupation: string | null;
  industry: string | null;
};

const REGION_NAME: Record<string, string> = {
  MY: "Malaysia",
  SG: "Singapore",
  TW: "Taiwan",
  HK: "Hong Kong",
  CN: "Mainland China",
};

const REGION_OPTIONS = REGIONS.map((code) => ({
  value: code,
  label: `${code} · ${REGION_NAME[code]}`,
}));

const GENDER_OPTIONS = GENDERS.map((g) => ({
  value: g,
  label: g.charAt(0).toUpperCase() + g.slice(1),
}));

const LANGUAGE_OPTIONS = LANGUAGES.map((l) => ({ value: l, label: l }));

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
    const ok = await patch(draft);
    if (ok) setEditing(false);
  }

  const age = computeAge(initial.birth_date);
  const regionName = initial.region ? REGION_NAME[initial.region] ?? initial.region : null;

  return (
    <CardShell
      eyebrow="Identity"
      eyebrowZh="身份"
      title="Contact & basic info"
      editing={editing}
      saving={saving}
      error={error}
      onEdit={() => setEditing(true)}
      onCancel={cancel}
      onSave={save}
    >
      {editing ? (
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
          <LabelRow label="Region">
            <Select
              value={draft.region as (typeof REGIONS)[number] | null}
              onChange={(v) => setDraft({ ...draft, region: v })}
              options={REGION_OPTIONS}
            />
          </LabelRow>
          <LabelRow label="Language">
            <Select
              value={draft.language as (typeof LANGUAGES)[number] | null}
              onChange={(v) => setDraft({ ...draft, language: v })}
              options={LANGUAGE_OPTIONS}
            />
          </LabelRow>
          <LabelRow label="Gender">
            <Select
              value={draft.gender as (typeof GENDERS)[number] | null}
              onChange={(v) => setDraft({ ...draft, gender: v })}
              options={GENDER_OPTIONS}
            />
          </LabelRow>
          <LabelRow label="Birth date">
            <TextInput
              type="date"
              mono
              value={draft.birth_date ?? ""}
              onChange={(v) => setDraft({ ...draft, birth_date: v })}
            />
          </LabelRow>
          <LabelRow label="Occupation">
            <TextInput
              value={draft.occupation ?? ""}
              onChange={(v) => setDraft({ ...draft, occupation: v })}
            />
          </LabelRow>
          <LabelRow label="Industry">
            <TextInput
              value={draft.industry ?? ""}
              onChange={(v) => setDraft({ ...draft, industry: v })}
            />
          </LabelRow>
        </div>
      ) : (
        <dl className="grid md:grid-cols-2 gap-x-8 gap-y-5">
          <Field label="Name · EN">{initial.name_en ?? <Empty />}</Field>
          <Field label="Name · 中文">{initial.name_cn ?? <Empty />}</Field>
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
          <Field label="Student ID" labelZh="学员编号" mono>
            {initial.region_id ?? <Empty />}
          </Field>
          <Field label="Region">
            {regionName ? (
              <span>
                <span className="font-medium">{initial.region}</span>
                <span className="ml-2 text-[var(--ink-mute)]">{regionName}</span>
              </span>
            ) : (
              <Empty />
            )}
          </Field>
          <Field label="Language">{initial.language ?? <Empty />}</Field>
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
          <Field label="Occupation">{initial.occupation ?? <Empty />}</Field>
          <Field label="Industry">{initial.industry ?? <Empty />}</Field>
        </dl>
      )}
    </CardShell>
  );
}
