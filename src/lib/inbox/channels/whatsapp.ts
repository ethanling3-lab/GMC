import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  ChannelAdapter,
  ParsedInboundAttachment,
  ParsedInboundMessage,
  ParsedWebhookResult,
  SendMessageInput,
  SendResult,
  UploadMediaResult,
} from "./adapter";

// WhatsApp Cloud API adapter. Handles:
//   - Outbound template + freeform text (v22.0 Graph API)
//   - Webhook signature verification via X-Hub-Signature-256 + APP_SECRET
//   - Inbound message parsing (text, image, audio, document)
//   - Media download by id → Buffer (URL is behind auth + expires)
//
// Graceful fallback when credentials are absent: verify/send operate in
// mocked mode so local dev without Meta verification still round-trips.

const GRAPH_API = "https://graph.facebook.com/v22.0";

function isConfigured(): boolean {
  return Boolean(
    process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN,
  );
}

export function isWhatsAppConfigured(): boolean {
  return isConfigured();
}

// =============================================================================
// Verification — Meta's X-Hub-Signature-256 is HMAC-SHA256(body, APP_SECRET)
// =============================================================================

async function verifyWebhook(req: Request, rawBody: string): Promise<boolean> {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) {
    // Dev mode without creds — treat as valid if mock flag set; otherwise fail-closed.
    return process.env.WHATSAPP_WEBHOOK_ALLOW_UNSIGNED === "1";
  }

  const header = req.headers.get("x-hub-signature-256");
  if (!header) return false;
  const [algo, providedHex] = header.split("=");
  if (algo !== "sha256" || !providedHex) return false;

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(providedHex, "utf8");
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// Verify-token handshake on the initial GET subscribe request. Meta sends
// `hub.mode=subscribe` + `hub.verify_token` + `hub.challenge`. We reply with
// the challenge body iff the token matches WHATSAPP_VERIFY_TOKEN.
export function handleVerifyChallenge(req: Request): Response | null {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode !== "subscribe" || !token || !challenge) return null;
  const expected = process.env.WHATSAPP_VERIFY_TOKEN ?? "";
  if (!expected || token !== expected) {
    return new Response("forbidden", { status: 403 });
  }
  return new Response(challenge, { status: 200 });
}

// =============================================================================
// Inbound parsing
// =============================================================================

type WhatsAppWebhookEntry = {
  id: string;
  changes?: Array<{
    value?: {
      messaging_product?: string;
      metadata?: { phone_number_id?: string; display_phone_number?: string };
      contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
      messages?: WhatsAppInboundMessage[];
      statuses?: WhatsAppStatusUpdate[];
    };
    field?: string;
  }>;
};

type WhatsAppInboundMessage = {
  id: string;
  from: string;                          // E.164 digits without '+'
  timestamp: string;                     // unix seconds
  type: "text" | "image" | "audio" | "document" | "video" | "sticker" | string;
  text?: { body?: string };
  image?: { id?: string; mime_type?: string; caption?: string; sha256?: string };
  audio?: { id?: string; mime_type?: string };
  document?: { id?: string; mime_type?: string; filename?: string; caption?: string };
  video?: { id?: string; mime_type?: string; caption?: string };
  sticker?: { id?: string; mime_type?: string };
};

type WhatsAppStatusUpdate = {
  id: string;                            // message id
  status: "sent" | "delivered" | "read" | "failed";
  timestamp: string;
  recipient_id: string;
  errors?: Array<{ code: number; title?: string; message?: string }>;
};

function parseWebhook(body: unknown): ParsedWebhookResult {
  const messages: ParsedInboundMessage[] = [];
  const statuses: ParsedWebhookResult["statuses"] = [];
  const root = body as { entry?: WhatsAppWebhookEntry[] } | undefined;
  if (!root?.entry) return { messages, statuses };

  for (const entry of root.entry) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      // Inbound messages
      for (const msg of value.messages ?? []) {
        messages.push(normalizeInbound(entry.id, msg));
      }

      // Outbound delivery status
      for (const s of value.statuses ?? []) {
        statuses.push({
          channel: "whatsapp",
          external_message_id: s.id,
          status: s.status,
          error: s.errors?.[0]?.message,
          timestamp: s.timestamp ? new Date(Number(s.timestamp) * 1000).toISOString() : null,
        });
      }
    }
  }
  return { messages, statuses };
}

