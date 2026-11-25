"use client";

import {
  CLASS_LANGUAGES,
  languageLabel,
} from "@/lib/participants/languages";

// Class-language controls (migration 074). Choices come from
// CLASS_LANGUAGES — add a code there to offer a new language.

export const LISTENING_LANGUAGE_OPTIONS = CLASS_LANGUAGES.map((code) => ({
  value: code,
  label: `${languageLabel(code).native} · ${languageLabel(code).en}`,
}));

// Multi-select chips for "Speaks · 会说". Keeps the order of
// CLASS_LANGUAGES so saved arrays are stable.
export function SpokenLanguagesPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const toggle = (code: string) => {
    const has = value.includes(code);
    const next = has ? value.filter((c) => c !== code) : [...value, code];
    onChange(CLASS_LANGUAGES.filter((c) => next.includes(c)).concat(
      next.filter((c) => !CLASS_LANGUAGES.includes(c)),
    ));
  };
  return (
    <div className="flex flex-wrap gap-2">
      {CLASS_LANGUAGES.map((code) => {
        const on = value.includes(code);
        return (
          <button
            key={code}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(code)}
            className={`inline-flex items-center h-9 px-3 rounded-[var(--radius-md)] border text-[13px] focus-visible:shadow-[var(--shadow-focus)] active:scale-[0.98] transition-[background-color,border-color,color,transform] duration-[var(--dur-fast)] ${
              on
                ? "border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
                : "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-mute)] hover:border-[var(--cinnabar)]/30"
            }`}
          >
            {languageLabel(code).native}
          </button>
        );
      })}
    </div>
  );
}
