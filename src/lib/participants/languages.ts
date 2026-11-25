// Class languages (migration 074). Client-safe: no server-only imports.
//
//   listening_language — the language a participant listens to the class
//                        in. Grouping rule 1 (HARD): whoever listens in a
//                        language is grouped with others who do, under a
//                        组长 who speaks it.
//   spoken_languages   — languages they can speak. For 组长 it decides
//                        which language groups they can lead.
//
// Universal: the engine never names a language except DEFAULT_LANGUAGE
// (中文, the main class language, whose groups split by type). To offer a
// new language, add its code to CLASS_LANGUAGES (and a label below) — no
// migration needed.
//
// Not the same as participants.language_fluency (cn / en / both), which is
// the COMMUNICATION language for emails / WhatsApp / inbox.

export const DEFAULT_LANGUAGE = "zh";

// The choices offered in the pickers. Order = display order.
export const CLASS_LANGUAGES: readonly string[] = ["zh", "en", "vi"];

export type ClassLanguage = string;

const LABELS: Record<string, { en: string; cn: string; native: string; short: string }> = {
  zh: { en: "Chinese", cn: "中文", native: "中文", short: "中" },
  en: { en: "English", cn: "英文", native: "English", short: "EN" },
  vi: { en: "Vietnamese", cn: "越南语", native: "Tiếng Việt", short: "VI" },
  ms: { en: "Malay", cn: "马来语", native: "Bahasa Melayu", short: "MS" },
  th: { en: "Thai", cn: "泰语", native: "ภาษาไทย", short: "TH" },
  id: { en: "Indonesian", cn: "印尼语", native: "Bahasa Indonesia", short: "ID" },
  ja: { en: "Japanese", cn: "日语", native: "日本語", short: "JA" },
  ko: { en: "Korean", cn: "韩语", native: "한국어", short: "KO" },
};

/** Labels for any language code; unknown codes fall back to the code. */
export function languageLabel(code: string): { en: string; cn: string; native: string; short: string } {
  const up = code.toUpperCase();
  return LABELS[code] ?? { en: up, cn: up, native: up, short: up };
}

export function isLanguageCode(v: unknown): v is string {
  return typeof v === "string" && /^[a-z]{2,3}$/.test(v);
}

/** Languages someone speaks; an empty list means the default (中文). */
export function speaks(spoken: readonly string[] | null | undefined, lang: string): boolean {
  const list = spoken && spoken.length > 0 ? spoken : [DEFAULT_LANGUAGE];
  return list.includes(lang);
}

/**
 * The messaging language (participants.language_fluency: cn / en / both)
 * that emails, WhatsApp and the inbox use. Staff no longer edit it — it
 * follows the class languages: speaks 中文 + English → both; listens in
 * English, or speaks English but not 中文 → en; otherwise cn.
 */
export function contactLanguageFor(
  listening: string | null | undefined,
  spoken: readonly string[] | null | undefined,
): "cn" | "en" | "both" {
  const zh = speaks(spoken, "zh") || listening === "zh";
  const en = speaks(spoken, "en") || listening === "en";
  if (zh && en) return listening === "en" ? "en" : "both";
  if (en && !zh) return "en";
  return "cn";
}

/** "中文 · English" for display. */
export function spokenLabel(spoken: readonly string[] | null | undefined): string {
  return (spoken ?? []).map((l) => languageLabel(l).native).join(" · ");
}
