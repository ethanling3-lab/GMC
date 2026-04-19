"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale } from "@/lib/locale-client";
import {
  SUPPORTED_REGIONS,
  buildRegistrationSchemaFor,
} from "@/lib/validation";
import {
  defaultFormSchema,
  normalizeFormSchema,
  type FormSchema,
} from "@/lib/event-form-schema";
import { DynamicFormFields } from "./DynamicFormFields";
import {
  FieldBlock,
  SelectField,
  TextField,
} from "./_primitives";

type EventOption = {
  slug: string;
  title_cn: string | null;
  title_en: string | null;
  form_schema: unknown;
};

type PrefillValues = {
  name_en?: string | null;
  name_cn?: string | null;
  email?: string | null;
  phone?: string | null;
  region?: string | null;
  gender?: string | null;
  birth_date?: string | null;
  occupation?: string | null;
  industry?: string | null;
};

type Props = {
  events: EventOption[];
  defaultEventSlug?: string;
  prefillToken?: string;
  prefillValues?: PrefillValues | null;
};

type SubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  | {
      status: "success";
      regionId?: string | null;
      devConfirmUrl?: string;
    }
  | { status: "error"; code?: string };

type PrefillRequestState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "sent" }
  | { status: "error" };

type RegistrationFormValues = {
  event_slug: string;
  name_en: string;
  name_cn?: string;
  email: string;
  phone: string;
  region: string;
  language: "zh" | "en" | "both";
  gender: "male" | "female" | "other" | "undisclosed";
  birth_date?: string;
  occupation?: string;
  industry?: string;
  referrer_name?: string;
  referrer_contact?: string;
  region_other?: string;
  prefill_token?: string;
  answers: Record<string, unknown>;
};