function normalizeInbound(
  entryId: string,
  msg: WhatsAppInboundMessage,
): ParsedInboundMessage {
  const attachments: ParsedInboundAttachment[] = [];
  let bodyText: string | null = null;

  if (msg.type === "text") {
    bodyText = msg.text?.body ?? null;
  } else if (msg.type === "image" && msg.image?.id) {
    bodyText = msg.image.caption ?? null;
    attachments.push({
      media_id: msg.image.id,
      mime_type: msg.image.mime_type ?? "image/jpeg",
      filename: null,
      caption: msg.image.caption ?? null,
      size: null,
    });
  } else if (msg.type === "audio" && msg.audio?.id) {
    attachments.push({
      media_id: msg.audio.id,
      mime_type: msg.audio.mime_type ?? "audio/ogg",
      filename: null,
      caption: null,
      size: null,
    });
  } else if (msg.type === "document" && msg.document?.id) {
    bodyText = msg.document.caption ?? null;
    attachments.push({
      media_id: msg.document.id,
      mime_type: msg.document.mime_type ?? "application/pdf",
      filename: msg.document.filename ?? null,
      caption: msg.document.caption ?? null,
      size: null,
    });
  } else if (msg.type === "video" && msg.video?.id) {
    bodyText = msg.video.caption ?? null;
    attachments.push({
      media_id: msg.video.id,
      mime_type: msg.video.mime_type ?? "video/mp4",
      filename: null,
      caption: msg.video.caption ?? null,
      size: null,
    });
  }

  // Thread key: WA doesn't have thread ids per se — we thread by sender phone.
  const identifier = normalizeWhatsAppId(msg.from);
  return {
    external_event_id: `${entryId}:${msg.id}`,
    external_thread_id: identifier,
    external_message_id: msg.id,
    identifier,
    body_text: bodyText,
    received_at: msg.timestamp ? new Date(Number(msg.timestamp) * 1000).toISOString() : null,
    attachments,
    raw: msg as unknown as Record<string, unknown>,
  };
}

// WhatsApp wa_id is digits only (e.g. '6591234567'). Normalize to '+6591234567'
// so it matches participants.phone which stores leading '+'.
function normalizeWhatsAppId(waId: string): string {
  const digits = waId.replace(/[^\d]/g, "");
  if (!digits) return waId;
  return `+${digits}`;
}

// =============================================================================
// Media download — two-step: GET /{media_id} → URL, GET URL → bytes
// =============================================================================

async function downloadAttachment(mediaId: string): Promise<{ buffer: Buffer; mimeType: string }> {
  if (!isConfigured()) {
    throw new Error("whatsapp not configured — cannot download media");
  }

  const metaRes = await fetch(`${GRAPH_API}/${mediaId}`, {
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
    cache: "no-store",
  });
  if (!metaRes.ok) {
    throw new Error(`whatsapp media meta ${metaRes.status}`);
  }
  const meta = (await metaRes.json()) as { url?: string; mime_type?: string };
  if (!meta.url) throw new Error("whatsapp media meta missing url");

  const mediaRes = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
    cache: "no-store",
  });
  if (!mediaRes.ok) {
    throw new Error(`whatsapp media fetch ${mediaRes.status}`);
  }
  const array = await mediaRes.arrayBuffer();
  return { buffer: Buffer.from(array), mimeType: meta.mime_type ?? "application/octet-stream" };
}

// =============================================================================
// Outbound — sendMessage. Supports text (freeform, requires 24h session) or
// template (any time, must be pre-approved).
// =============================================================================

