import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";
import { resolveIdentity } from "./identity";
import { getAdapter, type ChannelKey } from "./channels";
import type { ParsedInboundMessage, ParsedWebhookResult } from "./channels/adapter";
import { runTier1Reply } from "./ai/tier1";

// Channel-agnostic inbound pipeline. Call from each webhook route after
// signature verification. Idempotent: the same webhook payload can be
// delivered N times (Meta + LINE both retry aggressively) and only the first
// delivery results in new rows.
//
// Pipeline:
//   1. Dedupe the event via webhook_events (unique on channel + external_event_id)
//   2. Resolve participant via identity.ts (auto-create lead if unknown)
//   3. Find or create the conversation (unique on channel + external_thread_id)
//   4. Download each attachment synchronously into `inbox-attachments`
//   5. Insert the message row (partial-unique on channel + external_message_id)
//   6. Update conversation.last_message_* for inbox list ordering
//   7. Apply status updates to prior outbound messages (delivered/read/failed)
//
// Returns a summary so the route can log + respond meaningfully.

export type IngestSummary = {
  inserted_messages: number;
  skipped_messages: number;     // duplicates (webhook replay or message_id clash)
  status_updates: number;
  errors: string[];
};

export async function ingestWebhook(
  channel: ChannelKey,
  payload: unknown,
): Promise<IngestSummary> {
  const summary: IngestSummary = {
    inserted_messages: 0,
    skipped_messages: 0,
    status_updates: 0,
    errors: [],
  };

  const adapter = getAdapter(channel);
  const parsed: ParsedWebhookResult = adapter.parseWebhook(payload);
  const service = createSupabaseServiceClient();

  for (const msg of parsed.messages) {
    try {
      const handled = await processInboundMessage(service, channel, msg);
      if (handled === "inserted") summary.inserted_messages++;
      else summary.skipped_messages++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary.errors.push(`message ${msg.external_message_id}: ${message}`);
    }
  }

  for (const s of parsed.statuses) {
    try {
      const updated = await applyStatusUpdate(service, s);
      if (updated) summary.status_updates++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary.errors.push(`status ${s.external_message_id}: ${message}`);
    }
  }

  return summary;
}

// -----------------------------------------------------------------------------
// One inbound message — the main pipeline.
// -----------------------------------------------------------------------------

