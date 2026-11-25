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

// The categories a tier can apply to: a programme slug (now dynamic — any
// programme created in the admin Programmes table) plus the fixed base
// categories new/returning + a catch-all `default`. The `(string & {})`
// keeps autocomplete for the known literals while allowing any slug.
export type ParticipantPriceCategory =
  | "classic_member"
  | "returning_student"
  | "new_student"
  | "default"
  // eslint-disable-next-line @typescript-eslint/ban-types
  | (string & {});

export type PriceTier = {
  key: string;
  label_en: string;
  label_cn: string;
  amount: number;
  // Optional 复训 (repeat) course fee for people who have taken this course
  // before. null/absent ⇒ repeaters pay `amount` (初训) like everyone.
  repeat_amount?: number | null;
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
  // The course this event is a run of (migration 079). Members whose
  // programme lists it pay the 会务费 only.
  course_id?: string | null;
  // Programme validity is judged on this date (YYYY-MM-DD).
  start_date?: string | null;
  price_tiers?: PriceTier[] | null;
  // Shared misc fee (会务费) everyone pays. A tier's `amount` is the per-tier
  // COURSE FEE on top, so total = misc_fee + matched tier amount.
  misc_fee?: number | string | null;
};

function miscOf(event: EventLike): number {
  const m = Number(event.misc_fee ?? 0);
  return Number.isFinite(m) ? m : 0;
}

export type ParticipantLike = {
  // Programme membership resolved from the programmes FK.
  programme_slug?: string | null;
  // Frozen expiry of the participant's programme membership. Valid up to
  // and including that day; after it the person is 经典永流传.
  // null ⇒ never expires.
  programme_expires_at?: string | null;
  // "Attended before the CRM" tick.
  is_old_student?: boolean | null;
  // Checked in at another event in the CRM (loaded server-side).
  has_attended?: boolean | null;
  // Has taken this event's course before: checked in at an earlier run of
  // it, or it's in their attended-courses record (loaded server-side).
  // Picks a tier's 复训 price when the tier has one.
  has_taken_course?: boolean | null;
  // The evidence, recorded in the price basis for audit.
  taken_course_via?: string | null;
};

/** Why a price was chosen — stored on the enrollment (price_basis). */
export type PriceBasis = {
  v: 1;
  rule: "tier" | "classic_fallback" | "default_tier" | "single_price" | "none" | "override" | "seat";
  /** 名额 only: the seat used and whose it was. */
  seat?: { id: string; holder_id: string; holder_name: string; course_name: string };
  /** Staff override only: who changed it and why. */
  override?: { by: string; reason: string; at: string };
  category: ParticipantPriceCategory;
  programme_slug: string | null;
  valid_until: string | null;
  on_date: string;
  course_id: string | null;
  tier_key: string | null;
  /** True when the tier's 复训 (repeat) price was used. */
  repeat?: boolean;
  /** Why they count as having taken the course, e.g. "checked in at …". */
  repeat_via?: string | null;
  misc_fee: number;
  course_fee: number | null;
  amount: number | null;
};

