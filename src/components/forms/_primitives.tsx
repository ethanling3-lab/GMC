"use client";

import React, { useEffect, useRef, useState } from "react";

// Shared form field primitives used by both the public RegistrationForm and
// the admin DynamicFormFields renderer. Styling matches the editorial blue
// aesthetic (border-bottom inputs, cinnabar accents, focus rings).

export function FieldBlock({
  label,
  hint,
  required,
  error,
  reserveHint,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  error?: string;
  // When true, always render the hint row (even if `hint` is empty). Use on
  // sibling fields in a 2-col grid so the input tops stay aligned when only
  // one side of the pair has a hint.
  reserveHint?: boolean;
  children: React.ReactNode;
}) {
  const showHintRow = Boolean(hint) || reserveHint;
  return (
    <label className="block">
      <span className="flex items-baseline gap-2 text-[13px] font-medium text-[var(--ink)] tracking-[0.02em]">
        {label}
        {required ? <span className="text-[var(--cinnabar)]">*</span> : null}
      </span>
      {showHintRow ? (
        <span className="block mt-1 text-[12px] leading-[1.4] text-[var(--ink-mute)] min-h-[17px]">
          {hint || "\u00A0"}
        </span>
      ) : null}
      <div className="mt-2">{children}</div>
      {error ? (
        <span className="block mt-1.5 text-[12px] text-[var(--cinnabar)]">
          {error}
        </span>
      ) : null}
    </label>
  );
}

export const fieldCls =
  "block w-full h-11 px-3 bg-[var(--paper-warm)] border-0 border-b-[1.5px] " +
  "text-[15px] text-[var(--ink)] placeholder:text-[var(--ink-faint)] " +
  "transition-[border-color,background-color] duration-[var(--dur-fast)] ease-[var(--ease-out)] " +
  "hover:border-[var(--ink-mute)] focus:outline-none focus:border-[var(--cinnabar)] focus:bg-white";

export function TextField(
  props: React.InputHTMLAttributes<HTMLInputElement> & { error?: boolean },
) {
  const { error, className, ...rest } = props;
  return (
    <input
      {...rest}
      className={`${fieldCls} ${error ? "border-[var(--cinnabar)]" : "border-[var(--paper-shadow)]"} ${className ?? ""}`}
    />
  );
}

