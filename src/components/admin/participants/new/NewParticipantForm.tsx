"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  LabelRow,
  NumberInput,
  Select,
  Textarea,
  TextInput,
  Toggle,
} from "@/components/admin/participants/detail/FormControls";
import type { AdminOption } from "@/components/admin/participants/detail/AssignmentEditor";
import {
  GENDERS,
  LANGUAGES,
  MOTIVATIONS,
  REGIONS,
} from "@/lib/participant-import-schema";
import type { MotivationTag } from "@/lib/participants-query";

type FormState = {
  region_id: string;
  name_en: string;
  name_cn: string;
  email: string;
  phone: string;
  region: (typeof REGIONS)[number] | "";
  language: (typeof LANGUAGES)[number] | "";
  gender: (typeof GENDERS)[number] | "";
  birth_date: string;
  occupation: string;
  industry: string;
  financial_score: number | null;
  influence_score: number | null;
  motivation_tag: MotivationTag | "";
  is_old_student: boolean;
  personality: string;
  face_type: string;
  parameter_framework: string;
  cs_notes: string;
  assigned_region_lead_id: string;
  assigned_cs_id: string;
};

const EMPTY: FormState = {
  region_id: "",
  name_en: "",
  name_cn: "",
  email: "",
  phone: "",
  region: "",
  language: "",
  gender: "",
  birth_date: "",
  occupation: "",
  industry: "",
  financial_score: null,
  influence_score: null,
  motivation_tag: "",
  is_old_student: false,
  personality: "",
  face_type: "",
  parameter_framework: "",
  cs_notes: "",
  assigned_region_lead_id: "",
  assigned_cs_id: "",
};

const REGION_NAME: Record<string, string> = {
  MY: "Malaysia",
  SG: "Singapore",
  TW: "Taiwan",
  HK: "Hong Kong",
  CN: "Mainland China",
};
const REGION_OPTIONS = REGIONS.map((c) => ({
  value: c,
  label: `${c} · ${REGION_NAME[c]}`,
}));
const GENDER_OPTIONS = GENDERS.map((g) => ({
  value: g,
  label: g[0].toUpperCase() + g.slice(1),
}));
const LANGUAGE_OPTIONS = LANGUAGES.map((l) => ({ value: l, label: l }));

const MOTIVATION_LABEL: Record<MotivationTag, string> = {
  clean: "Clean · 纯粹",
  insurance: "Insurance · 保险",
  direct_sales: "Direct sales · 直销",
  spiritual: "Spiritual · 灵性",
  other: "Other · 其他",
};
const MOTIVATION_OPTIONS = MOTIVATIONS.map((m) => ({
  value: m,
  label: MOTIVATION_LABEL[m],
}));

const MAX_PHOTO_MB = 5;
const ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif";

function adminName(a: AdminOption): string {
  const en = a.name_en?.trim();
  const cn = a.name_cn?.trim();
  if (en && cn) return `${en} · ${cn}`;
  return en || cn || "(unnamed)";
}

