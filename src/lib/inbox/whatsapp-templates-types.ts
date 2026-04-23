// Client-safe types + pure helpers for the WhatsApp template registry.
// The server-only registry (render + buildComponents) lives in
// `whatsapp-templates.ts`. Keep this file dependency-free so client
// components (MessageComposer, picker) can import it without dragging
// `server-only` through the Turbopack prod bundler boundary.

export type TemplateLanguage = "en_US" | "zh_CN";

export type TemplateParamSpec = {
  key: string;
  label_en: string;
  label_cn: string;
  placeholder_en?: string;
  placeholder_cn?: string;
  type?: "text" | "url" | "amount";
  multiline?: boolean;
};

export type TemplateSummary = {
  name: string;
  category: "utility" | "marketing" | "authentication";
  label_en: string;
  label_cn: string;
  description_en: string;
  description_cn: string;
  languages: readonly TemplateLanguage[];
  params: readonly TemplateParamSpec[];
  /**
   * Raw Meta body text, keyed by language. Contains positional {{1}}, {{2}}
   * placeholders — the composer substitutes params[`variable_N`] client-side
   * so previews update as the admin types.
   */
  body_by_language: Readonly<Partial<Record<TemplateLanguage, string>>>;
};

/** Substitute {{1}}, {{2}} placeholders with variable_1, variable_2, ... values. */
export function renderTemplateBody(
  body: string | null | undefined,
  params: Record<string, string>,
): string {
  if (!body) return "";
  return body.replace(/\{\{(\d+)\}\}/g, (_, n) => {
    const v = params[`variable_${n}`];
    return (v ?? "").trim();
  });
}

// Meta error codes that indicate "pick a template" — used by send.ts to
// classify 24-hour-window failures so the composer can prompt the admin.
export const OUTSIDE_WINDOW_ERROR_CODES = [131047, 131049, 131051] as const;

export function isOutsideWindowError(errorMessage: string | null | undefined): boolean {
  if (!errorMessage) return false;
  if (OUTSIDE_WINDOW_ERROR_CODES.some((c) => errorMessage.includes(String(c)))) {
    return true;
  }
  const lower = errorMessage.toLowerCase();
  return (
    lower.includes("re-engagement") ||
    lower.includes("24 hours") ||
    lower.includes("24-hour") ||
    lower.includes("customer service window")
  );
}