async function processInboundMessage(
  service: ReturnType<typeof createSupabaseServiceClient>,
  channel: ChannelKey,
  msg: ParsedInboundMessage,
): Promise<"inserted" | "duplicate"> {
  // 1. Dedupe at the event level.
  const eventInsert = await service
    .from("webhook_events")
    .insert({
      channel,
      external_event_id: msg.external_event_id,
      payload: msg.raw,
    })
    .select("id")
    .single();
  if (eventInsert.error) {
    const code = (eventInsert.error as { code?: string }).code;
    if (code === "23505") {
      // Already processed this event — short-circuit.
      return "duplicate";
    }
    throw new Error(`webhook_events insert failed: ${eventInsert.error.message}`);
  }

  // 2. Resolve the participant.
  const identity = await resolveIdentity(service, channel, msg.identifier);

  // 3. Find or create the conversation.
  const conversationId = await findOrCreateConversation(
    service,
    channel,
    msg,
    identity.participant_id,
  );

  // 4. Download attachments (blocking — URLs expire).
  const adapter = getAdapter(channel);
  const storedAttachments: StoredAttachment[] = [];
  for (const att of msg.attachments) {
    try {
      const { buffer, mimeType } = await adapter.downloadAttachment(att.media_id);
      const stored = await storeAttachment(service, {
        channel,
        conversationId,
        externalMessageId: msg.external_message_id,
        mediaId: att.media_id,
        mimeType: att.mime_type ?? mimeType,
        filename: att.filename,
        buffer,
      });
      storedAttachments.push({
        storage_path: stored.storage_path,
        mime_type: att.mime_type ?? mimeType,
        filename: att.filename,
        caption: att.caption,
        size: att.size ?? buffer.length,
        media_id: att.media_id,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Failure to download one attachment shouldn't drop the message —
      // persist the message with an attachment stub so admin can see what
      // was sent and re-fetch later.
      storedAttachments.push({
        storage_path: null,
        mime_type: att.mime_type,
        filename: att.filename,
        caption: att.caption,
        size: att.size,
        media_id: att.media_id,
        error: message,
      });
    }
  }

  // 5. Insert the message. Partial-unique on (channel, external_message_id)
  //    protects against inner-loop retries where the event row was written
  //    but the message insert failed on the first pass.
  const now = new Date().toISOString();
  const messageInsert = await service
    .from("messages")
    .insert({
      conversation_id: conversationId,
      direction: "inbound",
      channel,
      external_message_id: msg.external_message_id,
      sender_type: "participant",
      body_text: msg.body_text,
      attachments: storedAttachments,
      delivery_status: "delivered",
      delivered_at: msg.received_at ?? now,
    })
    .select("id")
    .single();

  if (messageInsert.error) {
    const code = (messageInsert.error as { code?: string }).code;
    if (code === "23505") {
      // Partial unique collided — another webhook already created this message.
      return "duplicate";
    }
    throw new Error(`message insert failed: ${messageInsert.error.message}`);
  }

  // 6. Update the conversation's last-message cursor.
  const preview = buildPreview(msg.body_text, storedAttachments);
  await service
    .from("conversations")
    .update({
      last_message_at: msg.received_at ?? now,
      last_message_preview: preview,
      // Re-open snoozed/closed threads when the participant messages again.
      status: "open",
    })
    .eq("id", conversationId);

  await writeAuditLog({
    actor_id: null,
    action: "inbox.message_received",
    entity: "messages",
    entity_id: messageInsert.data.id as string,
    metadata: {
      channel,
      conversation_id: conversationId,
      participant_id: identity.participant_id,
      auto_created: identity.created,
      attachment_count: storedAttachments.length,
    },
  });

  // 7. If AI is enabled on this conversation and the message is plain text
  //    (no attachments — Tier 1 doesn't handle media), fire the Tier 1
  //    responder. Runs inline — Meta's webhook timeout is generous enough
  //    for Claude to return within it. If AI calls handoff_to_human, the
  //    function will flip ai_enabled off itself.
  if (storedAttachments.length === 0 && msg.body_text && msg.body_text.trim()) {
    const { data: conv } = await service
      .from("conversations")
      .select("ai_enabled, participant:participants(language)")
      .eq("id", conversationId)
      .maybeSingle();
    if (conv?.ai_enabled) {
      const participantLang = (
        (conv as { participant?: { language?: string | null } | null }).participant?.language ?? null
      ) as string | null;
      try {
        await runTier1Reply({
          conversationId,
          messageId: messageInsert.data.id as string,
          participantLanguage:
            participantLang === "zh" ? "zh" : participantLang === "en" ? "en" : null,
          inboundText: msg.body_text,
        });
      } catch (err) {
        // Failure inside Tier 1 already handoffs the conversation; here we
        // just swallow so the webhook still returns 200 and Meta doesn't
        // retry-bomb a message we've already persisted.
        console.warn(
          "[tier1] run failed, conversation already handed off:",
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  return "inserted";
}

// -----------------------------------------------------------------------------
// Conversation lookup / creation.
// -----------------------------------------------------------------------------

async function findOrCreateConversation(
  service: ReturnType<typeof createSupabaseServiceClient>,
  channel: ChannelKey,
  msg: ParsedInboundMessage,
  participantId: string,
): Promise<string> {
  // Happy path: existing thread.
  const existing = await service
    .from("conversations")
    .select("id")
    .eq("channel", channel)
    .eq("external_thread_id", msg.external_thread_id)
    .maybeSingle();
  if (existing.data) return existing.data.id as string;

  const inserted = await service
    .from("conversations")
    .insert({
      participant_id: participantId,
      channel,
      external_thread_id: msg.external_thread_id,
      status: "open",
    })
    .select("id")
    .single();
  if (inserted.error) {
    // Race: another webhook created it between the select and insert.
    if ((inserted.error as { code?: string }).code === "23505") {
      const retry = await service
        .from("conversations")
        .select("id")
        .eq("channel", channel)
        .eq("external_thread_id", msg.external_thread_id)
        .maybeSingle();
      if (retry.data) return retry.data.id as string;
    }
    throw new Error(`conversation insert failed: ${inserted.error.message}`);
  }
  return inserted.data.id as string;
}

// -----------------------------------------------------------------------------
// Attachment storage — one private file per inbound media item.
// -----------------------------------------------------------------------------

type StoredAttachment = {
  storage_path: string | null;
  mime_type: string | null;
  filename: string | null;
  caption: string | null;
  size: number | null;
  media_id: string;
  error?: string;
};

async function storeAttachment(
  service: ReturnType<typeof createSupabaseServiceClient>,
  args: {
    channel: ChannelKey;
    conversationId: string;
    externalMessageId: string;
    mediaId: string;
    mimeType: string;
    filename: string | null;
    buffer: Buffer;
  },
): Promise<{ storage_path: string }> {
  const extension = pickExtension(args.mimeType, args.filename);
  const safeFilename = args.filename?.replace(/[^\w.-]/g, "_") ?? null;
  const name = safeFilename
    ? `${args.mediaId}-${safeFilename}`
    : `${args.mediaId}.${extension}`;
  const storagePath = `${args.channel}/${args.conversationId}/${args.externalMessageId}/${name}`;

  const { error } = await service.storage
    .from("inbox-attachments")
    .upload(storagePath, args.buffer, {
      contentType: args.mimeType,
      upsert: true,
    });
  if (error) {
    throw new Error(`attachment upload failed: ${error.message}`);
  }
  return { storage_path: storagePath };
}

function pickExtension(mimeType: string, filename: string | null): string {
  if (filename && filename.includes(".")) {
    const ext = filename.split(".").pop();
    if (ext) return ext.toLowerCase();
  }
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "application/pdf": "pdf",
    "audio/mpeg": "mp3",
    "audio/ogg": "ogg",
    "audio/mp4": "m4a",
    "audio/webm": "webm",
    "video/mp4": "mp4",
  };
  return map[mimeType] ?? "bin";
}

function buildPreview(
  bodyText: string | null,
  attachments: StoredAttachment[],
): string {
  if (bodyText && bodyText.trim()) return bodyText.trim().slice(0, 280);
  if (attachments.length > 0) {
    const first = attachments[0];
    if (first.mime_type?.startsWith("image/")) return "📷 Image";
    if (first.mime_type?.startsWith("audio/")) return "🎤 Audio";
    if (first.mime_type === "application/pdf") return "📄 PDF";
    return "📎 Attachment";
  }
  return "";
}

// -----------------------------------------------------------------------------
// Outbound delivery status updates.
// -----------------------------------------------------------------------------

async function applyStatusUpdate(
  service: ReturnType<typeof createSupabaseServiceClient>,
  s: {
    channel: ChannelKey;
    external_message_id: string;
    status: "sent" | "delivered" | "read" | "failed";
    error?: string;
    timestamp: string | null;
  },
): Promise<boolean> {
  const update: Record<string, unknown> = { delivery_status: s.status };
  if (s.status === "sent") update.sent_at = s.timestamp ?? new Date().toISOString();
  if (s.status === "delivered") update.delivered_at = s.timestamp ?? new Date().toISOString();
  if (s.status === "read") update.read_at = s.timestamp ?? new Date().toISOString();
  if (s.status === "failed") update.error_message = s.error ?? "unknown";

  const res = await service
    .from("messages")
    .update(update)
    .eq("channel", s.channel)
    .eq("external_message_id", s.external_message_id)
    .select("id");
  return (res.data ?? []).length > 0;
}
