// Tiered pricing — resolve which price a participant pays for an event.
//
// Pure types + helpers, no `server-only`, safe to import from client
// components (the admin editor) and server routes alike.
//
// Model: an event carries an ordered list of `PriceTier` rows. Each row
// is tagged with the participant categories it `applies_to`. At checkout
// we map the participant's record to a category, find the matching tier,
// and persist the resolved amount on the enrollment. Empty `price_tiers`
// ⇒ single-price mode (callers fall back to `event.price`).

import { PROGRAMME_TIER_LABEL, type ProgrammeTier } from "@/lib/grouping/types";

// The categories a tier can apply to: the 4 programme tiers + new/
// returning + a catch-all `default`.
export type ParticipantPriceCategory =
  | ProgrammeTier
  | "returning_student"
  | "new_student"
  | "default";

export const PARTICIPANT_PRICE_CATEGORIES: ParticipantPriceCategory[] = [
  "abundance",
  "glorious_family",
  "elite_cultural_heritage",
  "glorious_cultural_heritage",
  "returning_student",
  "new_student",
  "default",
];

export const PRICE_CATEGORY_LABEL: Record<
  ParticipantPriceCategory,
  { en: string; cn: string }
> = {
  abundance: { en: PROGRAMME_TIER_LABEL.abundance.en, cn: PROGRAMME_TIER_LABEL.abundance.cn },
  glorious_family: {
    en: PROGRAMME_TIER_LABEL.glorious_family.en,
    cn: PROGRAMME_TIER_LABEL.glorious_family.cn,
  },
  elite_cultural_heritage: {
    en: PROGRAMME_TIER_LABEL.elite_cultural_heritage.en,
    cn: PROGRAMME_TIER_LABEL.elite_cultural_heritage.cn,
  },
  glorious_cultural_heritage: {
    en: PROGRAMME_TIER_LABEL.glorious_cultural_heritage.en,
    cn: PROGRAMME_TIER_LABEL.glorious_cultural_heritage.cn,
  },
  returning_student: { en: "Returning student", cn: "老学员" },
  new_student: { en: "New student", cn: "新人" },
  default: { en: "Everyone else", cn: "其他" },
};

export type PriceTier = {
  key: string;
  label_en: string;
  label_cn: string;
  amount: number;
  applies_to: ParticipantPriceCategory[];
  // Admin-typed name for the tier — used when the "default" (其他/Everyone
  // else) catch-all is selected, since that category has no descriptive
  // label of its own. When set, it overrides the category-derived label.
  custom_label?: string;
};

// Minimal shapes so this works against DB rows or partial objects.
// Note: Postgres `numeric` columns come back as strings via PostgREST, so
// price/amount accept `number | string`.
type EventLike = {
  price?: number | string | null;
  price_tiers?: PriceTier[] | null;
};

type ParticipantLike = {
  programme_tier?: ProgrammeTier | null;
  is_old_student?: boolean | null;
};

type EnrollmentLike = {
  amount_due?: number | string | null;
  price_tier_key?: string | null;
};

/** Which pricing category does this participant fall into. */
export function participantPriceCategory(
  p: ParticipantLike | null | undefined,
): ParticipantPriceCategory {
  if (p?.programme_tier) return p.programme_tier;
  return p?.is_old_student ? "returning_student" : "new_student";
}

function normalizeTiers(event: EventLike): PriceTier[] {
  const tiers = event.price_tiers;
  return Array.isArray(tiers) ? tiers : [];
}

/** True when the event uses tiered pricing (≥1 tier defined). */
export function hasPriceTiers(event: EventLike): boolean {
  return normalizeTiers(event).length > 0;
}

/**
 * Resolve the tier (and amount) a participant pays for an event.
 * Returns null when the event has no tiers OR no tier matches and there
 * is no `default` row — the caller then falls back to `event.price`.
 */
export function resolvePriceTier(
  event: EventLike,
  participant: ParticipantLike | null | undefined,
): { tier_key: string; amount: number } | null {
  const tiers = normalizeTiers(event);
  if (tiers.length === 0) return null;

  const category = participantPriceCategory(participant);
  const direct = tiers.find((t) => t.applies_to?.includes(category));
  const fallback = direct ?? tiers.find((t) => t.applies_to?.includes("default"));
  if (!fallback) return null;
  return { tier_key: fallback.key, amount: Number(fallback.amount) };
}

/** Look up a tier row by key (e.g. to relabel an enrollment). */
export function findTierByKey(
  event: EventLike,
  key: string | null | undefined,
): PriceTier | null {
  if (!key) return null;
  return normalizeTiers(event).find((t) => t.key === key) ?? null;
}

/**
 * The amount an enrollment owes. Prefers the resolved `amount_due`
 * persisted at registration; falls back to the event's single price
 * for legacy/single-price enrollments.
 */
export function enrollmentAmountDue(
  enrollment: EnrollmentLike | null | undefined,
  event: EventLike | null | undefined,
): number {
  const due = enrollment?.amount_due;
  if (due != null && Number.isFinite(Number(due))) return Number(due);
  const price = event?.price;
  return price != null && Number.isFinite(Number(price)) ? Number(price) : 0;
}

/** Lowest tier amount, for a "from SGD X" display on listings. */
export function lowestTierAmount(event: EventLike): number | null {
  const amounts = normalizeTiers(event)
    .map((t) => Number(t.amount))
    .filter((n) => Number.isFinite(n) && n >= 0);
  return amounts.length ? Math.min(...amounts) : null;
}
