"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useLocale } from "@/lib/locale-client";
import { LOCALE_COOKIE } from "@/lib/locale-cookie";

export function LanguageToggle({ className = "" }: { className?: string }) {
  const { locale, t } = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const next = locale === "zh" ? "en" : "zh";

  function toggle() {
    // 1 year; path=/ so every route sees it
    document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`;
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-label="Toggle language"
      className={`inline-flex items-center gap-2 px-3 h-9 text-[11px] font-semibold tracking-[0.22em] uppercase
                  text-[var(--ink-soft)] hover:text-[var(--cinnabar)]
                  border-b border-[var(--paper-shadow)] hover:border-[var(--cinnabar)]
                  transition-[color,border-color,transform] duration-[var(--dur-fast)] ease-[var(--ease-out)]
                  active:translate-y-[1px] disabled:opacity-50 ${className}`}
    >
      <span aria-hidden="true" className="w-3 h-px bg-current" />
      {t("locale.switchTo")}
    </button>
  );
}
