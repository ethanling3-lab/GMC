"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale } from "@/lib/locale-client";
import { confirmationSchema, SUPPORTED_REGIONS, type ConfirmationInput } from "@/lib/validation";

type Props = {
  token: string;
  regionId: string | null;
  alreadyConfirmed: boolean;
  initial: {
    name_cn: string | null;
    name_en: string | null;
    email: string | null;
    phone: string | null;
    region: string | null;
    occupation: string | null;
    industry: string | null;
  };
};

type State = { status: "idle" } | { status: "submitting" } | { status: "success" } | { status: "error"; code?: string };

export function ConfirmForm({ token, initial, regionId, alreadyConfirmed }: Props) {
  const { locale, t } = useLocale();
  const [state, setState] = useState<State>({ status: alreadyConfirmed ? "success" : "idle" });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ConfirmationInput>({
    resolver: zodResolver(confirmationSchema),
    defaultValues: {
      token,
      name_cn: initial.name_cn ?? "",
      name_en: initial.name_en ?? "",
      email: initial.email ?? "",
      phone: initial.phone ?? "",
      region: (initial.region as ConfirmationInput["region"]) ?? undefined,
      occupation: initial.occupation ?? "",
      industry: initial.industry ?? "",
    },
  });

  async function onSubmit(data: ConfirmationInput) {
    setState({ status: "submitting" });
    try {
      const res = await fetch("/api/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setState({ status: "error", code: json?.error });
        return;
      }
      setState({ status: "success" });
    } catch {
      setState({ status: "error", code: "network" });
    }
  }

  if (state.status === "success") {
    return (
      <div>
        <span className="eyebrow">{t("common.success")}</span>
        <h2 className="mt-4 font-display text-[var(--ink)]">{t("confirm.successTitle")}</h2>
        <p className="mt-4 text-[15px] leading-[1.75] text-[var(--ink-soft)] max-w-[540px]">
          {t("confirm.successBody")}
        </p>
        {regionId ? (
          <p className="mt-6 text-[12px] tracking-[0.22em] uppercase text-[var(--ink-mute)]">
            {locale === "zh" ? "你的参与者编号" : "Your participant ID"} ·{" "}
            <span className="text-[var(--cinnabar)] font-semibold">{regionId}</span>
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-8" noValidate>
      <input type="hidden" {...register("token")} />

      <div className="grid md:grid-cols-2 gap-8">
        <Field label={t("register.nameEn")} required error={errors.name_en?.message}>
          <Input {...register("name_en")} error={!!errors.name_en} />
        </Field>
        <Field label={t("register.nameCn")} error={errors.name_cn?.message}>
          <Input {...register("name_cn")} error={!!errors.name_cn} />
        </Field>
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        <Field label={t("register.email")} required error={errors.email?.message}>
          <Input type="email" {...register("email")} error={!!errors.email} />
        </Field>
        <Field label={t("register.phone")} required error={errors.phone?.message}>
          <Input type="tel" {...register("phone")} error={!!errors.phone} />
        </Field>
      </div>

      <Field label={t("register.region")} required error={errors.region?.message}>
        <Select {...register("region")} error={!!errors.region}>
          {SUPPORTED_REGIONS.map((r) => (
            <option key={r} value={r}>
              {t(`regions.${r}`)}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid md:grid-cols-2 gap-8">
        <Field label={t("register.occupation")} error={errors.occupation?.message}>
          <Input {...register("occupation")} error={!!errors.occupation} />
        </Field>
        <Field label={t("register.industry")} error={errors.industry?.message}>
          <Input {...register("industry")} error={!!errors.industry} />
        </Field>
      </div>

      {state.status === "error" ? (
        <div className="bg-[var(--cinnabar-wash)] border border-[var(--cinnabar)]/30 px-5 py-4 text-[14px] text-[var(--cinnabar-deep)]">
          {t("register.errorGeneric")}
        </div>
      ) : null}

      <div className="pt-2">
        <button
          type="submit"
          disabled={state.status === "submitting"}
          className="group inline-flex items-center gap-3 h-12 px-7 rounded-full bg-[var(--cinnabar)] text-[var(--paper-warm)] text-[13px] font-medium tracking-[0.02em]
                     shadow-[0_4px_14px_rgba(37,99,235,0.28)]
                     transition-[transform,box-shadow,background-color,opacity] duration-[var(--dur-base)] ease-[var(--ease-spring)]
                     hover:-translate-y-[1px] hover:bg-[var(--cinnabar-deep)] hover:shadow-[0_10px_24px_rgba(37,99,235,0.38)]
                     active:translate-y-0 disabled:opacity-60 disabled:cursor-wait"
        >
          {state.status === "submitting" ? t("common.loading") : t("confirm.submit")}
          <span aria-hidden="true" className="w-4 h-px bg-current transition-transform duration-[var(--dur-base)] ease-[var(--ease-spring)] group-hover:translate-x-1" />
        </button>
      </div>
    </form>
  );
}

function Field({ label, required, error, children }: { label: string; required?: boolean; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="flex items-baseline gap-2 text-[13px] font-medium text-[var(--ink)] tracking-[0.02em]">
        {label}
        {required ? <span className="text-[var(--cinnabar)]">*</span> : null}
      </span>
      <div className="mt-2">{children}</div>
      {error ? <span className="block mt-1.5 text-[12px] text-[var(--cinnabar)]">{error}</span> : null}
    </label>
  );
}

const cls =
  "block w-full h-11 px-3 bg-[var(--paper-warm)] border-0 border-b-[1.5px] " +
  "text-[15px] text-[var(--ink)] placeholder:text-[var(--ink-faint)] " +
  "transition-[border-color,background-color] duration-[var(--dur-fast)] ease-[var(--ease-out)] " +
  "hover:border-[var(--ink-mute)] focus:outline-none focus:border-[var(--cinnabar)] focus:bg-white";

function Input(props: React.InputHTMLAttributes<HTMLInputElement> & { error?: boolean }) {
  const { error, className, ...rest } = props;
  return <input {...rest} className={`${cls} ${error ? "border-[var(--cinnabar)]" : "border-[var(--paper-shadow)]"} ${className ?? ""}`} />;
}

function Select({ children, error, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement> & { error?: boolean; children: React.ReactNode }) {
  return (
    <div className="relative">
      <select {...rest} className={`${cls} pr-10 appearance-none ${error ? "border-[var(--cinnabar)]" : "border-[var(--paper-shadow)]"}`}>{children}</select>
      <svg aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-[var(--ink-mute)]" viewBox="0 0 12 12" fill="none">
        <path d="M2 4.5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
