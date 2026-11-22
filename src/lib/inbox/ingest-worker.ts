import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { processInboundMessage } from "./ingest";
import type { ChannelKey } from "./channels";
import type { ParsedInboundMessage } from "./channels/adapter";

// The queue drainer. ONE implementation, two invocation paths:
//
//   * production — netlify/functions/whatsapp-ingest-background.ts, which gets
//     a 15-minute timeout instead of the route's 26 seconds
//   * anywhere the background function is unreachable (localhost, and any
//     deploy where the kick fails) — the webhook route calls this via
//     next/server `after()`, so the response is still immediate
//
// The fallback is not a nicety. Inbound only reaches the deployed site, so the
// only way to QA ingest against uncommitted code is to tunnel Meta's webhook at
// localhost — and there is no Netlify function there. Without an inline path,
// enqueued messages would sit unprocessed and the whole QA loop would break.

/** Give up after this many attempts and make the failure visible. */
const MAX_ATTEMPTS = 5;

/** Threads claimed per drain pass. */
const THREAD_BATCH = 5;

export type DrainSummary = {
  claimed: number;
  processed: number;
  duplicates: number;
  retried: number;
  dead: number;
  errors: string[];
};

type QueueRow = {
  id: string;
  channel: ChannelKey;
  external_event_id: string;
  payload: ParsedInboundMessage;
  attempts: number;
  thread_key: string | null;
};

/**
 * Claim and process queued inbound events until the queue is empty.
 *
 * Loops rather than draining once: a thread claimed by this pass is invisible
 * to the claim until it finishes, so a single pass would leave that person's
 * later messages waiting for the next trigger.
 */
export async function drainWebhookQueue(
  opts: { maxPasses?: number } = {},
): Promise<DrainSummary> {
  const service = createSupabaseServiceClient();
  const summary: DrainSummary = {
    claimed: 0, processed: 0, duplicates: 0, retried: 0, dead: 0, errors: [],
  };
  const maxPasses = opts.maxPasses ?? 20;

  for (let pass = 0; pass < maxPasses; pass++) {
    const { data, error } = await service.rpc("claim_webhook_events", {
      p_thread_limit: THREAD_BATCH,
    });
    if (error) {
      summary.errors.push(`claim failed: ${error.message}`);
      return summary;
    }
    const rows = (data ?? []) as QueueRow[];
    if (rows.length === 0) return summary;
    summary.claimed += rows.length;

    // Group by thread and run threads concurrently, but each thread's own
    // events strictly in order — two messages 0.6s apart must not be answered
    // out of sequence, which is what produced duplicate AI replies in QA.
    const byThread = new Map<string, QueueRow[]>();
    for (const row of rows) {
      const key = row.thread_key ?? row.id;
      const list = byThread.get(key);
      if (list) list.push(row);
      else byThread.set(key, [row]);
    }

    await Promise.all(
      [...byThread.values()].map(async (thread) => {
        for (const row of thread) {
          await processOne(service, row, summary);
        }
      }),
    );
  }

  return summary;
}

async function processOne(
  service: ReturnType<typeof createSupabaseServiceClient>,
  row: QueueRow,
  summary: DrainSummary,
): Promise<void> {
  try {
    const outcome = await processInboundMessage(service, row.channel, row.payload);
    if (outcome === "duplicate") summary.duplicates++;
    else summary.processed++;

    await service
      .from("webhook_events")
      .update({ status: "done", processed_at: new Date().toISOString(), last_error: null })
      .eq("id", row.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    summary.errors.push(`${row.external_event_id}: ${message}`);

    if (row.attempts >= MAX_ATTEMPTS) {
      await service
        .from("webhook_events")
        .update({ status: "dead", last_error: message })
        .eq("id", row.id);
      summary.dead++;
      await surfaceDeadLetter(service, row, message);
      return;
    }

    // Exponential backoff, capped. A message failing because a provider is
    // briefly down should not burn its five attempts in five seconds.
    const delaySeconds = Math.min(15 * 2 ** row.attempts, 15 * 60);
    await service
      .from("webhook_events")
      .update({
        status: "pending",
        locked_at: null,
        last_error: message,
        next_attempt_at: new Date(Date.now() + delaySeconds * 1000).toISOString(),
      })
      .eq("id", row.id);
    summary.retried++;
  }
}

/**
 * A dead-lettered message must not be a silent gap.
 *
 * The whole point of this phase is that a lost inbound message told nobody. So
 * a message we have permanently failed to process flips its thread to `pending`
 * and posts a visible system note into the transcript — the same treatment a
 * tier-1 handoff gets. Staff see a thread needing attention and a line saying
 * why, rather than a conversation that mysteriously skips a beat.
 *
 * Best-effort throughout: this runs on the failure path, and throwing here
 * would mask the original error.
 */
async function surfaceDeadLetter(
  service: ReturnType<typeof createSupabaseServiceClient>,
  row: QueueRow,
  reason: string,
): Promise<void> {
  try {
    const threadId = row.payload?.external_thread_id;
    if (!threadId) return;

    const { data: conv } = await service
      .from("conversations")
      .select("id")
      .eq("channel", row.channel)
      .eq("external_thread_id", threadId)
      .maybeSingle();
    if (!conv) return;

    const conversationId = conv.id as string;

    // Matches tier1's postSystemNote convention exactly — direction "outbound"
    // with sender_type "system" is how this codebase renders an in-transcript
    // note, and MessageBubble already styles it.
    await service.from("messages").insert({
      conversation_id: conversationId,
      direction: "outbound",
      channel: row.channel,
      sender_type: "system",
      sent_at: new Date().toISOString(),
      body_text:
        `⚠️ A message from this contact could not be processed after ${MAX_ATTEMPTS} attempts `
        + `and is not shown above. Reason: ${reason}. `
        + `Ask them to resend, or check webhook_events ${row.external_event_id}.`,
      delivery_status: "sent",
    });

    await service
      .from("conversations")
      .update({ status: "pending" })
      .eq("id", conversationId);

    const { notifyAdmins } = await import("@/lib/notifications/admin-alerts");
    await notifyAdmins({
      kind: "send_failed",
      conversationId,
      payload: { channel: row.channel, error: reason, dead_letter: true },
    });
  } catch (err) {
    console.warn(
      "[ingest-worker] dead-letter surfacing failed: %s",
      err instanceof Error ? err.message : String(err),
    );
  }
}
