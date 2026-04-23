import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";
import { getAdapter, type ChannelKey } from "./channels";

// Channel-agnostic outbound. Wave 2a keeps it synchronous: compose → write
// message row (pending) → call adapter.sendMessage → stamp external_message_id
// + delivery_status. Queue + retry lives in Wave 2b when AI autopilot starts
// firing bursts; at one-admin-click-send-rate the direct path is fine.
//
// Contract:
//   - Caller has already authorised the admin
//   - Caller owns RLS gating — this module uses service_role
//   - We always persist a `messages` row, even on provider failure, so the
//     thread shows what was attempted with an error_message
//
// Returns the persisted message row + send result.

export type SendOutboundInput = {
  conversationId: string;
  senderAdminId: string;
  bodyText: string;
};

export type SendOutboundResult = {
  messageId: string;
  delivery_status: "sent" | "failed" | "pending";
  external_message_id: string | null;
  mocked: boolean;
  error: string | null;
};

export async function sendOutboundMessage(
  input: SendOutboundInput,
): Promise<SendOutboundResult> {
  const service = createSupabaseServiceClient();

  // 1. Load conversation to resolve channel + recipient identifier.
  const { data: conv, error: convErr } = await service
    .from("conversations")
    .select(
      "id, channel, external_thread_id, participant_id, participant:participants(phone, email)",
    )
    .eq("id", input.conversationId)
    .maybeSingle();
  if (convErr || !conv) {
    throw new Error(
      `send: conversation load failed: ${convErr?.message ?? "not_found"}`,
    );
  }

  const channel = conv.channel as ChannelKey;
  const adapter = getAdapter(channel);

  // `external_thread_id` is the identifier on the other side — phone (+E.164)
  // for WhatsApp, user id for LINE. That's also what the adapter expects.
  const to = conv.external_thread_id as string;

  const now = new Date().toISOString();

  // 2. Persist the outbound row as pending. A row always exists — even if
  //    the provider call fails — so the thread UI can show the attempt.
  const { data: pending, error: pendingErr } = await service
    .from("messages")
    .insert({
      conversation_id: input.conversationId,
      direction: "outbound",
      channel,
      sender_type: "admin",
      sender_admin_id: input.senderAdminId,
      body_text: input.bodyText,
      delivery_status: "pending",
      created_at: now,
    })
    .select("id")
    .single();
  if (pendingErr || !pending) {
    throw new Error(`send: message insert failed: ${pendingErr?.message}`);
  }

  // 3. Fire the provider call.
  const result = await adapter
    .sendMessage({
      to,
      body_text: input.bodyText,
    })
    .catch((err) => ({
      mocked: false,
      error: err instanceof Error ? err.message : "send_threw",
    }));

  const success = !result.error && "external_message_id" in result;
  const newStatus: "sent" | "failed" | "pending" = success
    ? "sent"
    : result.mocked
      ? // Mocked sends (creds absent) stay at 'pending' so the thread shows
        // the attempt without claiming delivery. Admin can read the dot.
        "pending"
      : "failed";

  const update: Record<string, unknown> = {
    delivery_status: newStatus,
    error_message: result.error ?? null,
  };
  if (success && "external_message_id" in result) {
    update.external_message_id = result.external_message_id ?? null;
    update.sent_at = new Date().toISOString();
  }

  const { error: updErr } = await service
    .from("messages")
    .update(update)
    .eq("id", pending.id);
  if (updErr) {
    // Not fatal — the row exists. Log and continue.
    console.warn("[inbox.send] status update failed", updErr.message);
  }

  // 4. Keep the conversation cursor + preview current so the list orders right.
  await service
    .from("conversations")
    .update({
      last_message_at: new Date().toISOString(),
      last_message_preview: input.bodyText.slice(0, 280),
    })
    .eq("id", input.conversationId);

  // 5. Audit.
  await writeAuditLog({
    actor_id: input.senderAdminId,
    action: "inbox.message_sent",
    entity: "messages",
    entity_id: pending.id as string,
    metadata: {
      conversation_id: input.conversationId,
      channel,
      delivery_status: newStatus,
      mocked: result.mocked ?? false,
      error: result.error ?? null,
    },
  });

  return {
    messageId: pending.id as string,
    delivery_status: newStatus,
    external_message_id:
      (success && "external_message_id" in result
        ? (result.external_message_id ?? null)
        : null) as string | null,
    mocked: Boolean(result.mocked),
    error: result.error ?? null,
  };
}
