import type { ReactNode } from "react";

export function Field({
  label,
  labelZh,
  children,
  mono = false,
  multiline = false,
}: {
  label: string;
  labelZh?: string;
  children: ReactNode;
  mono?: boolean;
  multiline?: boolean;
}) {
  return (
    <div className={multiline ? "" : "grid grid-cols-[130px_1fr] gap-4 items-baseline"}>
      <dt
        className={`text-[10px] tracking-[0.2em] uppercase text-[var(--ink-faint)] ${
          multiline ? "mb-2" : ""
        }`}
      >
        {label}
        {labelZh ? (
          <span className="ml-1.5 text-[var(--ink-faint)]/70 normal-case tracking-[0.14em]">
            {labelZh}
          </span>
        ) : null}
      </dt>
      <dd
        className={`text-[var(--ink)] ${
          mono ? "font-mono text-[12.5px]" : "text-[13.5px]"
        } ${multiline ? "leading-[1.75] text-[13.5px]" : ""}`}
      >
        {children}
      </dd>
    </div>
  );
}

export function Empty() {
  return (
    <span className="text-[var(--ink-faint)]" aria-label="Empty">
      —
    </span>
  );
}
