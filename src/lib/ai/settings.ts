import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase";

// Runtime AI controls (migration 055). Read before every Tier 1 run.
//
// MEMOISATION IS DELIBERATELY SHORT AND EXPLICITLY FLUSHABLE.
//
// A kill switch that takes five minutes to take effect is not a kill switch.
// The cache exists only to stop a per-message settings SELECT, so the window is
// 20 seconds — short enough that "I flipped it off" and "it is off" are the
// same sentence in practice — and the admin write path calls flushAiSettings()
// so the change lands immediately on the process that served the write.
//
// Netlify runs multiple instances, so a flush is not global. 20 seconds is the
// real worst case on any other instance, and that is the number to quote to an
// admin — not "instant".

export type AiSettings = {
  aiEnabled: boolean;
  dailyCostCapCents: number | null;
  maxRepliesPerConversationHour: number;
  maxRepliesPerConversationDay: number;
  modelTier1: string | null;
};

const CACHE_TTL_MS = 20_000;

type CacheEntry = { value: AiSettings; expiresAt: number };
const cache = new Map<string, CacheEntry>();

/** Drop memoised settings. Call after any write. */
export function flushAiSettings(): void {
  cache.clear();
}

/**
 * Resolve effective settings for a region.
 *
 * Global AND region: if either scope has `ai_enabled = false`, the AI is off.
 * A regional row can only ever restrict, never re-enable — so the global switch
 * is always sufficient, and nobody has to go hunting for a forgotten regional
 * override at the moment they most need the AI to stop.
 *
 * Numeric limits take the *lower* of the two for the same reason.
 *
 * FAILS CLOSED. If the settings row cannot be read, the AI does not run. The
 * alternative — treating a database blip as permission to keep spending — is
 * exactly the failure this table exists to prevent.
 */
export async function getAiSettings(region?: string | null): Promise<AiSettings> {
  const key = region ?? "__global__";
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from("ai_settings")
    .select(
      "scope, region, ai_enabled, daily_cost_cap_cents, max_replies_per_conversation_hour, max_replies_per_conversation_day, model_tier1",
    )
    .or(region ? `scope.eq.global,region.eq.${region}` : "scope.eq.global");

  if (error) {
    console.warn("[ai] settings read failed, failing closed: %s", error.message);
    return DISABLED;
  }

  const rows = (data ?? []) as Array<{
    scope: string;
    region: string | null;
    ai_enabled: boolean;
    daily_cost_cap_cents: number | null;
    max_replies_per_conversation_hour: number;
    max_replies_per_conversation_day: number;
    model_tier1: string | null;
  }>;

  const global = rows.find((r) => r.scope === "global");
  if (!global) {
    // 055 seeds this row. Its absence means the migration has not run here, and
    // running the AI against a database whose controls do not exist is the
    // thing we are refusing to do.
    console.warn("[ai] no global ai_settings row; failing closed");
    return DISABLED;
  }

  const regional = region ? rows.find((r) => r.scope === "region" && r.region === region) : undefined;

  const value: AiSettings = {
    aiEnabled: global.ai_enabled && (regional?.ai_enabled ?? true),
    dailyCostCapCents: lowerOf(global.daily_cost_cap_cents, regional?.daily_cost_cap_cents ?? null),
    maxRepliesPerConversationHour: Math.min(
      global.max_replies_per_conversation_hour,
      regional?.max_replies_per_conversation_hour ?? Number.MAX_SAFE_INTEGER,
    ),
    maxRepliesPerConversationDay: Math.min(
      global.max_replies_per_conversation_day,
      regional?.max_replies_per_conversation_day ?? Number.MAX_SAFE_INTEGER,
    ),
    modelTier1: regional?.model_tier1 ?? global.model_tier1 ?? null,
  };

  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

const DISABLED: AiSettings = {
  aiEnabled: false,
  dailyCostCapCents: 0,
  maxRepliesPerConversationHour: 0,
  maxRepliesPerConversationDay: 0,
  modelTier1: null,
};

/** Null means "no cap"; a real cap always wins over no cap. */
function lowerOf(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}
