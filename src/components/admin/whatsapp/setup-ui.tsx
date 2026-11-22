"use client";

// Shared pieces of the WhatsApp setup page.

export const rowShell =
  "rounded-[14px] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)]";

export const setupBtn =
  "shrink-0 inline-flex items-center justify-center h-10 min-w-[116px] px-5 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] text-[13px] font-medium text-[var(--paper-warm)] whitespace-nowrap hover:bg-[var(--cinnabar-deep)] active:translate-y-px focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] disabled:opacity-50 transition-[background-color,transform] duration-[var(--dur-fast)]";

export const quietBtn =
  "inline-flex items-center justify-center h-9 px-4 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] text-[12.5px] text-[var(--ink-soft)] hover:bg-[var(--paper-deep)] active:translate-y-px focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] disabled:opacity-50 transition-[background-color,transform] duration-[var(--dur-fast)]";

export const fieldClass =
  "mt-1.5 w-full rounded-[10px] border border-[var(--paper-shadow)] bg-[var(--paper)] px-3.5 py-2.5 text-[14px] leading-[1.6] text-[var(--ink)] focus-visible:outline-none focus-visible:border-[var(--cinnabar)]/50 focus-visible:shadow-[var(--shadow-focus)] disabled:opacity-70";

export function Row({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-5 py-4">
      <div className="min-w-[200px] flex-1">
        <h2 className="text-[15.5px] font-medium leading-snug text-[var(--ink)]">{title}</h2>
        <p className="mt-0.5 text-[12.5px] leading-[1.55] text-[var(--ink-mute)]">{detail}</p>
      </div>
      {children}
    </div>
  );
}

export function Switch({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[14px] font-medium text-[var(--ink)]">{label}</span>
      <button
        type="button"
        role="switch"
        aria-label={label}
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative shrink-0 w-11 h-6 rounded-full focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] disabled:opacity-50 transition-[background-color] duration-[var(--dur-fast)] ${
          checked ? "bg-[var(--cinnabar)]" : "bg-[var(--paper-shadow)]"
        }`}
      >
        <span
          className={`absolute top-[3px] left-[3px] w-[18px] h-[18px] rounded-full bg-[var(--paper)] transition-transform duration-[var(--dur-fast)] ${
            checked ? "translate-x-5" : ""
          }`}
        />
      </button>
    </div>
  );
}

export function SaveNote({ note }: { note: { ok: boolean; text: string } | null }) {
  if (!note) return null;
  return (
    <span
      role={note.ok ? "status" : "alert"}
      className={`text-[12.5px] ${note.ok ? "text-[var(--ink-soft)]" : "text-[#B91C1C]"}`}
    >
      {note.text}
    </span>
  );
}