export function RegistrationForm({
  events,
  defaultEventSlug,
  prefillToken,
  prefillValues,
}: Props) {
  const { locale, t } = useLocale();
  const [submitState, setSubmitState] = useState<SubmitState>({ status: "idle" });
  const [selectedSlug, setSelectedSlug] = useState(defaultEventSlug ?? "");

  const schemaByEvent = useMemo(() => {
    const map = new Map<string, FormSchema>();
    for (const e of events) {
      map.set(e.slug, normalizeFormSchema(e.form_schema));
    }
    return map;
  }, [events]);

  const fallbackSchema = useMemo(() => defaultFormSchema(), []);

  const activeSchema: FormSchema = useMemo(
    () =>
      (selectedSlug ? schemaByEvent.get(selectedSlug) : undefined) ??
      fallbackSchema,
    [selectedSlug, schemaByEvent, fallbackSchema],
  );

  const resolver = useMemo(
    () =>
      zodResolver(
        buildRegistrationSchemaFor(activeSchema.identity, activeSchema),
      ),
    [activeSchema],
  );

  const defaultAnswers = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const f of activeSchema.fields) {
      if (f.type === "multi_select") out[f.id] = [];
      else if (f.type === "checkbox_ack") out[f.id] = false;
      else out[f.id] = "";
    }
    return out;
  }, [activeSchema]);

  const {
    register,
    handleSubmit,
    reset,
    control,
    watch,
    formState: { errors },
  } = useForm<RegistrationFormValues>({
    // Cast keeps react-hook-form happy — the resolver is built dynamically from the event schema.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: resolver as any,
    defaultValues: {
      event_slug: defaultEventSlug ?? "",
      language: locale === "en" ? "en" : "zh",
      gender: "undisclosed",
      name_en: prefillValues?.name_en ?? "",
      name_cn: prefillValues?.name_cn ?? "",
      email: prefillValues?.email ?? "",
      phone: prefillValues?.phone ?? "",
      region:
        prefillValues?.region && (SUPPORTED_REGIONS as readonly string[]).includes(prefillValues.region)
          ? prefillValues.region
          : "",
      birth_date: prefillValues?.birth_date ?? "",
      occupation: prefillValues?.occupation ?? "",
      industry: prefillValues?.industry ?? "",
      prefill_token: prefillToken,
      answers: defaultAnswers,
    },
  });

  // Keep `event_slug` watched so the active schema / resolver swaps in sync with the dropdown.
  const watchedSlug = watch("event_slug");
  useEffect(() => {
    setSelectedSlug(watchedSlug || "");
  }, [watchedSlug]);

  // Reveal the "please specify" input inline when Region is set to Other.
  const watchedRegion = watch("region");

  // When the selected event changes, reset `answers` to the new schema's defaults
  // but preserve all other identity fields the user may have typed.
  useEffect(() => {
    reset(
      (prev) => ({
        ...prev,
        answers: defaultAnswers,
      }),
      { keepDefaultValues: false, keepErrors: false },
    );
  }, [defaultAnswers, reset]);

  async function onSubmit(data: RegistrationFormValues) {
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
      setSubmitState({
        status: "success",
        regionId: json.region_id,
        devConfirmUrl: json.dev_confirm_url,
      });
    } catch {
      setSubmitState({ status: "error", code: "network" });
    }
  }

  if (submitState.status === "success") {
    return (
      <div className="bg-[var(--paper-warm)] border border-[var(--paper-shadow)] p-10 md:p-14 rounded-[var(--radius-lg)] shadow-[var(--shadow-paper-1)]">
        <span className="eyebrow">{t("common.success")}</span>
        <h2 className="mt-5 font-display text-[var(--ink)]">
          {t("register.successTitle")}
        </h2>
        <p className="mt-4 text-[15px] leading-[1.75] text-[var(--ink-soft)] max-w-[540px]">
          {t("register.successBody")}
        </p>
        {submitState.regionId ? (
          <p className="mt-6 text-[12px] tracking-[0.22em] uppercase text-[var(--ink-mute)]">
            {locale === "zh" ? "你的参与者编号" : "Your participant ID"} ·{" "}
            <span className="text-[var(--cinnabar)] font-semibold">
              {submitState.regionId}
            </span>
          </p>
        ) : null}
        {submitState.devConfirmUrl ? (
          <div className="mt-6 p-4 bg-[var(--paper-deep)] border border-dashed border-[var(--paper-shadow)] text-[12px]">
            <div className="text-[var(--ink-mute)] tracking-[0.18em] uppercase mb-1">
              Dev · confirm link
            </div>
            <a
              href={submitState.devConfirmUrl}
              className="break-all text-[var(--cinnabar)] underline"
            >
              {submitState.devConfirmUrl}
            </a>
          </div>
        ) : null}
      </div>
    );
  }

  const identity = activeSchema.identity;
  const prefilledBanner = prefillToken && prefillValues ? (
    <div className="rounded-[var(--radius-md)] border border-[var(--jade)]/30 bg-[var(--jade-wash)] px-5 py-4 flex items-start gap-3">
      <svg
        width="18"
        height="18"
        viewBox="0 0 18 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="text-[var(--jade-deep)] mt-0.5"
      >
        <path d="M3.5 9l4 4 7-7.5" />
      </svg>
      <div className="text-[13px] leading-[1.65] text-[var(--jade-deep)]">
        {locale === "zh"
          ? "已为您自动填入上次的资料。请核对后仅补充本次活动的新问题。"
          : "We've prefilled your info from a previous registration. Review it, then answer only the new event-specific questions."}
      </div>
    </div>
  ) : null;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-10" noValidate>
      {prefilledBanner}
      {!prefillToken ? (
        <ReturningParticipantPanel
          locale={locale}
          eventSlug={selectedSlug}
        />
      ) : null}

      {/* Event selection */}
      <FieldBlock
        label={t("register.selectEvent")}
        required
        error={errors.event_slug?.message}
      >
        <SelectField {...register("event_slug")} error={!!errors.event_slug}>
          <option value="">{t("register.selectEventPlaceholder")}</option>
          {events.map((e) => (
            <option key={e.slug} value={e.slug}>
              {(locale === "zh" ? e.title_cn : e.title_en) ||
                e.title_en ||
                e.title_cn ||
                e.slug}
            </option>
          ))}
        </SelectField>
      </FieldBlock>

      {/* Names — left side has a hint, so reserve matching space on the right. */}
      <div className="grid md:grid-cols-2 gap-8">
        <FieldBlock
          label={t("register.nameEn")}
          hint={t("register.nameEnHint")}
          reserveHint
          required
          error={errors.name_en?.message}
        >
          <TextField
            {...register("name_en")}
            autoComplete="name"
            error={!!errors.name_en}
          />
        </FieldBlock>
        <FieldBlock
          label={t("register.nameCn")}
          reserveHint
          required={identity.require_name_cn}
          error={errors.name_cn?.message}
        >
          <TextField
            {...register("name_cn")}
            autoComplete="off"
            error={!!errors.name_cn}
          />
        </FieldBlock>
      </div>

      {/* Email + phone — right side has a hint, so reserve matching space on the left. */}
      <div className="grid md:grid-cols-2 gap-8">
        <FieldBlock
          label={t("register.email")}
          reserveHint
          required
          error={errors.email?.message}
        >
          <TextField
            type="email"
            inputMode="email"
            {...register("email")}
            autoComplete="email"
            error={!!errors.email}
          />
        </FieldBlock>
        <FieldBlock
          label={t("register.phone")}
          hint={t("register.phoneHint")}
          reserveHint
          required
          error={errors.phone?.message}
        >
          <TextField
            type="tel"
            inputMode="tel"
            {...register("phone")}
            autoComplete="tel"
            placeholder="+65 8888 8888"
            error={!!errors.phone}
          />
        </FieldBlock>
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        <FieldBlock
          label={t("register.region")}
          required
          error={errors.region?.message || errors.region_other?.message}
        >
          <SelectField {...register("region")} error={!!errors.region}>
            <option value="">{t("register.selectEventPlaceholder")}</option>
            {SUPPORTED_REGIONS.map((r) => (
              <option key={r} value={r}>
                {t(`regions.${r}`)}
              </option>
            ))}
          </SelectField>
          {watchedRegion === "OTHER" ? (
            <div className="mt-3 pl-4 border-l-2 border-[var(--cinnabar)]/50">
              <label className="block text-[11px] tracking-[0.18em] uppercase text-[var(--ink-mute)]">
                {locale === "zh" ? "请填写国家 / 地区" : "Please specify country / region"}
              </label>
              <input
                type="text"
                {...register("region_other")}
                placeholder={
                  locale === "zh" ? "例如：英国" : "e.g. United Kingdom"
                }
                className={
                  "mt-1 block w-full h-10 px-3 bg-[var(--paper-warm)] border-0 border-b-[1.5px] " +
                  "text-[15px] text-[var(--ink)] placeholder:text-[var(--ink-faint)] " +
                  "transition-[border-color,background-color] duration-[var(--dur-fast)] ease-[var(--ease-out)] " +
                  "hover:border-[var(--ink-mute)] focus:outline-none focus:border-[var(--cinnabar)] focus:bg-white " +
                  (errors.region_other
                    ? "border-[var(--cinnabar)]"
                    : "border-[var(--paper-shadow)]")
                }
              />
            </div>
          ) : null}
        </FieldBlock>
        <FieldBlock
          label={t("register.language")}
          required
          error={errors.language?.message}
        >
          <SelectField {...register("language")} error={!!errors.language}>
            <option value="zh">{t("register.languageZh")}</option>
            <option value="en">{t("register.languageEn")}</option>
            <option value="both">{t("register.languageBoth")}</option>
          </SelectField>
        </FieldBlock>
      </div>

      {identity.require_gender || identity.require_birth_date ? (
        <div className="grid md:grid-cols-2 gap-8">
          {identity.require_gender || prefillValues?.gender ? (
            <FieldBlock
              label={t("register.gender")}
              required={identity.require_gender}
              error={errors.gender?.message}
            >
              <SelectField {...register("gender")} error={!!errors.gender}>
                {!identity.require_gender ? (
                  <option value="undisclosed">
                    {t("register.genderUndisclosed")}
                  </option>
                ) : null}
                <option value="male">{t("register.genderMale")}</option>
                <option value="female">{t("register.genderFemale")}</option>
                <option value="other">{t("register.genderOther")}</option>
              </SelectField>
            </FieldBlock>
          ) : null}
          {identity.require_birth_date ? (
            <FieldBlock
              label={t("register.birthDate")}
              required
              error={errors.birth_date?.message}
            >
              <TextField
                type="date"
                {...register("birth_date")}
                error={!!errors.birth_date}
              />
            </FieldBlock>
          ) : null}
        </div>
      ) : null}

      {identity.require_occupation || identity.require_industry ? (
        <div className="grid md:grid-cols-2 gap-8">
          {identity.require_occupation ? (
            <FieldBlock
              label={t("register.occupation")}
              required
              error={errors.occupation?.message}
            >
              <TextField
                {...register("occupation")}
                autoComplete="organization-title"
                error={!!errors.occupation}
              />
            </FieldBlock>
          ) : null}
          {identity.require_industry ? (
            <FieldBlock
              label={t("register.industry")}
              required
              error={errors.industry?.message}
            >
              <TextField
                {...register("industry")}
                error={!!errors.industry}
              />
            </FieldBlock>
          ) : null}
        </div>
      ) : null}

      {/* Referrer section — still shown if identity.require_referrer */}
      {identity.require_referrer ? (
        <div className="mt-2 pt-10 border-t border-[var(--paper-shadow)]">
          <span className="eyebrow">{t("register.referrerHeading")}</span>
          <p className="mt-4 text-[14px] leading-[1.7] text-[var(--ink-soft)] max-w-[560px]">
            {t("register.referrerNote")}
          </p>
          <div className="mt-8 grid md:grid-cols-2 gap-8">
            <FieldBlock
              label={t("register.referrerName")}
              required
              error={errors.referrer_name?.message}
            >
              <TextField
                {...register("referrer_name")}
                error={!!errors.referrer_name}
              />
            </FieldBlock>
            <FieldBlock
              label={t("register.referrerContact")}
              error={errors.referrer_contact?.message}
            >
              <TextField
                {...register("referrer_contact")}
                error={!!errors.referrer_contact}
              />
            </FieldBlock>
          </div>
        </div>
      ) : null}

      {/* Custom questions from event form schema */}
      {activeSchema.fields.length > 0 ? (
        <div className="mt-2 pt-10 border-t border-[var(--paper-shadow)]">
          <span className="eyebrow">
            {locale === "zh" ? "本次活动问题" : "Event questions"}
          </span>
          <div className="mt-6">
            <DynamicFormFields
              schema={activeSchema}
              locale={locale}
              register={register as unknown as Parameters<typeof DynamicFormFields>[0]["register"]}
              control={control as unknown as Parameters<typeof DynamicFormFields>[0]["control"]}
              errors={errors as unknown as Parameters<typeof DynamicFormFields>[0]["errors"]}
            />
          </div>
        </div>
      ) : null}

      {submitState.status === "error" ? (
        <div
          role="alert"
          className="bg-[var(--cinnabar-wash)] border border-[var(--cinnabar)]/30 px-5 py-4 text-[14px] text-[var(--cinnabar-deep)]"
        >
          <strong className="font-semibold">{t("register.errorTitle")}: </strong>
          {submitState.code === "already_enrolled"
            ? t("register.errorDuplicate")
            : submitState.code === "prefill_invalid"
              ? locale === "zh"
                ? "快速填入链接无效或已过期，请重新申请。"
                : "Your quick-fill link has expired. Request a new one."
              : t("register.errorGeneric")}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-6 pt-4">
        <p className="text-[11px] tracking-[0.18em] uppercase text-[var(--ink-mute)]">
          {locale === "zh"
            ? "标有 * 为必填项"
            : "Fields marked * are required"}
        </p>
        <button
          type="submit"
          disabled={submitState.status === "submitting"}
          aria-label={
            submitState.status === "submitting"
              ? t("register.submittingAria")
              : undefined
          }
          style={{ color: "#ffffff" }}
          className="group inline-flex items-center gap-3 h-12 px-7 rounded-full bg-[var(--cinnabar)] text-[13px] font-medium tracking-[0.02em]
                     shadow-[0_4px_14px_rgba(37,99,235,0.28)]
                     transition-[transform,box-shadow,background-color,opacity] duration-[var(--dur-base)] ease-[var(--ease-spring)]
                     hover:-translate-y-[1px] hover:bg-[var(--cinnabar-deep)] hover:shadow-[0_10px_24px_rgba(37,99,235,0.38)]
                     active:translate-y-0 disabled:opacity-60 disabled:cursor-wait"
        >
          {submitState.status === "submitting"
            ? t("common.loading")
            : t("register.submit")}
          <span
            aria-hidden="true"
            className="w-4 h-px bg-current transition-transform duration-[var(--dur-base)] ease-[var(--ease-spring)] group-hover:translate-x-1"
          />
        </button>
      </div>
    </form>
  );
}

