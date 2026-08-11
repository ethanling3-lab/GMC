// Client-safe types + pure helpers for the WhatsApp template registry.
// The server-only registry (render + buildComponents) lives in
// `whatsapp-templates.ts`. Keep this file dependency-free so client
// components (MessageComposer, picker) can import it without dragging
// `server-only` through the Turbopack prod bundler boundary.

// The INTERNAL key for a template's language. Two values, because GMC writes
// every template in exactly two languages, and because `broadcasts.
// whatsapp_template_language` stores this on disk — changing the union would
// need a data migration.
//
// It is NOT what Meta calls the language, and must never be sent to Meta.
// See metaLanguageFor() below.
export type TemplateLanguage = "en_US" | "zh_CN";

/**
 * Fallback Meta language codes, used ONLY when the synced registry can't tell
 * us what Meta actually approved.
 *
 * `en_US` → `en` is deliberate and load-bearing: every `gmc_*` template on
 * GMC's WABA is approved as plain `en`, and Meta matches language codes
 * exactly. Sending `en_US` against an `en` template fails with 132001, which
 * is what made 100% of English sends silently fail before this existed.
 */
export const FALLBACK_META_LANGUAGE: Readonly<Record<TemplateLanguage, string>> = {
  en_US: "en",
  zh_CN: "zh_CN",
};

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
  /**
   * Meta's OWN language string for each slot, exactly as returned by
   * `GET /{waba}/message_templates` — `"en"`, `"en_US"`, `"zh_CN"`, …
   *
   * `languages` above folds variants together so the UI has one toggle per
   * language. That folding is lossy, and the send path used to hand the folded
   * value back to Meta as if it were Meta's own. This is the unfolded truth,
   * and it is the only value that may go on the wire.
   */
  meta_language_by_language: Readonly<Partial<Record<TemplateLanguage, string>>>;
};

/**
 * The language string to put on the wire for a given template + internal key.
 *
 * Prefers what Meta told us at sync time; falls back to FALLBACK_META_LANGUAGE
 * when the registry is empty (not configured, Meta unreachable, cold start).
 */
export function metaLanguageFor(
  summary: Pick<TemplateSummary, "meta_language_by_language"> | null | undefined,
  language: TemplateLanguage,
): string {
  return (
    summary?.meta_language_by_language?.[language] ??
    FALLBACK_META_LANGUAGE[language]
  );
}

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

// Meta send-failure classification.
//
// These three used to be lumped together as "outside window", which told
// the composer to prompt for a template. Only one of them actually means
// that; the other two are marketing-policy failures where sending a
// template is either pointless or actively wrong. Verified against
// Meta's Cloud API error-code reference:
//
//   131047 — "More than 24 hours have passed since the recipient last
//            replied." The genuine re-engagement window. Fix: template.
//   131049 — "This message was not delivered to maintain healthy
//            ecosystem engagement." Per-user marketing frequency cap.
//            A template will NOT fix it; retrying wastes quality score.
//   131050 — Recipient has opted out of marketing from this business.
//            Authoritative: treat as a consent revocation, never retry.
//   131051 — Unsupported message type. A payload bug, not a policy one.
export const OUTSIDE_WINDOW_ERROR_CODES = [131047] as const;
export const MARKETING_FREQUENCY_CAP_ERROR_CODES = [131049] as const;
export const MARKETING_OPT_OUT_ERROR_CODES = [131050] as const;
export const UNSUPPORTED_MESSAGE_ERROR_CODES = [131051] as const;

function hasCode(
  errorMessage: string | null | undefined,
  codes: readonly number[],
): boolean {
  if (!errorMessage) return false;
  return codes.some((c) => errorMessage.includes(String(c)));
}

export function isOutsideWindowError(errorMessage: string | null | undefined): boolean {
  if (!errorMessage) return false;
  // A frequency-cap or opt-out failure must never be reported as a window
  // problem — the phrase match below is loose enough to catch them
  // otherwise, and the composer would tell the admin to send a template
  // that is guaranteed to fail again.
  if (
    hasCode(errorMessage, MARKETING_FREQUENCY_CAP_ERROR_CODES)
    || hasCode(errorMessage, MARKETING_OPT_OUT_ERROR_CODES)
  ) {
    return false;
  }
  if (hasCode(errorMessage, OUTSIDE_WINDOW_ERROR_CODES)) return true;
  const lower = errorMessage.toLowerCase();
  return (
    lower.includes("re-engagement") ||
    lower.includes("24 hours") ||
    lower.includes("24-hour") ||
    lower.includes("customer service window")
  );
}

// Recipient has opted out of marketing. Phase 2 turns this into a
// consent revocation; until then it at least stops being mislabelled.
export function isMarketingOptOutError(
  errorMessage: string | null | undefined,
): boolean {
  return hasCode(errorMessage, MARKETING_OPT_OUT_ERROR_CODES);
}

// Meta's per-user marketing frequency cap. Retrying is counterproductive.
export function isMarketingFrequencyCapError(
  errorMessage: string | null | undefined,
): boolean {
  return hasCode(errorMessage, MARKETING_FREQUENCY_CAP_ERROR_CODES);
}