export function NewParticipantForm({
  regionLeads,
  customerService,
}: {
  regionLeads: AdminOption[];
  customerService: AdminOption[];
}) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  function setField<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  function onPhoto(file: File | null) {
    setError(null);
    if (!file) {
      setPhoto(null);
      setPhotoPreview(null);
      return;
    }
    if (file.size > MAX_PHOTO_MB * 1024 * 1024) {
      setError(`Photo is larger than ${MAX_PHOTO_MB}MB.`);
      return;
    }
    setPhoto(file);
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(URL.createObjectURL(file));
  }

  function clearPhoto() {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhoto(null);
    setPhotoPreview(null);
    if (photoInputRef.current) photoInputRef.current.value = "";
  }

  const hasName = form.name_en.trim() || form.name_cn.trim();
  const canSubmit = Boolean(hasName) && !submitting;

  async function submit() {
    setError(null);
    if (!hasName) {
      setError("Enter at least one of: English name or Chinese name.");
      return;
    }
    setSubmitting(true);

    try {
      // Convert form → API payload. "" → undefined (omit), null/0 scores pass through.
      const payload: Record<string, unknown> = {};
      const emptyToNull = (s: string) => (s.trim() === "" ? null : s.trim());

      payload.region_id = emptyToNull(form.region_id);
      payload.name_en = emptyToNull(form.name_en);
      payload.name_cn = emptyToNull(form.name_cn);
      payload.email = emptyToNull(form.email);
      payload.phone = emptyToNull(form.phone);
      payload.region = form.region || null;
      payload.language_fluency =
        form.language === "zh" ? "cn" : form.language || null;
      payload.gender = form.gender || null;
      payload.birth_date = emptyToNull(form.birth_date);
      payload.occupation = emptyToNull(form.occupation);
      payload.industry = emptyToNull(form.industry);
      payload.financial_score = form.financial_score;
      payload.influence_score = form.influence_score;
      payload.motivation_tag = form.motivation_tag || null;
      payload.is_old_student = form.is_old_student;
      payload.personality = emptyToNull(form.personality);
      payload.face_type = emptyToNull(form.face_type);
      payload.parameter_framework = emptyToNull(form.parameter_framework);
      payload.cs_notes = emptyToNull(form.cs_notes);
      payload.assigned_region_lead_id = form.assigned_region_lead_id || null;
      payload.assigned_cs_id = form.assigned_cs_id || null;

      const body = new FormData();
      body.append("fields", JSON.stringify(payload));
      if (photo) body.append("photo", photo);

      const res = await fetch("/api/admin/participants", {
        method: "POST",
        body,
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? `Create failed (${res.status})`);
      }

      const data = (await res.json()) as {
        ok: true;
        id: string;
        region_id: string | null;
        front_photo_url: string | null;
        photo_warning?: string;
      };

      if (photoPreview) URL.revokeObjectURL(photoPreview);

      // If the photo upload silently failed, stay put long enough to show the warning,
      // then still redirect. For now, redirect immediately but append a banner query.
      router.push(
        data.photo_warning
          ? `/admin/participants/${data.id}?photo_warning=1`
          : `/admin/participants/${data.id}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Create failed";
      setError(msg);
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Identity */}
      <Section eyebrow="Identity" eyebrowZh="身份" title="Contact & basic info">
        <div className="grid md:grid-cols-2 gap-x-8 gap-y-5">
          <LabelRow label="Student ID · 学员编号">
            <TextInput
              mono
              value={form.region_id}
              onChange={(v) => setField("region_id", v)}
              placeholder="Leave blank to auto-assign (e.g. MY001)"
            />
          </LabelRow>
          <LabelRow label="Name · EN">
            <TextInput
              value={form.name_en}
              onChange={(v) => setField("name_en", v)}
              placeholder="Jane Doe"
            />
          </LabelRow>
          <LabelRow label="Name · 中文">
            <TextInput
              value={form.name_cn}
              onChange={(v) => setField("name_cn", v)}
              placeholder="陈美丽"
            />
          </LabelRow>
          <LabelRow label="Email">
            <TextInput
              type="email"
              value={form.email}
              onChange={(v) => setField("email", v)}
              placeholder="name@example.com"
            />
          </LabelRow>
          <LabelRow label="Phone">
            <TextInput
              type="tel"
              mono
              value={form.phone}
              onChange={(v) => setField("phone", v)}
              placeholder="+60 12-345 6789"
            />
          </LabelRow>
          <LabelRow label="Region">
            <Select
              value={form.region || null}
              onChange={(v) => setField("region", (v ?? "") as FormState["region"])}
              options={REGION_OPTIONS}
            />
          </LabelRow>
          <LabelRow label="Language">
            <Select
              value={form.language || null}
              onChange={(v) =>
                setField("language", (v ?? "") as FormState["language"])
              }
              options={LANGUAGE_OPTIONS}
            />
          </LabelRow>
          <LabelRow label="Gender">
            <Select
              value={form.gender || null}
              onChange={(v) =>
                setField("gender", (v ?? "") as FormState["gender"])
              }
              options={GENDER_OPTIONS}
            />
          </LabelRow>
          <LabelRow label="Birth date">
            <TextInput
              type="date"
              mono
              value={form.birth_date}
              onChange={(v) => setField("birth_date", v)}
            />
          </LabelRow>
          <LabelRow label="Occupation">
            <TextInput
              value={form.occupation}
              onChange={(v) => setField("occupation", v)}
            />
          </LabelRow>
          <LabelRow label="Industry">
            <TextInput
              value={form.industry}
              onChange={(v) => setField("industry", v)}
            />
          </LabelRow>
        </div>
      </Section>

      {/* Photo */}
      <Section eyebrow="Photo" eyebrowZh="照片" title="Front-facing photo">
        <div className="flex items-start gap-5 flex-wrap">
          <div className="relative w-28 h-36 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-deep)] overflow-hidden flex-none">
            {photoPreview ? (
              <Image
                src={photoPreview}
                alt="Preview"
                fill
                sizes="112px"
                className="object-cover"
                unoptimized
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-[var(--ink-faint)]">
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="14" cy="11" r="4" />
                  <path d="M5 23a9 9 0 0 1 18 0" />
                </svg>
              </div>
            )}
          </div>

          <div className="flex-1 min-w-[220px]">
            <p className="text-[12.5px] leading-[1.65] text-[var(--ink-soft)]">
              JPEG, PNG, WebP or HEIC · max {MAX_PHOTO_MB}MB. Optional — you
              can add one now or later from the participant&apos;s detail page.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-[var(--radius-pill)]
                           border border-[var(--paper-shadow)] bg-[var(--paper)]
                           text-[12px] text-[var(--ink-soft)]
                           hover:border-[var(--cinnabar)]/40 hover:bg-[var(--cinnabar-wash)] hover:text-[var(--cinnabar-deep)]
                           focus-visible:shadow-[var(--shadow-focus)]
                           transition-[background-color,border-color,color] duration-[var(--dur-fast)]"
              >
                <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M1.5 7.5v1a.5.5 0 0 0 .5.5h6a.5.5 0 0 0 .5-.5v-1" />
                  <path d="M5 1v5.5M3 3l2-2 2 2" />
                </svg>
                {photo ? "Replace" : "Choose photo"}
              </button>
              {photo ? (
                <button
                  type="button"
                  onClick={clearPhoto}
                  className="h-9 px-3 text-[12px] text-[var(--ink-mute)] hover:text-[var(--cinnabar)] transition-colors"
                >
                  Remove
                </button>
              ) : null}
            </div>
            {photo ? (
              <div className="mt-2 text-[11px] font-mono text-[var(--ink-faint)] truncate">
                {photo.name} · {(photo.size / 1024).toFixed(1)} KB
              </div>
            ) : null}
            <input
              ref={photoInputRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => onPhoto(e.target.files?.[0] ?? null)}
            />
          </div>
        </div>
      </Section>

      {/* Scoring */}
      <Section eyebrow="Scoring" eyebrowZh="评分" title="Qualitative scoring">
        <div className="grid md:grid-cols-2 gap-6">
          <LabelRow label="Financial · 财力">
            <NumberInput
              value={form.financial_score}
              onChange={(v) => setField("financial_score", v)}
              min={1}
              max={5}
              placeholder="1 – 5"
            />
          </LabelRow>
          <LabelRow label="Influence · 影响力">
            <NumberInput
              value={form.influence_score}
              onChange={(v) => setField("influence_score", v)}
              min={1}
              max={5}
              placeholder="1 – 5"
            />
          </LabelRow>
        </div>
        <p className="mt-4 text-[12px] leading-[1.65] text-[var(--ink-mute)]">
          1=基础级 · 2=成长级 · 3=精英级 · 4=卓越级 · 5=战略级.
          Qualification = max(financial, influence). Override on the
          participant detail page if a credit / legal / leverage downgrade
          applies.
        </p>
      </Section>

      {/* Enrichment */}
      <Section
        eyebrow="CS Enrichment"
        eyebrowZh="资料"
        title="Qualitative profile"
      >
        <div className="flex flex-col gap-5">
          <div className="grid md:grid-cols-2 gap-x-8 gap-y-5">
            <LabelRow label="Motivation" labelZh="动机">
              <Select
                value={form.motivation_tag || null}
                onChange={(v) =>
                  setField(
                    "motivation_tag",
                    (v ?? "") as FormState["motivation_tag"],
                  )
                }
                options={MOTIVATION_OPTIONS}
              />
            </LabelRow>
            <LabelRow label="Old student" labelZh="老学员">
              <Toggle
                value={form.is_old_student}
                onChange={(v) => setField("is_old_student", v)}
              />
            </LabelRow>
          </div>
          <LabelRow label="Personality" labelZh="性格">
            <Textarea
              rows={3}
              value={form.personality}
              onChange={(v) => setField("personality", v)}
              placeholder="Observations on temperament, decision style, energy…"
            />
          </LabelRow>
          <LabelRow label="Face type" labelZh="面相">
            <Textarea
              rows={3}
              value={form.face_type}
              onChange={(v) => setField("face_type", v)}
              placeholder="Qualitative notes per Dr Wu's framework"
            />
          </LabelRow>
          <LabelRow label="Parameter framework" labelZh="参数体系">
            <Textarea
              rows={3}
              value={form.parameter_framework}
              onChange={(v) => setField("parameter_framework", v)}
              placeholder="Framework-specific parameters"
            />
          </LabelRow>
        </div>
      </Section>

      {/* Notes */}
      <Section eyebrow="Notes" eyebrowZh="备注" title="CS notes">
        <Textarea
          value={form.cs_notes}
          onChange={(v) => setField("cs_notes", v)}
          rows={6}
          placeholder="Enrichment context, meeting notes, follow-ups…"
        />
      </Section>

      {/* Assignments */}
      <Section
        eyebrow="Assignments"
        eyebrowZh="分配"
        title="Team owners"
      >
        <div className="flex flex-col gap-5">
          <LabelRow label="Regional lead" labelZh="地区主管">
            <Select
              value={form.assigned_region_lead_id || null}
              onChange={(v) => setField("assigned_region_lead_id", v ?? "")}
              options={regionLeads.map((a) => ({
                value: a.id,
                label: `${adminName(a)}${a.region ? ` · ${a.region}` : ""}`,
              }))}
              placeholder="Unassigned"
            />
          </LabelRow>
          <LabelRow label="Customer service" labelZh="客服">
            <Select
              value={form.assigned_cs_id || null}
              onChange={(v) => setField("assigned_cs_id", v ?? "")}
              options={customerService.map((a) => ({
                value: a.id,
                label: adminName(a),
              }))}
              placeholder="Unassigned"
            />
          </LabelRow>
        </div>
      </Section>

      {/* Action bar */}
      {error ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--cinnabar)]/30 bg-[var(--cinnabar-wash)] px-4 py-3 text-[13px] leading-[1.6] text-[var(--cinnabar-deep)]">
          {error}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <button
          type="button"
          onClick={() => router.push("/admin/participants")}
          disabled={submitting}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-[var(--radius-pill)]
                     text-[12.5px] text-[var(--ink-mute)] hover:text-[var(--ink)] hover:bg-[var(--paper-deep)]
                     disabled:opacity-50 disabled:cursor-not-allowed
                     transition-[background-color,color] duration-[var(--dur-fast)]"
        >
          ← Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className={`inline-flex items-center gap-2.5 h-11 px-6 rounded-[var(--radius-pill)]
                      text-[13px] tracking-[0.04em] font-medium
                      transition-[background-color,transform,box-shadow] duration-[var(--dur-fast)]
                      focus-visible:shadow-[var(--shadow-focus)]
                      ${
                        canSubmit
                          ? "bg-[var(--cinnabar)] text-[var(--paper-warm)] hover:bg-[var(--cinnabar-deep)] shadow-[0_4px_14px_rgba(37,99,235,0.25)] active:scale-[0.98]"
                          : "bg-[var(--paper-deep)] text-[var(--ink-faint)] cursor-not-allowed"
                      }`}
        >
          {submitting ? (
            <>
              <Spinner />
              Creating…
            </>
          ) : (
            "Create participant"
          )}
        </button>
      </div>
    </div>
  );
}

function Section({
  eyebrow,
  eyebrowZh,
  title,
  children,
}: {
  eyebrow: string;
  eyebrowZh?: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="relative rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)] p-7">
      <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
        <span className="w-5 h-px bg-current" />
        {eyebrow}
        {eyebrowZh ? (
          <span className="text-[var(--cinnabar)]/70">· {eyebrowZh}</span>
        ) : null}
      </div>
      <h2 className="mt-2 font-display text-[18px] leading-[1.25] tracking-[-0.005em] text-[var(--ink)]">
        {title}
      </h2>
      <div className="mt-6">{children}</div>
    </section>
  );
}

function Spinner() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      className="animate-spin"
    >
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
      <path d="M12.5 7a5.5 5.5 0 0 0-5.5-5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