// -------- Returning participant magic-link panel -------- //

function ReturningParticipantPanel({
  locale,
  eventSlug,
}: {
  locale: "zh" | "en";
  eventSlug: string;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [state, setState] = useState<PrefillRequestState>({ status: "idle" });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (state.status === "submitting") return;
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) {
      setState({ status: "error" });
      return;
    }
    setState({ status: "submitting" });
    try {
      const res = await fetch("/api/register/prefill-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed, event_slug: eventSlug || undefined }),
      });
      if (res.ok || res.status === 204) {
        setState({ status: "sent" });
      } else {
        setState({ status: "error" });
      }
    } catch {
      setState({ status: "error" });
    }
  }

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] px-5 py-4">
      {!open ? (
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="text-[13px] text-[var(--ink-soft)]">
            {locale === "zh"
              ? "之前在此报名过？可以跳过资料填写。"
              : "Registered with us before? Skip the identity fields."}
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-2 text-[12.5px] font-medium text-[var(--cinnabar-deep)] hover:text-[var(--cinnabar)] transition-colors duration-[var(--dur-fast)]"
          >
            {locale === "zh" ? "快速填入 →" : "Quick-fill with email →"}
          </button>
        </div>
      ) : state.status === "sent" ? (
        <div className="text-[13px] leading-[1.65] text-[var(--jade-deep)]">
          {locale === "zh"
            ? "如果该邮箱在我们的记录中，您会收到一封包含「一键填入」链接的邮件（20 分钟内有效）。"
            : "If that email is in our records, we've sent a one-time \u201cquick-fill\u201d link (valid for 20 minutes). Please check your inbox."}
        </div>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col sm:flex-row gap-3">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={
              locale === "zh" ? "请输入您注册时使用的邮箱" : "Email you registered with"
            }
            className="flex-1 h-10 px-3 rounded-[var(--radius-sm)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] text-[14px] text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:outline-none focus:border-[var(--cinnabar)]/60 focus:shadow-[var(--shadow-focus)] transition-[border-color,box-shadow] duration-[var(--dur-fast)]"
          />
          <button
            type="submit"
            disabled={state.status === "submitting"}
            className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] text-[var(--paper-warm)] text-[12.5px] font-medium tracking-[0.02em] hover:bg-[var(--cinnabar-deep)] disabled:opacity-60 disabled:cursor-wait shadow-[0_4px_14px_rgba(37,99,235,0.25)] transition-[background-color] duration-[var(--dur-fast)]"
          >
            {state.status === "submitting"
              ? locale === "zh"
                ? "发送中…"
                : "Sending…"
              : locale === "zh"
                ? "发送链接"
                : "Send link"}
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setState({ status: "idle" });
            }}
            className="text-[12px] text-[var(--ink-mute)] hover:text-[var(--ink)] transition-colors duration-[var(--dur-fast)]"
          >
            {locale === "zh" ? "取消" : "Cancel"}
          </button>
        </form>
      )}
    </div>
  );
}
