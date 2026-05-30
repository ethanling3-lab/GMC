import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendOutboundMessage } from "@/lib/inbox/send";
import { sendEmail } from "@/lib/email";
import { participantEmailLocale } from "@/lib/i18n";
import { isOutsideWindowError } from "@/lib/inbox/whatsapp-templates-types";
import { writeAuditLog } from "@/lib/audit";
import { findOrCreateConversationForBroadcast } from "./conversation-resolve";
import { interpolate, interpolateTemplateParams, type InterpolationContext } from "./interpolate";
import type { BroadcastErrorCode } from "./types";

// Per-recipient send for the background fan-out loop.
//
// Routes by channel:
//   - whatsapp: resolve/create conversation → call sendOutboundMessage
//     ({kind:'template', ...}) which writes the `messages` row and
//     classifies outside_window vs provider errors.
//   - email: resolve/create email conversation → call sendEmail() →
//     manually write a `messages` row (this is the codebase's first
//     email→conversation mirror).
//
// Idempotency: the fan-out loop is driven by `broadcast_recipients
// .status='pending'`. After this returns, the caller updates that row
// to sent/failed/skipped — if the function dies mid-call, the next
// invocation re-picks up the pending row and retries. The downside is
// a duplicate WhatsApp/email could be sent (provider already received
// the request even though we crashed before stamping it). Acceptable
// for v1.

export type SendOutcome = {
  status: "sent" | "failed" | "skipped";
  error_code: BroadcastErrorCode | null;
  error_message: string | null;
  external_message_id: string | null;
  conversation_id: string | null;
  message_id: string | null;
};

export type BroadcastForSend = {
  id: string;
  created_by: string;
  whatsapp_template_name: string | null;
  whatsapp_template_language: string | null;
  whatsapp_template_params: Record<string, string> | null;
  email_subject_en: string | null;
  email_subject_cn: string | null;
  email_body_en: string | null;
  email_body_cn: string | null;
};

export type RecipientForSend = {
  id: string;
  participant_id: string;
  channel: "whatsapp" | "email";
  target_address: string | null;
};

