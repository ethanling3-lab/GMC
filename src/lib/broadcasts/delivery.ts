import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isMarketingFrequencyCapError,
  isMarketingOptOutError,
  isOutsideWindowError,
} from "@/lib/inbox/whatsapp-templates-types";
import { computeBroadcastFinalStatus, type BroadcastErrorCode } from "./types";

// Meta often accepts a message and reports the failure later by webhook. This
// moves that person from "sent" to "failed" on their broadcast, so the counts
// are true and Retry failed follows the same stop rules as an immediate error.

function errorCodeFor(error: string | undefined, metaCode: number | null | undefined): BroadcastErrorCode {
  if (metaCode === 131050 || isMarketingOptOutError(error)) return "opted_out";
  if (metaCode === 131049 || isMarketingFrequencyCapError(error)) return "frequency_capped";
  if (metaCode === 131047 || isOutsideWindowError(error)) return "outside_window";
  return "provider";
}

/** Never throws: a bookkeeping problem must not fail the webhook. */
export async function recordBroadcastDeliveryFailure(
  service: SupabaseClient,
  args: { messageId: string; error?: string; metaCode?: number | null },
): Promise<void> {
  try {
    const { data, error } = await service
      .from("broadcast_recipients")
      .update({
        status: "failed",
        error_code: errorCodeFor(args.error, args.metaCode),
        error_message: args.error ?? "Delivery failed",
        sent_at: null,
      })
      .eq("message_id", args.messageId)
      .eq("status", "sent")
      .select("broadcast_id");
    if (error) throw new Error(error.message);

    const broadcastIds = [
      ...new Set(((data ?? []) as Array<{ broadcast_id: string }>).map((r) => r.broadcast_id)),
    ];
    for (const broadcastId of broadcastIds) {
      const count = async (status?: string) => {
        let query = service
          .from("broadcast_recipients")
          .select("id", { count: "exact", head: true })
          .eq("broadcast_id", broadcastId);
        if (status) query = query.eq("status", status);
        const { count: n, error: countErr } = await query;
        if (countErr) throw new Error(countErr.message);
        return n ?? 0;
      };
      const [total, pending, sent, failed, skipped] = await Promise.all([
        count(),
        count("pending"),
        count("sent"),
        count("failed"),
        count("skipped"),
      ]);
      // A broadcast still sending gets its final counts from the fan-out.
      await service
        .from("broadcasts")
        .update({
          status: computeBroadcastFinalStatus({ sent, failed, skipped }),
          stats: { queued: total - pending, sent, failed, skipped },
        })
        .eq("id", broadcastId)
        .in("status", ["sent", "partial", "failed"]);
    }
  } catch (err) {
    console.warn("[broadcast] delivery failure not recorded: %s", err instanceof Error ? err.message : err);
  }
}