export function SelectField({
  children,
  error,
  className,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  error?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <select
        {...rest}
        className={`${fieldCls} pr-10 appearance-none ${error ? "border-[var(--cinnabar)]" : "border-[var(--paper-shadow)]"} ${className ?? ""}`}
      >
        {children}
      </select>
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-[var(--ink-mute)]"
        viewBox="0 0 12 12"
        fill="none"
      >
        <path
          d="M2 4.5l4 4 4-4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

export function TextareaField(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
    error?: boolean;
  },
) {
  const { error, className, rows = 4, ...rest } = props;
  return (
    <textarea
      {...rest}
      rows={rows}
      className={
        "block w-full px-3 py-3 bg-[var(--paper-warm)] border-[1.5px] " +
        "text-[15px] leading-[1.7] text-[var(--ink)] placeholder:text-[var(--ink-faint)] " +
        "rounded-[var(--radius-sm)] " +
        "transition-[border-color,background-color] duration-[var(--dur-fast)] ease-[var(--ease-out)] " +
        "hover:border-[var(--ink-mute)] focus:outline-none focus:border-[var(--cinnabar)] focus:bg-white " +
        `${error ? "border-[var(--cinnabar)]" : "border-[var(--paper-shadow)]"} ${className ?? ""}`
      }
    />
  );
}

// Legacy inline checkbox — label sits beside the box. Keep it around for
// terse yes/no questions, but use <AcknowledgementBlock> for the standard
// "terms paragraph + agree checkbox below" pattern participants expect.
export function CheckboxField({
  label,
  hint,
  required,
  error,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  required?: boolean;
  error?: string;
}) {
  return (
    <label
      className="group flex items-start gap-3 p-4 bg-[var(--paper-warm)] border border-[var(--paper-shadow)]
                 rounded-[var(--radius-sm)] cursor-pointer
                 transition-[border-color,background-color] duration-[var(--dur-fast)]
                 hover:border-[var(--ink-mute)] hover:bg-white
                 has-[:focus-visible]:shadow-[var(--shadow-focus)]"
    >
      <input
        type="checkbox"
        {...rest}
        className="mt-1 h-4 w-4 shrink-0 accent-[var(--cinnabar)] cursor-pointer"
      />
      <div className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2 text-[14px] leading-[1.5] text-[var(--ink)]">
          <span>{label}</span>
          {required ? (
            <span className="text-[var(--cinnabar)]">*</span>
          ) : null}
        </span>
        {hint ? (
          <span className="block mt-1 text-[12px] leading-[1.6] text-[var(--ink-mute)]">
            {hint}
          </span>
        ) : null}
        {error ? (
          <span className="block mt-1.5 text-[12px] text-[var(--cinnabar)]">
            {error}
          </span>
        ) : null}
      </div>
    </label>
  );
}

// Country calling codes for the phone input dropdown. Ordered with the most
// common Dr Wu regions first, then a small set of frequent outliers. The
// label mirrors what participants expect to see ("+65 Singapore" / "+65
// 新加坡"). Safe to extend later without a migration — the stored phone
// value is just the composed "+<code> <digits>" string.
export const PHONE_COUNTRY_CODES: {
  code: string;
  label_en: string;
  label_cn: string;
}[] = [
  { code: "+65", label_en: "Singapore", label_cn: "新加坡" },
  { code: "+60", label_en: "Malaysia", label_cn: "马来西亚" },
  { code: "+886", label_en: "Taiwan", label_cn: "台湾" },
  { code: "+852", label_en: "Hong Kong", label_cn: "香港" },
  { code: "+86", label_en: "China", label_cn: "中国" },
  { code: "+853", label_en: "Macau", label_cn: "澳门" },
  { code: "+62", label_en: "Indonesia", label_cn: "印尼" },
  { code: "+66", label_en: "Thailand", label_cn: "泰国" },
  { code: "+84", label_en: "Vietnam", label_cn: "越南" },
  { code: "+63", label_en: "Philippines", label_cn: "菲律宾" },
  { code: "+1", label_en: "US / Canada", label_cn: "美国 / 加拿大" },
  { code: "+61", label_en: "Australia", label_cn: "澳大利亚" },
  { code: "+64", label_en: "New Zealand", label_cn: "新西兰" },
  { code: "+44", label_en: "United Kingdom", label_cn: "英国" },
  { code: "+81", label_en: "Japan", label_cn: "日本" },
  { code: "+82", label_en: "South Korea", label_cn: "韩国" },
  { code: "+49", label_en: "Germany", label_cn: "德国" },
  { code: "+33", label_en: "France", label_cn: "法国" },
];

// Split a stored phone value into { code, digits }. Accepts "+65 91234567",
// "+6591234567", or just digits. Defaults to +65 if no code recognised.
export function splitPhone(value: string): { code: string; digits: string } {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return { code: "+65", digits: "" };
  const match = trimmed.match(/^(\+\d{1,4})\s*(.*)$/);
  if (match && PHONE_COUNTRY_CODES.some((c) => c.code === match[1])) {
    return { code: match[1], digits: match[2].replace(/\s+/g, " ").trim() };
  }
  // No prefix — treat the whole thing as digits, keep code empty.
  return { code: "+65", digits: trimmed };
}

export function PhoneField({
  value,
  onChange,
  error,
  locale,
  placeholder,
  name,
}: {
  value: string;
  onChange: (next: string) => void;
  error?: boolean;
  locale: "zh" | "en";
  placeholder?: string;
  name?: string;
}) {
  const { code, digits } = splitPhone(value);
  const [open, setOpen] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (
        popupRef.current?.contains(e.target as Node) ||
        buttonRef.current?.contains(e.target as Node)
      ) {
        return;
      }
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pushCode(next: string) {
    onChange(`${next} ${digits}`.trim());
    setOpen(false);
    buttonRef.current?.focus();
  }
  function pushDigits(next: string) {
    // Allow digits, spaces, dashes, parens — strip everything else.
    const cleaned = next.replace(/[^\d()\s-]/g, "");
    onChange(`${code} ${cleaned}`.trim());
  }

  return (
    <div className="grid grid-cols-[92px_1fr] gap-2">
      <div className="relative">
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={locale === "zh" ? "国际区号" : "Country calling code"}
          className={`${fieldCls} inline-flex items-center justify-between px-3 pr-2.5 text-[14px] tabular-nums cursor-pointer ${
            error ? "border-[var(--cinnabar)]" : "border-[var(--paper-shadow)]"
          } ${open ? "border-[var(--cinnabar)]" : ""}`}
        >
          <span>{code}</span>
          <svg
            aria-hidden="true"
            className={`w-3 h-3 text-[var(--ink-mute)] transition-transform duration-[var(--dur-fast)] ${open ? "rotate-180" : ""}`}
            viewBox="0 0 12 12"
            fill="none"
          >
            <path
              d="M2 4.5l4 4 4-4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {open ? (
          <div
            ref={popupRef}
            role="listbox"
            className="absolute left-0 top-[calc(100%+4px)] z-20 w-[260px] max-h-[320px] overflow-y-auto
                       rounded-[var(--radius-md)] border border-[var(--paper-shadow)]
                       bg-[var(--paper-warm)] shadow-[var(--shadow-paper-2)] p-1.5"
          >
            {PHONE_COUNTRY_CODES.map((c) => {
              const selected = c.code === code;
              return (
                <button
                  key={c.code}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => pushCode(c.code)}
                  className={`w-full flex items-baseline justify-between gap-3 px-3 py-2 rounded-[var(--radius-sm)] text-left
                              transition-[background-color,color] duration-[var(--dur-fast)]
                              ${
                                selected
                                  ? "bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
                                  : "text-[var(--ink)] hover:bg-[var(--paper-deep)]"
                              }`}
                >
                  <span className="font-medium tabular-nums">{c.code}</span>
                  <span className="text-[12.5px] text-[var(--ink-mute)] text-right truncate">
                    {locale === "zh" ? c.label_cn : c.label_en}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      <input
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        name={name}
        value={digits}
        onChange={(e) => pushDigits(e.target.value)}
        placeholder={placeholder ?? "8888 8888"}
        className={`${fieldCls} ${
          error ? "border-[var(--cinnabar)]" : "border-[var(--paper-shadow)]"
        }`}
      />
    </div>
  );
}

// Paragraph-above-checkbox block for agreements. The terms copy is whatever
// the admin wrote in the builder (EN + CN both shown, stacked); the checkbox
// itself carries a fixed bilingual "我已阅读并同意 / I hereby acknowledge…"
// label so participants know exactly what they're consenting to.
export function AcknowledgementBlock({
  labelEn,
  labelCn,
  hintEn,
  hintCn,
  locale,
  required,
  error,
  checked,
  onChange,
}: {
  labelEn: string;
  labelCn: string;
  hintEn?: string;
  hintCn?: string;
  locale: "zh" | "en";
  required?: boolean;
  error?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  const primaryTerms = locale === "zh" ? labelCn || labelEn : labelEn || labelCn;
  const secondaryTerms =
    labelEn && labelCn && labelEn !== labelCn
      ? locale === "zh"
        ? labelEn
        : labelCn
      : null;
  const primaryHint =
    locale === "zh" ? hintCn || hintEn : hintEn || hintCn;
  const ackLabel = "我已阅读并同意 · I hereby acknowledge to have read and agreed.";

  return (
    <div
      className={
        "rounded-[var(--radius-md)] border bg-[var(--paper-warm)] " +
        (error ? "border-[var(--cinnabar)]" : "border-[var(--paper-shadow)]")
      }
    >
      <div className="px-5 pt-5 pb-4 text-[14px] leading-[1.75] text-[var(--ink-soft)]">
        {primaryTerms ? <p>{primaryTerms}</p> : null}
        {secondaryTerms ? (
          <p className="mt-2 text-[13px] text-[var(--ink-mute)]">
            {secondaryTerms}
          </p>
        ) : null}
        {primaryHint ? (
          <p className="mt-3 text-[12.5px] text-[var(--ink-mute)]">
            {primaryHint}
          </p>
        ) : null}
      </div>
      <label
        className="flex items-start gap-3 px-5 py-4 border-t border-[var(--paper-shadow)]
                   bg-[var(--paper-deep)]/50 cursor-pointer rounded-b-[var(--radius-md)]
                   transition-[background-color] duration-[var(--dur-fast)]
                   hover:bg-[var(--paper-deep)]"
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 accent-[var(--cinnabar)] cursor-pointer"
        />
        <span className="text-[13px] leading-[1.6] text-[var(--ink)]">
          {ackLabel}
          {required ? (
            <span className="ml-1 text-[var(--cinnabar)]">*</span>
          ) : null}
        </span>
      </label>
      {error ? (
        <div className="px-5 pb-3 text-[12px] text-[var(--cinnabar)]">
          {error}
        </div>
      ) : null}
    </div>
  );
}

export function CheckboxGroup({
  name,
  options,
  values,
  onChange,
  error,
}: {
  name: string;
  options: { value: string; label: string }[];
  values: string[];
  onChange: (next: string[]) => void;
  error?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      {options.map((o) => {
        const checked = values.includes(o.value);
        return (
          <label
            key={o.value}
            className={
              "group flex items-start gap-3 px-4 py-3 bg-[var(--paper-warm)] border rounded-[var(--radius-sm)] cursor-pointer " +
              "transition-[border-color,background-color] duration-[var(--dur-fast)] " +
              "hover:border-[var(--ink-mute)] hover:bg-white " +
              (checked
                ? "border-[var(--cinnabar)] bg-[var(--cinnabar-wash)]"
                : error
                  ? "border-[var(--cinnabar)]"
                  : "border-[var(--paper-shadow)]")
            }
          >
            <input
              type="checkbox"
              name={name}
              value={o.value}
              checked={checked}
              onChange={(e) => {
                if (e.target.checked) onChange([...values, o.value]);
                else onChange(values.filter((v) => v !== o.value));
              }}
              className="mt-1 h-4 w-4 shrink-0 accent-[var(--cinnabar)] cursor-pointer"
            />
            <span className="text-[14px] leading-[1.5] text-[var(--ink)]">
              {o.label}
            </span>
          </label>
        );
      })}
    </div>
  );
}

export function RadioGroup({
  name,
  options,
  value,
  onChange,
  error,
}: {
  name: string;
  options: { value: string; label: string }[];
  value: string | undefined;
  onChange: (next: string) => void;
  error?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      {options.map((o) => {
        const selected = value === o.value;
        return (
          <label
            key={o.value}
            className={
              "group flex items-start gap-3 px-4 py-3 bg-[var(--paper-warm)] border rounded-[var(--radius-sm)] cursor-pointer " +
              "transition-[border-color,background-color] duration-[var(--dur-fast)] " +
              "hover:border-[var(--ink-mute)] hover:bg-white " +
              (selected
                ? "border-[var(--cinnabar)] bg-[var(--cinnabar-wash)]"
                : error
                  ? "border-[var(--cinnabar)]"
                  : "border-[var(--paper-shadow)]")
            }
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={selected}
              onChange={() => onChange(o.value)}
              className="mt-1 h-4 w-4 shrink-0 accent-[var(--cinnabar)] cursor-pointer"
            />
            <span className="text-[14px] leading-[1.5] text-[var(--ink)]">
              {o.label}
            </span>
          </label>
        );
      })}
    </div>
  );
}

export function SectionHeaderBlock({
  labelEn,
  labelCn,
  locale,
  hintEn,
  hintCn,
}: {
  labelEn: string;
  labelCn: string;
  locale: "zh" | "en";
  hintEn?: string;
  hintCn?: string;
}) {
  const primary = locale === "zh" ? labelCn || labelEn : labelEn || labelCn;
  const secondary = locale === "zh" ? labelEn : labelCn;
  const hint = locale === "zh" ? hintCn || hintEn : hintEn || hintCn;
  return (
    <div className="mt-4 pt-8 border-t border-[var(--paper-shadow)]">
      <span className="eyebrow">
        {locale === "zh" ? "本节" : "Section"}
      </span>
      <h3 className="mt-3 font-display text-[20px] md:text-[22px] leading-[1.3] text-[var(--ink)]">
        {primary}
      </h3>
      {secondary && secondary !== primary ? (
        <p className="mt-1 text-[14px] text-[var(--ink-mute)]">{secondary}</p>
      ) : null}
      {hint ? (
        <p className="mt-3 text-[13px] leading-[1.7] text-[var(--ink-soft)] max-w-[560px]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
