import zh from "@/i18n/zh.json";
import en from "@/i18n/en.json";
import type { Locale } from "@/lib/types";

export const DICTS = { zh, en } as const;
export type Dict = typeof zh;

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALES: Locale[] = ["en", "zh"];

export function getDict(locale: Locale): Dict {
  return (DICTS[locale] ?? DICTS[DEFAULT_LOCALE]) as Dict;
}

// `t` looks up a dotted path in the dictionary. Missing keys return the key itself —
// that surfaces translation gaps during QA instead of failing silently.
export function t(
  dict: Dict,
  path: string,
  fallback?: string,
): string {
  const parts = path.split(".");
  let cur: unknown = dict;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return fallback ?? path;
    }
  }
  return typeof cur === "string" ? cur : (fallback ?? path);
}

// Resolve locale from `?lang=` query or a cookie, falling back to default.
// Next.js server components pass searchParams; client components use a context.
export function resolveLocale(
  raw: string | string[] | undefined | null,
): Locale {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === "en" || v === "zh") return v;
  return DEFAULT_LOCALE;
}
