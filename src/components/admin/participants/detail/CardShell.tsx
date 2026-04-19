"use client";

import type { ReactNode } from "react";

type Props = {
  eyebrow: string;
  eyebrowZh?: string;
  title: string;
  editing: boolean;
  saving?: boolean;
  error?: string | null;
  editable?: boolean;
  onEdit?: () => void;
  onCancel?: () => void;
  onSave?: () => void;
  children: ReactNode;
};

export function CardShell({
  eyebrow,
  eyebrowZh,
  title,
  editing,
  saving = false,
  error = null,
  editable = true,
  onEdit,
  onCancel,
  onSave,
  children,
}: Props) {
  return (
    <section className="relative rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)] p-7">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
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
        </div>

        {editable ? (
          <div className="flex items-center gap-2">
            {editing ? (
              <>
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={saving}
                  className="inline-flex items-center h-8 px-3 rounded-[var(--radius-pill)]
                             text-[11.5px] tracking-[0.04em] text-[var(--ink-mute)]
                             hover:text-[var(--ink)] hover:bg-[var(--paper-deep)]
                             disabled:opacity-50
                             transition-[background-color,color] duration-[var(--dur-fast)]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={onSave}
                  disabled={saving}
                  className={`inline-flex items-center gap-1.5 h-8 px-3.5 rounded-[var(--radius-pill)]
                              text-[11.5px] tracking-[0.04em] font-medium
                              transition-[background-color,color,transform] duration-[var(--dur-fast)]
                              focus-visible:shadow-[var(--shadow-focus)]
                              ${
                                saving
                                  ? "bg-[var(--paper-deep)] text-[var(--ink-faint)] cursor-not-allowed"
                                  : "bg-[var(--cinnabar)] text-[var(--paper-warm)] hover:bg-[var(--cinnabar-deep)] shadow-[0_3px_10px_rgba(37,99,235,0.22)] active:scale-[0.98]"
                              }`}
                >
                  {saving ? (
                    <>
                      <Spinner />
                      Saving
                    </>
                  ) : (
                    "Save"
                  )}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={onEdit}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-pill)]
                           border border-[var(--paper-shadow)] bg-[var(--paper)]
                           text-[11.5px] tracking-[0.04em] text-[var(--ink-soft)]
                           hover:border-[var(--cinnabar)]/40 hover:bg-[var(--cinnabar-wash)] hover:text-[var(--cinnabar-deep)]
                           focus-visible:shadow-[var(--shadow-focus)]
                           transition-[background-color,border-color,color] duration-[var(--dur-fast)]"
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M8.5 2l1.5 1.5L4 9.5H2.5V8L8.5 2z" />
                </svg>
                Edit
              </button>
            )}
          </div>
        ) : null}
      </div>

      <div className="mt-6">{children}</div>

      {error ? (
        <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--cinnabar)]/30 bg-[var(--cinnabar-wash)] px-3.5 py-2 text-[12.5px] leading-[1.6] text-[var(--cinnabar-deep)]">
          {error}
        </div>
      ) : null}
    </section>
  );
}

export function Spinner() {
  return (
    <svg
      width="12"
      height="12"
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
