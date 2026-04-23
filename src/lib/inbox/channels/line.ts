import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  ChannelAdapter,
  ParsedInboundAttachment,
  ParsedInboundMessage,
  ParsedWebhookResult,
  SendMessageInput,
  SendResult,
} from "./adapter";

// LINE Messaging API adapter. Handles:
//   - Webhook signature verification via X-Line-Signature
//     = base64(HMAC-SHA256(body, LINE_CHANNEL_SECRET))
//   - Inbound event parsing (text, image, audio, file, video, sticker)
//   - Media content download (/v2/bot/message/{id}/content)
//   - Outbound push message (/v2/bot/message/push)
//
// Graceful mock fallback when creds are absent, mirroring the WhatsApp adapter.

const LINE_API = "https://api.line.me/v2/bot";
const LINE_CONTENT_API = "https://api-data.line.me/v2/bot";

function isConfigured(): boolean {
  return Boolean(
    process.env.LINE_CHANNEL_SECRET && process.env.LINE_CHANNEL_ACCESS_TOKEN,
  );
}

export function isLineConfigured(): boolean {
  return isConfigured();
}

// =============================================================================
// Verification — X-Line-Signature = base64(HMAC-SHA256(body, channel_secret))
// =============================================================================

async function verifyWebhook(req: Request, rawBody: string): Promise<boolean> {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret) {
    return process.env.LINE_WEBHOOK_ALLOW_UNSIGNED === "1";
  }
  const header = req.headers.get("x-line-signature");
  if (!header) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("base64");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(header, "utf8");
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// =============================================================================
// Inbound parsing
// =============================================================================

type LineEventSource =
  | { type: "user"; userId: string }
  | { type: "group"; groupId: string; userId?: string }
  | { type: "room"; roomId: string; userId?: string };

type LineMessage =
  | { id: string; type: "text"; text: string }
  | { id: string; type: "image"; contentProvider?: { type: string } }
  | { id: string; type: "audio"; duration?: number; contentProvider?: { type: string } }
  | { id: string; type: "video"; duration?: number; contentProvider?: { type: string } }
  | { id: string; type: "file"; fileName: string; fileSize: number }
  | { id: string; type: "sticker"; packageId: string; stickerId: string }
  | { id: string; type: string; [k: string]: unknown };

type LineEvent = {
  type: "message" | "delivery" | "unsend" | "follow" | "unfollow" | string;
  mode?: string;
  timestamp: number;
  source: LineEventSource;
  webhookEventId: string;
  message?: LineMessage;
  replyToken?: string;
  delivery?: { data: string };
};

function parseWebhook(body: unknown): ParsedWebhookResult {
  const messages: ParsedInboundMessage[] = [];
  const statuses: ParsedWebhookResult["statuses"] = [];

  const root = body as { events?: LineEvent[]; destination?: string } | undefined;
  if (!root?.events) return { messages, statuses };

  for (const ev of root.events) {
    if (ev.type !== "message" || !ev.message) continue;

    const identifier = resolveIdentifier(ev.source);
    if (!identifier) continue;

    messages.push(normalizeInbound(ev, ev.message, identifier));
  }
  return { messages, statuses };
}

function resolveIdentifier(src: LineEventSource): string | null {
  if (src.type === "user") return src.userId;
  // Group/room events: we key the thread on the user if present, else the group/room.
  if (src.type === "group") return src.userId ?? `group:${src.groupId}`;
  if (src.type === "room") return src.userId ?? `room:${src.roomId}`;
  return null;
}

function normalizeInbound(
  ev: LineEvent,
  msg: LineMessage,
  identifier: string,
): ParsedInboundMessage {
  const attachments: ParsedInboundAttachment[] = [];
  let bodyText: string | null = null;

  if (msg.type === "text") {
    bodyText = (msg as { text?: unknown }).text != null
      ? String((msg as { text: unknown }).text)
      : null;
  } else if (msg.type === "image") {
    attachments.push({
      media_id: msg.id,
      mime_type: "image/jpeg",
      filename: null,
      caption: null,
      size: null,
    });
  } else if (msg.type === "audio") {
    attachments.push({
      media_id: msg.id,
      mime_type: "audio/m4a",
      filename: null,
      caption: null,
      size: null,
    });
  } else if (msg.type === "video") {
    attachments.push({
      media_id: msg.id,
      mime_type: "video/mp4",
      filename: null,
      caption: null,
      size: null,
    });
  } else if (msg.type === "file" && "fileName" in msg) {
    attachments.push({
      media_id: msg.id,
      mime_type: "application/octet-stream",
      filename: (msg as { fileName: string }).fileName,
      caption: null,
      size: (msg as { fileSize?: number }).fileSize ?? null,
    });
  } else if (msg.type === "sticker") {
    bodyText = `[sticker ${(msg as { packageId?: string }).packageId ?? ""}/${(msg as { stickerId?: string }).stickerId ?? ""}]`;
  }

  return {
    external_event_id: ev.webhookEventId,
    external_thread_id: identifier,
    external_message_id: msg.id,
    identifier,
    body_text: bodyText,
    received_at: ev.timestamp ? new Date(ev.timestamp).toISOString() : null,
    attachments,
    raw: ev as unknown as Record<string, unknown>,
  };
}

// =============================================================================
// Media download — GET /v2/bot/message/{id}/content
// =============================================================================

async function downloadAttachment(
  mediaId: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  if (!isConfigured()) {
    throw new Error("line not configured — cannot download media");
  }
  const res = await fetch(`${LINE_CONTENT_API}/message/${mediaId}/content`, {
    headers: {
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`line media fetch ${res.status}`);
  }
  const mimeType = res.headers.get("content-type") ?? "application/octet-stream";
  const array = await res.arrayBuffer();
  return { buffer: Buffer.from(array), mimeType };
}

// =============================================================================
// Outbound — push message (direct to user id)
// =============================================================================

async function sendMessage(payload: SendMessageInput): Promise<SendResult> {
  if (!isConfigured()) {
    console.log(
      `[line:mock] to=${maskId(payload.to)} text=${(payload.body_text ?? "").slice(0, 40)}`,
    );
    return { mocked: true };
  }

  // LINE doesn't accept templates or attachments the same way WhatsApp does —
  // Wave 2a ships text-only. Media + quick-reply support lands later alongside
  // LINE rich-message templates.
  const messages: Array<Record<string, unknown>> = [];
  if (payload.body_text) {
    messages.push({ type: "text", text: payload.body_text });
  }

  if (messages.length === 0) {
    return { mocked: false, error: "line send requires body_text" };
  }

  try {
    const res = await fetch(`${LINE_API}/message/push`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to: payload.to, messages }),
    });
    if (!res.ok) {
      const text = await res.text();
      return { mocked: false, error: `line ${res.status}: ${text.slice(0, 200)}` };
    }
    // LINE doesn't return a message id on the push endpoint. Use the
    // X-Line-Request-Id header as a stand-in so we still have a unique ref.
    const requestId = res.headers.get("x-line-request-id") ?? undefined;
    return { mocked: false, external_message_id: requestId };
  } catch (err) {
    return { mocked: false, error: err instanceof Error ? err.message : "line_send_failed" };
  }
}

function maskId(id: string): string {
  if (id.length < 6) return "***";
  return id.slice(0, 4) + "…" + id.slice(-2);
}

export const lineAdapter: ChannelAdapter = {
  channel: "line",
  verifyWebhook,
  parseWebhook,
  downloadAttachment,
  sendMessage,
};
