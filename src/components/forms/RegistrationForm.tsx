"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale } from "@/lib/locale-client";
import { registrationSchema, SUPPORTED_REGIONS, type RegistrationInput, type RegistrationParsed } from "@/lib/validation";

type EventOption = { slug: string; title_cn: string | null; title_en: string | null };

type Props = {
  events: EventOption[];
  defaultEventSlug?: string;
};

type SubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success"; regionId?: string | null; devConfirmUrl?: string }
  | { status: "error"; code?: string };

export function RegistrationForm({ events, defaultEventSlug }: Props) {
  const { locale, t } = useLocale();
  const [submitState, setSubmitState] = useState<SubmitState>({ status: "idle" });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegistrationInput, unknown, RegistrationParsed>({
    resolver: zodResolver(registrationSchema),
    defaultValues: {
      event_slug: defaultEventSlug ?? "",
      language: locale === "en" ? "en" : "zh",
      gender: "undisclosed",
    },
  });

  async function onSubmit(data: RegistrationParsed) {
    setSubmitState({ status: "submitting" });
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok) {
        setSubmitState({ status: "error", code: json?.error });
        return;
      }
      setSubmitState({ status: "success", regionId: json.region_id, devConfirmUrl: json.dev_confirm_url });
    } catch {
      setSubmitState({ status: "error", code: "network" });
    }
  }

  if (submitState.status === "success") {
    return (
      <div className="bg-[var(--paper-warm)] border border-[var(--paper-shadow)] p-10 md:p-14 rounded-[var(--radius-lg)] shadow-[var(--shadow-paper-1)]">
        <span className="eyebrow">{t("common.success")}</span>
        <h2 className="mt-5 font-display text-[var(--ink)]">{t("register.successTitle")}</h2>
        <p className="mt-4 text-[15px] leading-[1.75] text-[var(--ink-soft)] max-w-[540px]">
          {t("register.successBody")}
        </p>
        {submitState.regionId ? (
          <p className="mt-6 text-[12px] tracking-[0.22em] uppercase text-[var(--ink-mute)]">
            {locale === "zh" ? "你的参与者编号" : "Your participant ID"} · <span className="text-[var(--cinnabar)] font-semibold">{submitState.regionId}</span>
          </p>
        ) : null}
        {submitState.devConfirmUrl ? (
          <div className="mt-6 p-4 bg-[var(--paper-deep)] border border-dashed border-[var(--paper-shadow)] text-[12px]">
            <div className="text-[var(--ink-mute)] tracking-[0.18em] uppercase mb-1">Dev · confirm link</div>
            <a href={submitState.devConfirmUrl} className="break-all text-[var(--cinnabar)] underline">
              {submitState.devConfirmUrl}
            </a>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-10" noValidate>
      {/* Event selection */}
      <FieldBlock label={t("register.selectEvent")} required error={errors.event_slug?.message}>
        <SelectField {...register("event_slug")} error={!!errors.event_slug}>
          <option value="">{t("register.selectEventPlaceholder")}</option>
          {events.map((e) => (
            <option key={e.slug} value={e.slug}>
              {(locale === "zh" ? e.title_cn : e.title_en) || e.title_en || e.title_cn || e.slug}
            </option>
          ))}
        </SelectField>
      </FieldBlock>

      {/* Names */}
      <div className="grid md:grid-cols-2 gap-8">
        <FieldBlock label={t("register.nameEn")} hint={t("register.nameEnHint")} required error={errors.name_en?.message}>
          <TextField {...register("name_en")} autoComplete="name" error={!!errors.name_en} />
        </FieldBlock>
        <FieldBlock label={t("register.nameCn")} error={errors.name_cn?.message}>
          <TextField {...register("name_cn")} autoComplete="off" error={!!errors.name_cn} />
        </FieldBlock>
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        <FieldBlock label={t("register.email")} required error={errors.email?.message}>
          <TextField type="email" inputMode="email" {...register("email")} autoComplete="email" error={!!errors.email} />
        </FieldBlock>
        <FieldBlock label={t("register.phone")} hint={t("register.phoneHint")} required error={errors.phone?.message}>
          <TextField type="tel" inputMode="tel" {...register("phone")} autoComplete="tel" placeholder="+65 8888 8888" error={!!errors.phone} />
        </FieldBlock>
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        <FieldBlock label={t("register.region")} required error={errors.region?.message}>
          <SelectField {...register("region")} error={!!errors.region}>
            <option value="">{t("register.selectEventPlaceholder")}</option>
            {SUPPORTED_REGIONS.map((r) => (
              <option key={r} value={r}>
                {t(`regions.${r}`)}
              </option>
            ))}
          </SelectField>
        </FieldBlock>
        <FieldBlock label={t("register.language")} required error={errors.language?.message}>
          <SelectField {...register("language")} error={!!errors.language}>
            <option value="zh">{t("register.languageZh")}</option>
            <option value="en">{t("register.languageEn")}</option>
            <option value="both">{t("register.languageBoth")}</option>
          </SelectField>
        </FieldBlock>
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        <FieldBlock label={t("register.gender")} error={errors.gender?.message}>
          <SelectField {...register("gender")} error={!!errors.gender}>
            <option value="undisclosed">{t("register.genderUndisclosed")}</option>
            <option value="male">{t("register.genderMale")}</option>
            <option value="female">{t("register.genderFemale")}</option>
            <option value="other">{t("register.genderOther")}</option>
          </SelectField>
        </FieldBlock>
        <FieldBlock label={t("register.birthDate")} error={errors.birth_date?.message}>
          <TextField type="date" {...register("birth_date")} error={!!errors.birth_date} />
        </FieldBlock>
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        <FieldBlock label={t("register.occupation")} error={errors.occupation?.message}>
          <TextField {...register("occupation")} autoComplete="organization-title" error={!!errors.occupation} />
        </FieldBlock>
        <FieldBlock label={t("register.industry")} error={errors.industry?.message}>
          <TextField {...register("industry")} error={!!errors.industry} />
        </FieldBlock>
      </div>

      {/* Referrer section */}
      <div className="mt-2 pt-10 border-t border-[var(--paper-shadow)]">
        <span className="eyebrow">{t("register.referrerHeading")}</span>
        <p className="mt-4 text-[14px] leading-[1.7] text-[var(--ink-soft)] max-w-[560px]">
          {t("register.referrerNote")}
        </p>
        <div className="mt-8 grid md:grid-cols-2 gap-8">
          <FieldBlock label={t("register.referrerName")} required error={errors.referrer_name?.message}>
            <TextField {...register("referrer_name")} error={!!errors.referrer_name} />
          </FieldBlock>
          <FieldBlock label={t("register.referrerContact")} error={errors.referrer_contact?.message}>
            <TextField {...register("referrer_contact")} error={!!errors.referrer_contact} />
          </FieldBlock>
        </div>
      </div>

      {submitState.status === "error" ? (
        <div
          role="alert"
          className="bg-[var(--cinnabar-wash)] border border-[var(--cinnabar)]/30 px-5 py-4 text-[14px] text-[var(--cinnabar-deep)]"
        >
          <strong className="font-semibold">{t("register.errorTitle")}: </strong>
          {submitState.code === "already_enrolled"
            ? t("register.errorDuplicate")
            : t("register.errorGeneric")}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-6 pt-4">
        <p className="text-[11px] tracking-[0.18em] uppercase text-[var(--ink-mute)]">
          {locale === "zh" ? "标有 * 为必填项" : "Fields marked * are required"}
        </p>
        <button
          type="submit"
          disabled={submitState.status === "submitting"}
          aria-label={submitState.status === "submitting" ? t("register.submittingAria") : undefined}
          className="group inline-flex items-center gap-3 h-12 px-7 rounded-full bg-[var(--cinnabar)] text-[var(--paper-warm)] text-[13px] font-medium tracking-[0.02em]
                     shadow-[0_4px_14px_rgba(37,99,235,0.28)]
                     transition-[transform,box-shadow,background-color,opacity] duration-[var(--dur-base)] ease-[var(--ease-spring)]
                     hover:-translate-y-[1px] hover:bg-[var(--cinnabar-deep)] hover:shadow-[0_10px_24px_rgba(37,99,235,0.38)]
                     active:translate-y-0 disabled:opacity-60 disabled:cursor-wait"
        >
          {submitState.status === "submitting" ? t("common.loading") : t("register.submit")}
          <span
            aria-hidden="true"
            className="w-4 h-px bg-current transition-transform duration-[var(--dur-base)] ease-[var(--ease-spring)] group-hover:translate-x-1"
          />
        </button>
      </div>
    </form>
  );
}

// -------- Small internal field primitives -------- //

function FieldBlock({
  label,
  hint,
  required,
  error,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline gap-2 text-[13px] font-medium text-[var(--ink)] tracking-[0.02em]">
        {label}
        {required ? <span className="text-[var(--cinnabar)]">*</span> : null}
      </span>
      {hint ? <span className="block mt-1 text-[12px] text-[var(--ink-mute)]">{hint}</span> : null}
      <div className="mt-2">{children}</div>
      {error ? (
        <span className="block mt-1.5 text-[12px] text-[var(--cinnabar)]">{error}</span>
      ) : null}
    </label>
  );
}

const fieldCls =
  "block w-full h-11 px-3 bg-[var(--paper-warm)] border-0 border-b-[1.5px] " +
  "text-[15px] text-[var(--ink)] placeholder:text-[var(--ink-faint)] " +
  "transition-[border-color,background-color] duration-[var(--dur-fast)] ease-[var(--ease-out)] " +
  "hover:border-[var(--ink-mute)] focus:outline-none focus:border-[var(--cinnabar)] focus:bg-white";

function TextField(props: React.InputHTMLAttributes<HTMLInputElement> & { error?: boolean }) {
  const { error, className, ...rest } = props;
  return (
    <input
      {...rest}
      className={`${fieldCls} ${error ? "border-[var(--cinnabar)]" : "border-[var(--paper-shadow)]"} ${className ?? ""}`}
    />
  );
}

function SelectField({
  children,
  error,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement> & { error?: boolean; children: React.ReactNode }) {
  return (
    <div className="relative">
      <select
        {...rest}
        className={`${fieldCls} pr-10 appearance-none ${error ? "border-[var(--cinnabar)]" : "border-[var(--paper-shadow)]"}`}
      >
        {children}
      </select>
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-[var(--ink-mute)]"
        viewBox="0 0 12 12"
        fill="none"
      >
        <path d="M2 4.5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
