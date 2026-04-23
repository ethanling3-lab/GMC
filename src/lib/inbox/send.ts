import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";
import { getAdapter, type ChannelKey } from "./channels";
import { findTemplate } from "./whatsapp-templates";
import {
  isOutsideWindowError,
  type TemplateLanguage,
} from "./whatsapp-templates-types";

// Channel-agnostic outbound. Wave 2a keeps the single-message path synchronous:
// compose → write message row (pending) → call adapter.sendMessage → stamp
// external_message_id + delivery_status. Queue + retry lives in Wave 2b when
// AI autopilot starts firing bursts.
//
// Media sends expand to N messages (one per attachment) because WhatsApp
// allows one media per message. The body_text becomes the caption on the
// first attachment; subsequent attachments ship captionless.
//
// Contract:
//   - Caller has already authorised the admin
//   - Caller owns RLS gating — this module uses service_role
//   - We always persist a `messages` row per attempt, even on provider failure,
//     so the thread shows what was tried with an error_message

export type AttachmentInput = {
  path: string;          // inbox-attachments bucket path
  mime_type: string;
  filename: string;
  size?: number;
};

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
    }
  | {
      kind: "media";
      conversationId: string;
      senderAdminId: string;
      /** Becomes the caption on the first attachment. */
      bodyText?: string;
      attachments: AttachmentInput[];
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

export type SendOutboundMediaResult = {
  kind: "media";
  total: number;
  sent: number;
  failed: number;
  results: SendOutboundResult[];
};

export async function sendOutboundMessage(
  input: SendOutboundInput,
): Promise<SendOutboundResult | SendOutboundMediaResult> {
  const service = createSupabaseServiceClient();

  const { data: conv, error: convErr } = await service
    .from("conversations")
    .select("id, channel, external_thread_id")
    .eq("id", input.conversationId)
    .maybeSingle();
  if (convErr || !conv) {
    throw new Error(
      `send: conversation load failed: ${convErr?.message ?? "not_found"}`,
    );
  }

  const channel = conv.channel as ChannelKey;
  const to = conv.external_thread_id as string;

  if (input.kind === "media") {
    if (channel !== "whatsapp") {
      throw new Error(`send: attachment send is WhatsApp-only (channel=${channel})`);
    }
    if (input.attachments.length === 0) {
      throw new Error("send: media kind requires at least one attachment");
    }
    return sendMediaBatch({
      conversationId: input.conversationId,
      senderAdminId: input.senderAdminId,
      channel,
      to,
      bodyText: input.bodyText,
      attachments: input.attachments,
    });
  }

  // Single-message path — text or template.
  return sendSingle({
    conversationId: input.conversationId,
    senderAdminId: input.senderAdminId,
    channel,
    to,
    input,
  });
}

// -----------------------------------------------------------------------------
// Single-message send (text or template).
// -----------------------------------------------------------------------------

async function sendSingle(args: {
  conversationId: string;
  senderAdminId: string;
  channel: ChannelKey;
  to: string;
  input: Extract<SendOutboundInput, { kind: "text" | "template" }>;
}): Promise<SendOutboundResult> {
  const { conversationId, senderAdminId, channel, to, input } = args;
  const service = createSupabaseServiceClient();
  const adapter = getAdapter(channel);

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

  const { data: pending, error: pendingErr } = await service
    .from("messages")
    .insert({
      conversation_id: conversationId,
      direction: "outbound",
      channel,
      sender_type: "admin",
      sender_admin_id: senderAdminId,
      body_text: bodyText,
      delivery_status: "pending",
      created_at: new Date().toISOString(),
      template_name: templateMeta?.name ?? null,
      template_language: templateMeta?.language ?? null,
      template_params: templateMeta?.params ?? null,
    })
    .select("id")
    .single();
  if (pendingErr || !pending) {
    throw new Error(`send: message insert failed: ${pendingErr?.message}`);
  }

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

  const finalised = await finaliseMessage(pending.id as string, result, bodyText);

  await writeAuditLog({
    actor_id: senderAdminId,
    action: templateMeta ? "inbox.template_sent" : "inbox.message_sent",
    entity: "messages",
    entity_id: pending.id as string,
    metadata: {
      conversation_id: conversationId,
      channel,
      delivery_status: finalised.newStatus,
      mocked: result.mocked ?? false,
      error: result.error ?? null,
      error_code: finalised.errorCode,
      template_name: templateMeta?.name ?? null,
      template_language: templateMeta?.language ?? null,
    },
  });

  await bumpConversationCursor({
    conversationId,
    bodyText,
    status: finalised.newStatus,
  });

  return {
    messageId: pending.id as string,
    delivery_status: finalised.newStatus,
    external_message_id: finalised.externalMessageId,
    mocked: Boolean(result.mocked),
    error: result.error ?? null,
    error_code: finalised.errorCode,
  };
}

// -----------------------------------------------------------------------------
// Media batch — one row + one provider call per attachment. Caption lives on
// the first attachment's row so the receiver sees it where WhatsApp expects.
// -----------------------------------------------------------------------------

async function sendMediaBatch(args: {
  conversationId: string;
  senderAdminId: string;
  channel: ChannelKey;
  to: string;
  bodyText?: string;
  attachments: AttachmentInput[];
}): Promise<SendOutboundMediaResult> {
  const { conversationId, senderAdminId, channel, to, bodyText, attachments } = args;
  const service = createSupabaseServiceClient();
  const adapter = getAdapter(channel);

  const results: SendOutboundResult[] = [];
  let sent = 0;
  let failed = 0;
  let lastPreview: { body: string; status: "sent" | "failed" | "pending" } | null = null;

  for (let i = 0; i < attachments.length; i++) {
    const att = attachments[i];
    const caption = i === 0 ? bodyText?.trim() || null : null;
    const waType = waTypeFromMime(att.mime_type);

    // Persist the row first so the thread shows the attempt even on failure.
    const attachmentMeta = {
      storage_path: att.path,
      mime_type: att.mime_type,
      filename: att.filename,
      caption,
      size: att.size ?? null,
      media_id: null as string | null,
    };

    const { data: pending, error: pendingErr } = await service
      .from("messages")
      .insert({
        conversation_id: conversationId,
        direction: "outbound",
        channel,
        sender_type: "admin",
        sender_admin_id: senderAdminId,
        body_text: caption,
        attachments: [attachmentMeta],
        delivery_status: "pending",
        created_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (pendingErr || !pending) {
      throw new Error(`send: attachment row insert failed: ${pendingErr?.message}`);
    }
    const messageId = pending.id as string;

    // If WhatsApp doesn't accept the MIME as a known type, skip the upload
    // and stamp the row as failed — the admin sees a clear message.
    if (!waType) {
      await service
        .from("messages")
        .update({
          delivery_status: "failed",
          error_message: `Unsupported media MIME ${att.mime_type}`,
        })
        .eq("id", messageId);
      failed += 1;
      results.push({
        messageId,
        delivery_status: "failed",
        external_message_id: null,
        mocked: false,
        error: `Unsupported media MIME ${att.mime_type}`,
        error_code: "provider",
      });
      continue;
    }

    // Download from Supabase storage, upload to Meta, send the message.
    const providerResult = await uploadAndSend({
      adapter,
      to,
      bucketPath: att.path,
      mimeType: att.mime_type,
      filename: att.filename,
      caption,
      waType,
    });

    // Write the media_id back into attachments so later displays can re-link.
    if (providerResult.media_id) {
      const nextAtt = { ...attachmentMeta, media_id: providerResult.media_id };
      await service
        .from("messages")
        .update({ attachments: [nextAtt] })
        .eq("id", messageId);
    }

    const finalised = await finaliseMessage(messageId, providerResult, caption ?? att.filename);
    if (finalised.newStatus === "sent") sent += 1;
    else if (finalised.newStatus === "failed") failed += 1;
    lastPreview = {
      body: caption || att.filename,
      status: finalised.newStatus,
    };

    await writeAuditLog({
      actor_id: senderAdminId,
      action: "inbox.message_sent",
      entity: "messages",
      entity_id: messageId,
      metadata: {
        conversation_id: conversationId,
        channel,
        delivery_status: finalised.newStatus,
        mocked: providerResult.mocked ?? false,
        error: providerResult.error ?? null,
        error_code: finalised.errorCode,
        attachment: {
          mime_type: att.mime_type,
          filename: att.filename,
          size: att.size ?? null,
          media_id: providerResult.media_id ?? null,
          wa_type: waType,
        },
      },
    });

    results.push({
      messageId,
      delivery_status: finalised.newStatus,
      external_message_id: finalised.externalMessageId,
      mocked: Boolean(providerResult.mocked),
      error: providerResult.error ?? null,
      error_code: finalised.errorCode,
    });
  }

  if (lastPreview && lastPreview.status !== "failed") {
    await bumpConversationCursor({
      conversationId,
      bodyText: lastPreview.body,
      status: lastPreview.status,
    });
  }

  return {
    kind: "media",
    total: attachments.length,
    sent,
    failed,
    results,
  };
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

async function uploadAndSend(args: {
  adapter: ReturnType<typeof getAdapter>;
  to: string;
  bucketPath: string;
  mimeType: string;
  filename: string;
  caption: string | null;
  waType: "image" | "document" | "audio";
}): Promise<{ mocked: boolean; external_message_id?: string; error?: string; media_id?: string }> {
  const service = createSupabaseServiceClient();

  // 1. Download bytes from Supabase storage.
  const { data: blob, error: dlErr } = await service.storage
    .from("inbox-attachments")
    .download(args.bucketPath);
  if (dlErr || !blob) {
    return {
      mocked: false,
      error: `storage download failed: ${dlErr?.message ?? "missing"}`,
    };
  }
  const buffer = Buffer.from(await blob.arrayBuffer());

  // 2. Upload to Meta → receive media_id.
  if (!args.adapter.uploadMedia) {
    return { mocked: false, error: "adapter missing uploadMedia" };
  }
  const uploadRes = await args.adapter.uploadMedia(buffer, args.mimeType, args.filename);
  if (uploadRes.error || !uploadRes.media_id) {
    if (uploadRes.mocked) {
      return { mocked: true };
    }
    return { mocked: false, error: uploadRes.error ?? "media upload returned no id" };
  }

  // 3. Send the message referencing the media_id.
  const sendRes = await args.adapter
    .sendMessage({
      to: args.to,
      body_text: args.caption ?? undefined,
      media: {
        media_id: uploadRes.media_id,
        type: args.waType,
        filename: args.filename,
      },
    })
    .catch((err) => ({
      mocked: false,
      error: err instanceof Error ? err.message : "send_threw",
    }));

  return {
    mocked: Boolean(sendRes.mocked),
    external_message_id: "external_message_id" in sendRes ? sendRes.external_message_id : undefined,
    error: "error" in sendRes ? sendRes.error : undefined,
    media_id: uploadRes.media_id,
  };
}

type ProviderResult = {
  mocked: boolean;
  external_message_id?: string;
  error?: string;
};

async function finaliseMessage(
  messageId: string,
  result: ProviderResult,
  _previewHint: string | null,
): Promise<{
  newStatus: "sent" | "failed" | "pending";
  externalMessageId: string | null;
  errorCode: "outside_window" | "provider" | null;
}> {
  const service = createSupabaseServiceClient();
  const success = !result.error && Boolean(result.external_message_id);
  const newStatus: "sent" | "failed" | "pending" = success
    ? "sent"
    : result.mocked
      ? "pending"
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
  if (success && result.external_message_id) {
    update.external_message_id = result.external_message_id;
    update.sent_at = new Date().toISOString();
  }
  const { error: updErr } = await service.from("messages").update(update).eq("id", messageId);
  if (updErr) {
    console.warn("[inbox.send] status update failed", updErr.message);
  }

  return {
    newStatus,
    externalMessageId: success ? (result.external_message_id ?? null) : null,
    errorCode,
  };
}

async function bumpConversationCursor(args: {
  conversationId: string;
  bodyText: string | null;
  status: "sent" | "failed" | "pending";
}): Promise<void> {
  if (args.status === "failed") return;
  const service = createSupabaseServiceClient();
  await service
    .from("conversations")
    .update({
      last_message_at: new Date().toISOString(),
      last_message_preview: (args.bodyText ?? "").slice(0, 280),
    })
    .eq("id", args.conversationId);
}

// WhatsApp message body `type` field expects a narrow set of values. We only
// support the MIME families the bucket allows today; anything else is flagged
// as unsupported upstream before we hit the provider.
function waTypeFromMime(mime: string): "image" | "document" | "audio" | null {
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "document";
  if (mime.startsWith("audio/")) return "audio";
  return null;
}