export async function sendBroadcastRecipient(
  service: SupabaseClient,
  broadcast: BroadcastForSend,
  recipient: RecipientForSend,
  ctx: InterpolationContext,
): Promise<SendOutcome> {
  if (!recipient.target_address || !recipient.target_address.trim()) {
    return {
      status: "skipped",
      error_code: "no_address",
      error_message: "No address on file",
      external_message_id: null,
      conversation_id: null,
      message_id: null,
    };
  }

  try {
    if (recipient.channel === "whatsapp") {
      return await sendWhatsApp(service, broadcast, recipient, ctx);
    }
    return await sendEmailMirrored(service, broadcast, recipient, ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : "send threw";
    return {
      status: "failed",
      error_code: isOutsideWindowError(message) ? "outside_window" : "provider",
      error_message: message,
      external_message_id: null,
      conversation_id: null,
      message_id: null,
    };
  }
}

// ---------------------------------------------------------------------------
// WhatsApp path — delegates to sendOutboundMessage so the messages row +
// adapter call + error classification all live in one place.
// ---------------------------------------------------------------------------

async function sendWhatsApp(
  service: SupabaseClient,
  broadcast: BroadcastForSend,
  recipient: RecipientForSend,
  ctx: InterpolationContext,
): Promise<SendOutcome> {
  if (!broadcast.whatsapp_template_name || !broadcast.whatsapp_template_language) {
    return {
      status: "failed",
      error_code: "provider",
      error_message: "WhatsApp template not configured on broadcast",
      external_message_id: null,
      conversation_id: null,
      message_id: null,
    };
  }
  const language = broadcast.whatsapp_template_language;
  if (language !== "en_US" && language !== "zh_CN") {
    return {
      status: "failed",
      error_code: "provider",
      error_message: `Unsupported WhatsApp template language: ${language}`,
      external_message_id: null,
      conversation_id: null,
      message_id: null,
    };
  }

  const conversationId = await findOrCreateConversationForBroadcast(service, {
    participantId: recipient.participant_id,
    channel: "whatsapp",
    externalThreadId: recipient.target_address!,
  });

  const params = interpolateTemplateParams(broadcast.whatsapp_template_params, ctx);

  const result = await sendOutboundMessage({
    kind: "template",
    conversationId,
    senderAdminId: broadcast.created_by,
    templateName: broadcast.whatsapp_template_name,
    languageCode: language,
    params,
  });

  // Media result shape is impossible here — kind is "template".
  if ("kind" in result && result.kind === "media") {
    return {
      status: "failed",
      error_code: "provider",
      error_message: "Unexpected media result from template send",
      external_message_id: null,
      conversation_id: conversationId,
      message_id: null,
    };
  }
  const single = result as Extract<typeof result, { messageId: string }>;
  const outcome: SendOutcome["status"] =
    single.delivery_status === "sent"
      ? "sent"
      : single.delivery_status === "pending"
        ? "sent" // mocked-mode still counts as sent for broadcast accounting
        : "failed";
  return {
    status: outcome,
    error_code: single.error_code === "outside_window" ? "outside_window" : single.error_code === "provider" ? "provider" : null,
    error_message: single.error,
    external_message_id: single.external_message_id,
    conversation_id: conversationId,
    message_id: single.messageId,
  };
}

// ---------------------------------------------------------------------------
// Email path — first email→conversation mirror in the codebase. Resolve
// conversation, send via the existing sendEmail() helper, then write
// the outbound messages row by hand.
// ---------------------------------------------------------------------------

async function sendEmailMirrored(
  service: SupabaseClient,
  broadcast: BroadcastForSend,
  recipient: RecipientForSend,
  ctx: InterpolationContext,
): Promise<SendOutcome> {
  const locale = participantEmailLocale({ language_fluency: ctx.participant.language_fluency });
  const subjectTpl = locale === "zh" ? broadcast.email_subject_cn : broadcast.email_subject_en;
  const bodyTpl = locale === "zh" ? broadcast.email_body_cn : broadcast.email_body_en;
  // Fallback to the other locale if the recipient's preferred locale is
  // missing content — better to send the other language than skip.
  const subjectTplResolved = subjectTpl ?? (locale === "zh" ? broadcast.email_subject_en : broadcast.email_subject_cn);
  const bodyTplResolved = bodyTpl ?? (locale === "zh" ? broadcast.email_body_en : broadcast.email_body_cn);
  if (!subjectTplResolved || !bodyTplResolved) {
    return {
      status: "failed",
      error_code: "provider",
      error_message: "Email content not configured for either locale on broadcast",
      external_message_id: null,
      conversation_id: null,
      message_id: null,
    };
  }

  const subject = interpolate(subjectTplResolved, ctx);
  const html = interpolate(bodyTplResolved, ctx);

  const conversationId = await findOrCreateConversationForBroadcast(service, {
    participantId: recipient.participant_id,
    channel: "email",
    externalThreadId: recipient.target_address!,
  });

  // Insert pending mirror row first (same pattern as inbox/send.ts:176).
  const inserted = await service
    .from("messages")
    .insert({
      conversation_id: conversationId,
      direction: "outbound",
      channel: "email",
      sender_type: "admin",
      sender_admin_id: broadcast.created_by,
      body_text: html, // raw HTML — the inbox renderer should be lenient on email channel
      delivery_status: "pending",
      created_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (inserted.error || !inserted.data) {
    return {
      status: "failed",
      error_code: "provider",
      error_message: `email mirror insert failed: ${inserted.error?.message ?? "unknown"}`,
      external_message_id: null,
      conversation_id: conversationId,
      message_id: null,
    };
  }
  const messageId = inserted.data.id as string;

  const sendResult = await sendEmail({
    to: recipient.target_address!,
    subject,
    html,
  });

  const success = !sendResult.error;
  const status: SendOutcome["status"] = success ? "sent" : "failed";
  const externalMessageId = sendResult.id ?? null;

  await service
    .from("messages")
    .update({
      delivery_status: success ? "sent" : "failed",
      external_message_id: externalMessageId,
      error_message: sendResult.error ?? null,
      sent_at: success ? new Date().toISOString() : null,
    })
    .eq("id", messageId);

  if (success) {
    await service
      .from("conversations")
      .update({
        last_message_at: new Date().toISOString(),
        last_message_preview: subject.slice(0, 280),
      })
      .eq("id", conversationId);
  }

  await writeAuditLog({
    actor_id: broadcast.created_by,
    action: success ? "broadcast.recipient_sent" : "broadcast.recipient_failed",
    entity: "broadcast_recipients",
    entity_id: recipient.id,
    metadata: {
      broadcast_id: broadcast.id,
      channel: "email",
      conversation_id: conversationId,
      message_id: messageId,
      mocked: sendResult.mocked,
      error: sendResult.error ?? null,
    },
  });

  return {
    status,
    error_code: success ? null : "provider",
    error_message: sendResult.error ?? null,
    external_message_id: externalMessageId,
    conversation_id: conversationId,
    message_id: messageId,
  };
}
