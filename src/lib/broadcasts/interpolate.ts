import "server-only";
import { createPaymentAccessToken } from "@/lib/tokens";
import { participantEmailLocale } from "@/lib/i18n";
import type { InterpolationToken } from "./types";

// Token resolver — substitutes `${...}` placeholders against a
// (participant, event, enrollment) triple. Whitelist-only: any token
// not in InterpolationToken is left as the literal `${...}` so the
// composer's preview pane surfaces typos before the send fires.
//
// Used twice per broadcast: (1) when materialising WhatsApp template
// params at send-time — each template-slot value is interpolated then
// passed as the {{N}} variable; (2) when materialising the email
// subject + body for that recipient.

export type InterpolationContext = {
  participant: {
    name_cn: string | null;
    name_en: string | null;
    region_id: string | null;
    language_fluency: "en" | "cn" | "both" | null;
  };
  event: {
    title_en: string | null;
    title_cn: string | null;
    start_date: string | null;
    end_date: string | null;
    venue: string | null;
    main_venue_hotel_name: string | null;
    price: number | string | null;
  } | null;
  enrollment: {
    id: string;
  } | null;
};

const PAYMENT_LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — matches caller intent in tokens.ts:88

export function interpolate(template: string, ctx: InterpolationContext): string {
  if (!template) return "";
  const locale = participantEmailLocale({ language_fluency: ctx.participant.language_fluency });
  return template.replace(/\$\{[a-zA-Z0-9_.]+\}/g, (match) => {
    const value = resolveToken(match as InterpolationToken, ctx, locale);
    return value ?? match; // unresolved → preserve literal for visibility
  });
}

function resolveToken(
  token: InterpolationToken | string,
  ctx: InterpolationContext,
  locale: "en" | "zh",
): string | null {
  switch (token) {
    case "${name}":
      // Recipient-locale name. zh wants CN-first, en wants EN-first.
      // Falls back to the other if missing.
      return locale === "zh"
        ? ctx.participant.name_cn ?? ctx.participant.name_en ?? null
        : ctx.participant.name_en ?? ctx.participant.name_cn ?? null;
    case "${name_cn}":
      return ctx.participant.name_cn;
    case "${name_en}":
      return ctx.participant.name_en;
    case "${region_id}":
      return ctx.participant.region_id;
    case "${event.title}":
      if (!ctx.event) return null;
      return locale === "zh"
        ? ctx.event.title_cn ?? ctx.event.title_en ?? null
        : ctx.event.title_en ?? ctx.event.title_cn ?? null;
    case "${event.title_en}":
      return ctx.event?.title_en ?? null;
    case "${event.title_cn}":
      return ctx.event?.title_cn ?? null;
    case "${event.start_date}":
      return ctx.event?.start_date ?? null;
    case "${event.end_date}":
      return ctx.event?.end_date ?? null;
    case "${event.venue}":
      return ctx.event?.venue ?? null;
    case "${event.main_venue_hotel_name}":
      return ctx.event?.main_venue_hotel_name ?? null;
    case "${amount_due}": {
      const p = ctx.event?.price;
      if (p === null || p === undefined) return null;
      const n = typeof p === "string" ? Number(p) : p;
      if (!Number.isFinite(n)) return null;
      return n.toFixed(2);
    }
    case "${payment_link}": {
      if (!ctx.enrollment) return null;
      const base = process.env.NEXT_PUBLIC_SITE_URL ?? "";
      const tok = createPaymentAccessToken(ctx.enrollment.id, PAYMENT_LINK_TTL_MS);
      return `${base}/pay/${tok}`;
    }
    default:
      return null;
  }
}

// Used by the API preview route + the composer's preview pane. Returns
// the rendered string AND the list of any tokens that couldn't resolve
// (so the UI can flag them).
export function interpolateWithDiagnostics(
  template: string,
  ctx: InterpolationContext,
): { rendered: string; unresolved: string[] } {
  const unresolved: string[] = [];
  const locale = participantEmailLocale({ language_fluency: ctx.participant.language_fluency });
  const rendered = template.replace(/\$\{[a-zA-Z0-9_.]+\}/g, (match) => {
    const value = resolveToken(match as InterpolationToken, ctx, locale);
    if (value === null || value === undefined) {
      unresolved.push(match);
      return match;
    }
    return value;
  });
  return { rendered, unresolved };
}

// Substitute interpolation tokens inside a template-params dict (used by
// the WhatsApp template send). The composer stores params as
// {variable_1: "Hi ${name_cn}", variable_2: "${event.title}"} — at send
// time each value gets its own interpolate() pass before being handed
// to findTemplate().render().
export function interpolateTemplateParams(
  params: Record<string, string> | null | undefined,
  ctx: InterpolationContext,
): Record<string, string> {
  if (!params) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    out[key] = interpolate(value, ctx);
  }
  return out;
}
