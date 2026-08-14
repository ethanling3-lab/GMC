// Model → price. The table that made cost invisible by not existing.
//
// `ai_runs` has recorded input/output/cache token counts since migration 014,
// and the cost of a run was still unknowable, because nothing anywhere mapped a
// model id to a number. Five separate `new Anthropic()` call sites across this
// codebase, three different models, no shared module — so "what is the AI
// costing us" had no answer short of exporting tokens and doing arithmetic by
// hand against the pricing page.
//
// Prices are USD per million tokens, from Anthropic's published rates
// (checked 2026-08-13). Verify against the pricing page before editing — a
// wrong number here silently mis-enforces the daily spend cap in whichever
// direction it is wrong.

export type AiModelId =
  | "claude-opus-4-7"
  | "claude-opus-5"
  | "claude-sonnet-5"
  | "claude-sonnet-4-6"
  | "claude-haiku-4-5";

type ModelPrice = {
  /** USD per 1M input tokens. */
  inPerMTok: number;
  /** USD per 1M output tokens. */
  outPerMTok: number;
  /**
   * Optional note carried into the admin UI. Used for time-limited
   * introductory pricing so nobody plans a budget around a rate that expires.
   */
  note?: string;
};

export const MODEL_PRICING: Record<AiModelId, ModelPrice> = {
  "claude-opus-4-7": { inPerMTok: 5.0, outPerMTok: 25.0 },
  "claude-opus-5": { inPerMTok: 5.0, outPerMTok: 25.0 },
  // Introductory pricing runs through 2026-08-31, after which this returns to
  // $3.00 / $15.00. Left at the intro rate deliberately — the cap should
  // reflect what we are actually billed today — but revisit on 2026-09-01,
  // because an under-stated input price makes the cap permissive, not strict.
  "claude-sonnet-5": {
    inPerMTok: 2.0,
    outPerMTok: 10.0,
    note: "Introductory pricing through 2026-08-31; reverts to $3.00/$15.00.",
  },
  "claude-sonnet-4-6": { inPerMTok: 3.0, outPerMTok: 15.0 },
  "claude-haiku-4-5": { inPerMTok: 1.0, outPerMTok: 5.0 },
};

/**
 * Cache multipliers, applied to a model's input price.
 *
 * A cache read is ~0.1× input. A 5-minute cache write is 1.25× input — Tier 1
 * caches its system prompt with `cache_control: {type: "ephemeral"}` and takes
 * the default 5-minute TTL, so that is the multiplier that applies here. If a
 * caller ever switches to `ttl: "1h"`, writes become 2× and this needs a second
 * rate rather than a tweaked constant.
 */
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER_5M = 1.25;

export type RunUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
};

/**
 * Cost of one run, in cents.
 *
 * Returns null for a model with no entry above rather than guessing. A null
 * propagates to `ai_runs.cost_cents`, which the spend cap treats as unknown
 * rather than free — see the note in limits.ts. Silently pricing an unknown
 * model at zero is how a cap stops capping.
 */
export function estimateRunCostCents(
  model: string,
  usage: RunUsage,
): number | null {
  const price = MODEL_PRICING[model as AiModelId];
  if (!price) return null;

  const perToken = (usd: number) => usd / 1_000_000;

  // Anthropic reports cached-read tokens separately from `input_tokens`, so
  // these are added, not subtracted — double-counting here would overstate
  // cost and trip the cap early.
  const dollars =
    usage.inputTokens * perToken(price.inPerMTok) +
    usage.outputTokens * perToken(price.outPerMTok) +
    (usage.cacheReadTokens ?? 0) * perToken(price.inPerMTok * CACHE_READ_MULTIPLIER) +
    (usage.cacheCreationTokens ?? 0) *
      perToken(price.inPerMTok * CACHE_WRITE_MULTIPLIER_5M);

  // Four decimal places matches ai_runs.cost_cents numeric(10,4). A single
  // Tier 1 reply lands around 0.5–3 cents, so rounding to whole cents would
  // quantise most runs to zero and the cap would never move.
  return Math.round(dollars * 100 * 10_000) / 10_000;
}

/** Human-readable price line for the admin UI. */
export function describeModelPrice(model: string): string | null {
  const price = MODEL_PRICING[model as AiModelId];
  if (!price) return null;
  const base = `$${price.inPerMTok.toFixed(2)} in / $${price.outPerMTok.toFixed(2)} out per 1M tokens`;
  return price.note ? `${base} — ${price.note}` : base;
}