async function sendMessage(payload: SendMessageInput): Promise<SendResult> {
  if (!isConfigured()) {
    console.log(
      `[whatsapp:mock] to=${maskPhone(payload.to)} ${payload.template ? `template=${payload.template.name}` : payload.media ? `media=${payload.media.type}:${payload.media.media_id}` : `text=${(payload.body_text ?? "").slice(0, 40)}`}`,
    );
    return { mocked: true };
  }

  const to = payload.to.replace(/^\+/, "");  // API wants digits only

  let body: Record<string, unknown>;
  if (payload.template) {
    body = {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: payload.template.name,
        language: { code: payload.template.language_code },
        components: payload.template.components ?? [],
      },
    };
  } else if (payload.media) {
    // Media send: one attachment per message. body_text becomes the caption
    // (ignored by audio — Meta rejects captions on audio messages).
    const mediaBlock: Record<string, unknown> = { id: payload.media.media_id };
    if (payload.media.type !== "audio" && payload.body_text) {
      mediaBlock.caption = payload.body_text;
    }
    if (payload.media.type === "document" && payload.media.filename) {
      mediaBlock.filename = payload.media.filename;
    }
    body = {
      messaging_product: "whatsapp",
      to,
      type: payload.media.type,
      [payload.media.type]: mediaBlock,
    };
  } else if (payload.body_text) {
    body = {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: payload.body_text },
    };
  } else {
    return { mocked: false, error: "whatsapp send requires body_text, media, or template" };
  }

  try {
    const res = await fetch(
      `${GRAPH_API}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      return { mocked: false, error: `whatsapp ${res.status}: ${text.slice(0, 200)}` };
    }
    const json = (await res.json()) as { messages?: Array<{ id?: string }> };
    return { mocked: false, external_message_id: json.messages?.[0]?.id };
  } catch (err) {
    return { mocked: false, error: err instanceof Error ? err.message : "whatsapp_send_failed" };
  }
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.length < 5) return "***";
  return digits.slice(0, 3) + "*".repeat(Math.max(1, digits.length - 5)) + digits.slice(-2);
}

// =============================================================================
// Outbound media upload — POST bytes to /{phone_id}/media, receive media_id.
// Meta size limits (2025): image 5MB, video 16MB, document 100MB, audio 16MB.
// The inbox-attachments bucket caps at 10MB so we're under the image + audio
// ceilings; document + video have headroom. Type mapping is the caller's
// responsibility (send.ts maps from MIME).
// =============================================================================

async function uploadMedia(
  buffer: Buffer,
  mimeType: string,
  filename: string,
): Promise<UploadMediaResult> {
  if (!isConfigured()) {
    console.log(`[whatsapp:mock] upload mime=${mimeType} bytes=${buffer.byteLength} file=${filename}`);
    return { mocked: true };
  }

  try {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", mimeType);
    form.append(
      "file",
      new Blob([new Uint8Array(buffer)], { type: mimeType }),
      filename,
    );

    const res = await fetch(
      `${GRAPH_API}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/media`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        },
        body: form,
      },
    );
    if (!res.ok) {
      const text = await res.text();
      return { mocked: false, error: `whatsapp media upload ${res.status}: ${text.slice(0, 200)}` };
    }
    const json = (await res.json()) as { id?: string };
    if (!json.id) {
      return { mocked: false, error: "whatsapp media upload missing id" };
    }
    return { mocked: false, media_id: json.id };
  } catch (err) {
    return {
      mocked: false,
      error: err instanceof Error ? err.message : "whatsapp_media_upload_failed",
    };
  }
}

// =============================================================================
// Legacy send-template helper — kept for `src/lib/enrollment-notifications.ts`
// which still calls `sendWhatsAppTemplate` directly. Delegates to sendMessage.
// =============================================================================

export async function sendWhatsAppTemplate(params: {
  to: string;
  template: string;
  languageCode: "zh_CN" | "en_US";
  components?: Array<{ type: "body"; parameters: Array<{ type: "text"; text: string }> }>;
}): Promise<{ mocked: boolean; id?: string; error?: string }> {
  const res = await sendMessage({
    to: params.to,
    template: {
      name: params.template,
      language_code: params.languageCode,
      components: params.components,
    },
  });
  return {
    mocked: res.mocked,
    id: res.external_message_id,
    error: res.error,
  };
}

export const whatsappAdapter: ChannelAdapter = {
  channel: "whatsapp",
  verifyWebhook,
  parseWebhook,
  downloadAttachment,
  sendMessage,
  uploadMedia,
};
