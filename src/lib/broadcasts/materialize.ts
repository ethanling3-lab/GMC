import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminContext } from "@/lib/admin-guard";
import { resolveAudience } from "./audience";
import type { AudienceFilter, BroadcastChannel } from "./types";

// Re-resolves the audience for a broadcast and inserts pending recipient
// rows. Called by:
//   - POST /api/admin/broadcasts/[id]/send (initial fan-out materialisation)
//   - POST /api/admin/broadcasts/[id]/retry-failed (re-queue failed sends
//     after the audience may have grown)
//   - cron-broadcasts-due route (scheduled fire path)
//
// The (broadcast_id, participant_id, channel) unique constraint dedupes —
// if the audience hasn't changed since the last materialise, the insert
// is a no-op. New audience members get inserted as pending.
//
// Returns the number of pending rows AFTER materialisation (the queue
// depth the background fn will process).

export async function materialiseRecipients(
  service: SupabaseClient,
  admin: AdminContext,
  broadcast: {
    id: string;
    audience_mode: "event_cohort" | "participant_master";
    audience_filter: AudienceFilter;
    channels: BroadcastChannel[];
  },
): Promise<{ queued: number; total_pending: number }> {
  const resolution = await resolveAudience(
    service,
    admin,
    broadcast.audience_filter,
    broadcast.channels,
  );

  if (resolution.recipients.length === 0) {
    const { count } = await service
      .from("broadcast_recipients")
      .select("id", { count: "exact", head: true })
      .eq("broadcast_id", broadcast.id)
      .eq("status", "pending");
    return { queued: 0, total_pending: count ?? 0 };
  }

  // Build insert rows: one per (participant × channel) where the
  // participant has an address for that channel.
  const rows: InsertRow[] = [];
  for (const r of resolution.recipients) {
    for (const channel of broadcast.channels) {
      const address = r.addresses[channel];
      if (!address) continue;
      rows.push({
        broadcast_id: broadcast.id,
        participant_id: r.participant_id,
        enrollment_id: r.enrollment_id,
        channel,
        target_address: address,
        status: "pending",
      });
    }
  }

  let queued = 0;
  // Chunk inserts so the request body doesn't blow up on large audiences.
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await service
      .from("broadcast_recipients")
      .upsert(slice, {
        onConflict: "broadcast_id,participant_id,channel",
        ignoreDuplicates: true,
      })
      .select("id");
    if (error) throw new Error(`materialise insert failed: ${error.message}`);
    // Without count we can't know how many actually inserted vs collided —
    // accept the conservative approximation.
    queued += slice.length;
  }

  // Re-count pending (this is the queue depth the fan-out will work
  // through — includes already-pending rows from prior runs).
  const { count } = await service
    .from("broadcast_recipients")
    .select("id", { count: "exact", head: true })
    .eq("broadcast_id", broadcast.id)
    .eq("status", "pending");

  return { queued, total_pending: count ?? 0 };
}

type InsertRow = {
  broadcast_id: string;
  participant_id: string;
  enrollment_id: string | null;
  channel: BroadcastChannel;
  target_address: string;
  status: "pending";
};

// Re-queues failed recipients for retry. Only `outside_window` and
// `provider` codes are eligible — `no_address` and `cancelled` stay
// skipped. Resets status to 'pending', clears error fields. The
// background fan-out picks them up on next invocation.
export async function requeueFailedRecipients(
  service: SupabaseClient,
  broadcastId: string,
): Promise<{ requeued: number }> {
  const { data, error } = await service
    .from("broadcast_recipients")
    .update({
      status: "pending",
      error_message: null,
      error_code: null,
      external_message_id: null,
      attempted_at: null,
    })
    .eq("broadcast_id", broadcastId)
    .eq("status", "failed")
    .in("error_code", ["outside_window", "provider", "unknown"])
    .select("id");
  if (error) throw new Error(`retry-failed update failed: ${error.message}`);
  return { requeued: data?.length ?? 0 };
}
