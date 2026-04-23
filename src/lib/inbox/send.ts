import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";
import { getAdapter, type ChannelKey } from "./channels";
import { findTemplate } from "./whatsapp-templates";
import {
  isOutsideWindowError,
  type TemplateLanguage,
} from "./whatsapp-templates-types";

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
// Returns the persisted message row + send result. `error_code` is a
// stable tag the client uses to drive UX (e.g. "outside_window" → show the
// template picker inline with the banner).

export type SendOutboundInput =
  | {
      kind: "text";
      conversationId: string;
      senderAdminId: string;
      bodyText: string;
    }
  | {
      kind: "template";
      conversationId: string;
      senderAdminId: string;
      templateName: string;
      languageCode: TemplateLanguage;
      params: Record<string, string>;
    };

export type SendOutboundResult = {
  messageId: string;
  delivery_status: "sent" | "failed" | "pending";
  external_message_id: string | null;
  mocked: boolean;
  error: string | null;
  /** Stable machine tag for the client — 'outside_window' | 'provider' | null */
  error_code: "outside_window" | "provider" | null;
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
  const to = conv.external_thread_id as string;

  // 2. Resolve the body + template (if any). Templates are WhatsApp-only;
  //    attempting a template on another channel is a programming error.
  let bodyText: string;
  let templatePayload: {
    name: string;
    language_code: TemplateLanguage;
    components: unknown[];
  } | null = null;
  let templateMeta: {
    name: string;
    language: TemplateLanguage;
    params: Record<string, string>;
  } | null = null;

  if (input.kind === "text") {
    bodyText = input.bodyText;
  } else {
    if (channel !== "whatsapp") {
      throw new Error(`send: template send is WhatsApp-only (channel=${channel})`);
    }
    const def = findTemplate(input.templateName);
    if (!def) {
      throw new Error(`send: unknown template '${input.templateName}'`);
    }
    if (!def.languages.includes(input.languageCode)) {
      throw new Error(
        `send: template '${def.name}' not available in ${input.languageCode}`,
      );
    }
    bodyText = def.render(input.params, input.languageCode);
    templatePayload = {
      name: def.name,
      language_code: input.languageCode,
      components: def.buildComponents(input.params),
    };
    templateMeta = {
      name: def.name,
      language: input.languageCode,
      params: input.params,
    };
  }

  const now = new Date().toISOString();

  // 3. Persist the outbound row as pending. A row always exists — even if
  //    the provider call fails — so the thread UI can show the attempt.
  const { data: pending, error: pendingErr } = await service
    .from("messages")
    .insert({
      conversation_id: input.conversationId,
      direction: "outbound",
      channel,
      sender_type: "admin",
      sender_admin_id: input.senderAdminId,
      body_text: bodyText,
      delivery_status: "pending",
      created_at: now,
      template_name: templateMeta?.name ?? null,
      template_language: templateMeta?.language ?? null,
      template_params: templateMeta?.params ?? null,
    })
    .select("id")
    .single();
  if (pendingErr || !pending) {
    throw new Error(`send: message insert failed: ${pendingErr?.message}`);
  }

  // 4. Fire the provider call.
  const result = await adapter
    .sendMessage({
      to,
      body_text: templatePayload ? undefined : bodyText,
      template: templatePayload
        ? {
            name: templatePayload.name,
            language_code: templatePayload.language_code,
            components: templatePayload.components,
          }
        : undefined,
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

  const errorCode: "outside_window" | "provider" | null = success
    ? null
    : isOutsideWindowError(result.error)
      ? "outside_window"
      : result.error
        ? "provider"
        : null;

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
    console.warn("[inbox.send] status update failed", updErr.message);
  }

  // 5. Keep the conversation cursor + preview current so the list orders right.
  //    Skip the preview update on a hard failure — the row is marked failed
  //    and listing the failed text as the thread preview is misleading.
  if (newStatus !== "failed") {
    await service
      .from("conversations")
      .update({
        last_message_at: new Date().toISOString(),
        last_message_preview: bodyText.slice(0, 280),
      })
      .eq("id", input.conversationId);
  }

  // 6. Audit.
  await writeAuditLog({
    actor_id: input.senderAdminId,
    action: templateMeta
      ? "inbox.template_sent"
      : "inbox.message_sent",
    entity: "messages",
    entity_id: pending.id as string,
    metadata: {
      conversation_id: input.conversationId,
      channel,
      delivery_status: newStatus,
      mocked: result.mocked ?? false,
      error: result.error ?? null,
      error_code: errorCode,
      template_name: templateMeta?.name ?? null,
      template_language: templateMeta?.language ?? null,
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
    error_code: errorCode,
  };
}
