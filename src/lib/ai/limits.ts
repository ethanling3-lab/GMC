import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { getAiSettings } from "./settings";

// The gate. Everything that must be true before Tier 1 is allowed to call
// Anthropic, checked in one place so no call path can skip a layer.
//
// A guard that exists but is never reached is the failure mode this codebase
// has already produced four times (see the dead-guards note in project memory),
// so there is exactly one entry point — assertTier1Allowed — and tier1.ts calls
// it before doing anything else.

export type Tier1Block =
  | { allowed: true }
  | { allowed: false; reason: string; detail: string };

const ALLOWED: Tier1Block = { allowed: true };

/**
 * Decide whether a Tier 1 reply may run for this conversation.
 *
 * Checked in cost order — cheapest first, so a killed switch never pays for a
 * spend query, and neither ever pays for an Anthropic call.
 *
 *   1. kill switch      (memoised read, usually no query)
 *   2. daily spend cap  (one aggregate over today's ai_runs)
 *   3. per-conversation rate (one count over this thread's recent replies)
 *
 * Every refusal returns a machine-readable `reason` that tier1.ts writes into
 * ai_runs.result, so "why did the AI go quiet" is answerable from data rather
 * than from someone's memory of what they toggled.
 */
export async function assertTier1Allowed(args: {
  conversationId: string;
  region?: string | null;
}): Promise<Tier1Block> {
  const settings = await getAiSettings(args.region);

  if (!settings.aiEnabled) {
    return {
      allowed: false,
      reason: "killswitch",
      detail: args.region
        ? `AI is disabled globally or for region ${args.region}`
        : "AI is disabled globally",
    };
  }

  const service = createSupabaseServiceClient();

  // --- 2. Daily spend cap --------------------------------------------------
  if (settings.dailyCostCapCents !== null) {
    const spent = await spendTodayCents(service);

    // A null from spendTodayCents means the query failed, not that spend is
    // zero. Fail closed: a cap that stops enforcing precisely when the database
    // is unhappy is worse than no cap, because it is trusted.
    if (spent === null) {
      return {
        allowed: false,
        reason: "cost_cap_unknown",
        detail: "Could not read today's AI spend; refusing to run while the cap is unverifiable",
      };
    }

    if (spent >= settings.dailyCostCapCents) {
      return {
        allowed: false,
        reason: "cost_cap",
        detail: `Daily cap reached: ${(spent / 100).toFixed(2)} of ${(settings.dailyCostCapCents / 100).toFixed(2)} USD`,
      };
    }
  }

  // --- 3. Per-conversation rate -------------------------------------------
  //
  // Counts AI replies already sent on this thread. A human sending forty
  // messages is a busy customer; the AI answering forty times in a day is a
  // loop, and the cheapest place to break a loop is before the model call.
  const now = Date.now();
  const hourAgo = new Date(now - 60 * 60 * 1000).toISOString();
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

  const [hourCount, dayCount] = await Promise.all([
    countAiReplies(service, args.conversationId, hourAgo),
    countAiReplies(service, args.conversationId, dayAgo),
  ]);

  if (hourCount !== null && hourCount >= settings.maxRepliesPerConversationHour) {
    return {
      allowed: false,
      reason: "rate_hour",
      detail: `${hourCount} AI replies on this conversation in the last hour (limit ${settings.maxRepliesPerConversationHour})`,
    };
  }

  if (dayCount !== null && dayCount >= settings.maxRepliesPerConversationDay) {
    return {
      allowed: false,
      reason: "rate_day",
      detail: `${dayCount} AI replies on this conversation in the last 24h (limit ${settings.maxRepliesPerConversationDay})`,
    };
  }

  return ALLOWED;
}

/**
 * Today's Tier 1 spend in cents, UTC day.
 *
 * Returns null on query failure — the caller must treat that as unknown, never
 * as zero. Rows with a null cost_cents (a model missing from the pricing table)
 * contribute nothing to the sum, which is a real gap: an unpriced model would
 * spend invisibly. pricing.ts refuses to guess a price, and the /admin/ai page
 * surfaces unpriced runs so the gap is visible rather than silent.
 */
async function spendTodayCents(
  service: ReturnType<typeof createSupabaseServiceClient>,
): Promise<number | null> {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const { data, error } = await service
    .from("ai_runs")
    .select("cost_cents")
    .gte("created_at", startOfDay.toISOString())
    .not("cost_cents", "is", null);

  if (error) {
    console.warn("[ai] spend query failed: %s", error.message);
    return null;
  }

  return ((data ?? []) as Array<{ cost_cents: number | string }>).reduce(
    (sum, r) => sum + Number(r.cost_cents ?? 0),
    0,
  );
}

async function countAiReplies(
  service: ReturnType<typeof createSupabaseServiceClient>,
  conversationId: string,
  since: string,
): Promise<number | null> {
  const { count, error } = await service
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("sender_type", "ai_agent")
    .gte("created_at", since);

  if (error) {
    console.warn("[ai] rate count failed: %s", error.message);
    return null;
  }
  return count ?? 0;
}
