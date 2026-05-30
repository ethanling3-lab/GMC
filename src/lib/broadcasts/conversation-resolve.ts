import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Find-or-create a conversation for a (participant, channel,
// external_thread_id) triple. Mirrors the private helper in
// src/lib/inbox/ingest.ts:252 (kept private to avoid circular imports —
// we re-implement the few lines here so the broadcast send path doesn't
// need to drag the inbound-ingest module).
//
// The unique constraint is on (channel, external_thread_id) so the
// happy path is a single select; insert handles first-time, and the
// 23505 retry covers webhook+broadcast races on the same address.
//
// external_thread_id by channel:
//   - whatsapp: '+E164' (matches what ingest.ts stores from inbound
//     webhooks; sendOutboundMessage reads it back to find the `to`
//     address from the conversation row).
//   - email: the recipient's email address.

export async function findOrCreateConversationForBroadcast(
  service: SupabaseClient,
  args: {
    participantId: string;
    channel: "whatsapp" | "email";
    externalThreadId: string;
  },
): Promise<string> {
  const existing = await service
    .from("conversations")
    .select("id")
    .eq("channel", args.channel)
    .eq("external_thread_id", args.externalThreadId)
    .maybeSingle();
  if (existing.data) return existing.data.id as string;

  const inserted = await service
    .from("conversations")
    .insert({
      participant_id: args.participantId,
      channel: args.channel,
      external_thread_id: args.externalThreadId,
      status: "open",
    })
    .select("id")
    .single();
  if (inserted.error) {
    const code = (inserted.error as { code?: string }).code;
    if (code === "23505") {
      const retry = await service
        .from("conversations")
        .select("id")
        .eq("channel", args.channel)
        .eq("external_thread_id", args.externalThreadId)
        .maybeSingle();
      if (retry.data) return retry.data.id as string;
    }
    throw new Error(`conversation insert failed: ${inserted.error.message}`);
  }
  return inserted.data.id as string;
}
