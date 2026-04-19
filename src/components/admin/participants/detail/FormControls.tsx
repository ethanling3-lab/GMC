"use client";

import type { ReactNode } from "react";

export function LabelRow({
  label,
  labelZh,
  children,
}: {
  label: string;
  labelZh?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10px] tracking-[0.2em] uppercase text-[var(--ink-faint)]">
        {label}
        {labelZh ? (
          <span className="ml-1.5 text-[var(--ink-faint)]/70 normal-case tracking-[0.14em]">
            {labelZh}
          </span>
        ) : null}
      </span>
      {children}
    </label>
  );
}

const INPUT_BASE =
  "h-9 w-full px-3 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[13px] text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--cinnabar)]/50 focus:outline-none focus:shadow-[var(--shadow-focus)] transition-[border-color,box-shadow] duration-[var(--dur-fast)]";

export function TextInput({
  value,
  onChange,
  type = "text",
  placeholder,
  mono = false,
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  type?: "text" | "email" | "tel" | "date";
  placeholder?: string;
  mono?: boolean;
  disabled?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className={`${INPUT_BASE} ${mono ? "font-mono text-[12px]" : ""} disabled:opacity-60`}
    />
  );
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  placeholder,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  placeholder?: string;
}) {
  return (
    <input
      type="number"
      value={value ?? ""}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === "") return onChange(null);
        const n = parseInt(raw, 10);
        if (Number.isNaN(n)) return;
        onChange(n);
      }}
      min={min}
      max={max}
      placeholder={placeholder}
      className={`${INPUT_BASE} tabular-nums`}
    />
  );
}

export function Textarea({
  value,
  onChange,
  rows = 4,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      placeholder={placeholder}
      className="w-full resize-y px-3 py-2.5 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[13px] leading-[1.7] text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--cinnabar)]/50 focus:outline-none focus:shadow-[var(--shadow-focus)] transition-[border-color,box-shadow] duration-[var(--dur-fast)]"
    />
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  placeholder = "—",
}: {
  value: T | null;
  onChange: (v: T | null) => void;
  options: readonly { value: T; label: string }[];
  placeholder?: string;
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === "" ? null : (v as T));
      }}
      className={INPUT_BASE}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({
  value,
  onChange,
  labels = { on: "Yes · 是", off: "No · 否" },
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  labels?: { on: string; off: string };
}) {
  return (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={`relative inline-flex items-center h-6 w-11 rounded-full transition-[background-color] duration-[var(--dur-fast)]
                    focus-visible:shadow-[var(--shadow-focus)]
                    ${value ? "bg-[var(--cinnabar)]" : "bg-[var(--paper-shadow)]"}`}
      >
        <span
          className={`inline-block w-4 h-4 rounded-full bg-white shadow-[0_1px_3px_rgba(11,41,84,0.25)] transition-transform duration-[var(--dur-fast)] ease-[var(--ease-out)] ${
            value ? "translate-x-[22px]" : "translate-x-[4px]"
          }`}
          aria-hidden="true"
        />
      </button>
      <span className="text-[12.5px] text-[var(--ink-soft)]">
        {value ? labels.on : labels.off}
      </span>
    </div>
  );
}