/** A date as YYYY-MM-DD in Singapore time (events are dated in SGT). */
export function sgDay(d: Date = new Date()): string {
  return new Date(d.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}

/** The day pricing judges validity on: the event's start date, else today. */
export function pricingDay(event: { start_date?: string | null } | null | undefined, now: Date = new Date()): string {
  const s = event?.start_date;
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : sgDay(now);
}

function onDayOf(on: Date | string | undefined): string {
  if (typeof on === "string") return on.slice(0, 10);
  return sgDay(on ?? new Date());
}

/** The last valid day of a programme (SGT), or null if it never expires. */
export function validUntilDay(expiresAt: string | null | undefined): string | null {
  if (!expiresAt) return null;
  // Date-only values are already a day; timestamps convert to SGT.
  if (/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) return expiresAt;
  const t = new Date(expiresAt);
  return Number.isNaN(t.getTime()) ? expiresAt.slice(0, 10) : sgDay(t);
}

type EnrollmentLike = {
  amount_due?: number | string | null;
  price_tier_key?: string | null;
};

/**
 * Which pricing category a participant falls into ON A DATE (the event's
 * start date). First match wins:
 *   1. a programme valid on that day      → the programme's slug
 *   2. a programme that expired before it → "classic_member" (经典永流传;
 *      every programme becomes 经典永流传 when it expires — Ethan 2026-11-25)
 *   3. attended before (tick or CRM check-in) → "returning_student" (老学员)
 *   4. otherwise                          → "new_student" (新人)
 * A programme is valid up to and including its last day.
 */
export function participantPriceCategory(
  p: ParticipantLike | null | undefined,
  on?: Date | string,
): ParticipantPriceCategory {
  const day = onDayOf(on);
  const slug = p?.programme_slug ?? null;
  if (slug) {
    const until = validUntilDay(p?.programme_expires_at);
    return until == null || until >= day ? slug : "classic_member";
  }
  return p?.is_old_student || p?.has_attended ? "returning_student" : "new_student";
}

const BASE_CATEGORIES = new Set(["classic_member", "returning_student", "new_student", "default"]);

/** True when the category is a programme membership (not a base one). */
export function isProgrammeCategory(c: ParticipantPriceCategory): boolean {
  return !BASE_CATEGORIES.has(c);
}

/**
 * Build the resolver input from a `participants` pricing row that embeds the
 * programme slug, e.g.
 *   .select("is_old_student, programme_expires_at, programmes(slug)")
 * Tolerates the embed arriving as an object or a single-element array.
 */
export function pricingParticipantFromRow(
  row:
    | {
        is_old_student?: boolean | null;
        programme_expires_at?: string | null;
        programmes?: { slug: string | null } | { slug: string | null }[] | null;
      }
    | null
    | undefined,
): ParticipantLike | null {
  if (!row) return null;
  const prog = Array.isArray(row.programmes) ? row.programmes[0] : row.programmes;
  return {
    is_old_student: row.is_old_student ?? null,
    programme_expires_at: row.programme_expires_at ?? null,
    programme_slug: prog?.slug ?? null,
    has_attended: null,
  };
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
 * THE price rule. Everything that prices an enrollment goes through here
 * (via resolveEnrollmentPrice on the server), so all paths agree. First
 * match wins (all prices live in the event's tiers — a programme whose
 * members owe no course fee gets a tier row of 0; Ethan 2026-11-25):
 *   1. tier     — the event's tier for their category
 *      (经典永流传 without its own tier falls back to the 老学员 tier)
 *   2. default  — the 其他 / Everyone-else tier
 *   3. single   — misc fee + the event's single course fee
 * A tier's 复训 price applies when they have taken the course before.
 * Returns the amount plus a `basis` snapshot that is stored on the
 * enrollment so the decision can be audited later.
 */
export function resolvePrice(
  event: EventLike,
  participant: ParticipantLike | null | undefined,
  now: Date = new Date(),
): { tier_key: string | null; amount: number | null; basis: PriceBasis } {
  const onDate = pricingDay(event, now);
  const category = participantPriceCategory(participant, onDate);
  const misc = miscOf(event);
  const basis = (
    rule: PriceBasis["rule"],
    tier_key: string | null,
    course_fee: number | null,
    amount: number | null,
  ): PriceBasis => ({
    v: 1,
    rule,
    category,
    programme_slug: participant?.programme_slug ?? null,
    valid_until: validUntilDay(participant?.programme_expires_at),
    on_date: onDate,
    course_id: event.course_id ?? null,
    tier_key,
    misc_fee: misc,
    course_fee,
    amount,
  });

  // 1–2. Tiers.
  const tiers = normalizeTiers(event);
  if (tiers.length > 0) {
    const pick = (c: string) => tiers.find((t) => t.applies_to?.includes(c));
    let rule: PriceBasis["rule"] = "tier";
    let tier = pick(category);
    if (!tier && category === "classic_member") {
      tier = pick("returning_student");
      rule = "classic_fallback";
    }
    if (!tier) {
      tier = pick("default");
      rule = "default_tier";
    }
    if (tier) {
      // 复训 price when the tier has one and they've taken the course before.
      const repeat =
        !!participant?.has_taken_course && tier.repeat_amount != null && Number.isFinite(Number(tier.repeat_amount));
      const fee = repeat ? Number(tier.repeat_amount) : Number(tier.amount);
      return {
        tier_key: tier.key,
        amount: misc + fee,
        basis: {
          ...basis(rule, tier.key, fee, misc + fee),
          repeat,
          ...(repeat ? { repeat_via: participant?.taken_course_via ?? null } : {}),
        },
      };
    }
  }

  // 3. Single price (or nothing priced).
  const price = event.price;
  if (price != null && Number.isFinite(Number(price))) {
    const fee = Number(price);
    return { tier_key: null, amount: misc + fee, basis: basis("single_price", null, fee, misc + fee) };
  }
  return { tier_key: null, amount: null, basis: basis("none", null, null, null) };
}

/**
 * Resolve the tier (and amount) a participant pays for an event.
 * Returns null when no tier (or the 会务费-only rule) applies — the caller
 * then falls back to `event.price` via amountDueFor. Thin wrapper over
 * resolvePrice, kept for existing call sites.
 */
export function resolvePriceTier(
  event: EventLike,
  participant: ParticipantLike | null | undefined,
  now: Date = new Date(),
): { tier_key: string; amount: number } | null {
  const r = resolvePrice(event, participant, now);
  return r.tier_key && r.amount != null ? { tier_key: r.tier_key, amount: r.amount } : null;
}

/** Human label for a category, e.g. "经典永流传 · Classic member". */
export const BASE_CATEGORY_LABEL: Record<string, { cn: string; en: string }> = {
  classic_member: { cn: "经典永流传", en: "Classic member" },
  returning_student: { cn: "老学员", en: "Returning student" },
  new_student: { cn: "新人", en: "New student" },
  default: { cn: "其他", en: "Everyone else" },
};

/** One-line explanation of a basis, for staff. */
export function describeBasis(
  b: PriceBasis,
  programmeName: (slug: string) => string = (s) => s,
  currency = "SGD",
): string {
  const cat = BASE_CATEGORY_LABEL[b.category]?.cn ?? programmeName(b.category);
  const prog = b.programme_slug ? programmeName(b.programme_slug) : null;
  const who =
    b.category === "classic_member" && prog && b.valid_until
      ? `经典永流传 (${prog} expired ${b.valid_until})`
      : prog && b.category === b.programme_slug
        ? `${prog}${b.valid_until ? ` valid to ${b.valid_until}` : ""}`
        : cat;
  const rep = b.repeat ? ` 复训${b.repeat_via ? ` (${b.repeat_via})` : ""}` : "";
  const money = (n: number | null) => (n == null ? "—" : `${currency} ${n.toLocaleString("en-SG", { maximumFractionDigits: 2 })}`);
  switch (b.rule) {
    case "tier":
      return `${who} · tier${rep} → ${money(b.amount)}`;
    case "classic_fallback":
      return `${who} · no 经典永流传 tier, used 老学员 tier${rep} → ${money(b.amount)}`;
    case "default_tier":
      return `${who} · no tier for them, used 其他${rep} → ${money(b.amount)}`;
    case "single_price":
      return `${who} · single price → ${money(b.amount)}`;
    case "seat":
      return `名额 from ${b.seat?.holder_name ?? "a member"} (${b.seat?.course_name ?? "course"}) → 会务费 only ${money(b.amount)}`;
    case "override":
      return `Set by staff → ${money(b.amount)}${b.override?.reason ? ` · “${b.override.reason}”` : ""}`;
    default:
      return `${who} · no price set`;
  }
}

/** What a new enrollment owes: its tier total, else misc fee + single price. */
export function amountDueFor(
  event: EventLike,
  tier: { amount: number } | null,
): number | null {
  if (tier) return tier.amount;
  const price = event.price;
  if (price == null || !Number.isFinite(Number(price))) return null;
  return miscOf(event) + Number(price);
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

/** Lowest total (misc + course) across tiers, for a "from SGD X" display. */
export function lowestTierAmount(event: EventLike): number | null {
  const misc = miscOf(event);
  const amounts = normalizeTiers(event)
    .flatMap((t) => (t.repeat_amount != null ? [Number(t.amount), Number(t.repeat_amount)] : [Number(t.amount)]))
    .filter((n) => Number.isFinite(n) && n >= 0)
    .map((n) => misc + n);
  return amounts.length ? Math.min(...amounts) : null;
}
