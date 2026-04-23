import "server-only";

// Channel adapter interface. One file per channel (whatsapp, line, email)
// implements this. The inbox ingest + send pipelines are channel-agnostic
// and delegate to whichever adapter matches `channel`.
//
// Verification lives inside the adapter — routes stay thin. Media download
// returns a Buffer the ingest pipeline writes to `inbox-attachments`.

export type ParsedInboundMessage = {
  external_event_id: string;         // event-level id for webhook_events dedupe
  external_thread_id: string;         // stable per (channel, participant)
  external_message_id: string;        // provider's message id
  /** The raw phone/user-id/email on the other side of the thread. */
  identifier: string;
  /** Pre-normalized to E.164 (WhatsApp), user id (LINE), lowercase email. */
  body_text: string | null;
  received_at: string | null;         // ISO8601 from provider, if given
  attachments: ParsedInboundAttachment[];
  /** Provider-specific raw fields for debugging / future use. */
  raw: Record<string, unknown>;
};

export type ParsedInboundAttachment = {
  /** Provider-specific media id — handed to downloadAttachment(). */
  media_id: string;
  mime_type: string | null;
  filename: string | null;
  caption: string | null;
  /** Approximate byte size if the provider reports one. */
  size: number | null;
};

export type SendResult = {
  /** true when creds missing — pipeline still persists message but marks mocked. */
  mocked: boolean;
  /** Provider message id, stamped into messages.external_message_id on success. */
  external_message_id?: string;
  error?: string;
};

export type ChannelAdapter = {
  channel: "whatsapp" | "line" | "email";

  /** Webhook signature verification. Returns true on valid sig. */
  verifyWebhook(req: Request, rawBody: string): Promise<boolean>;

  /**
   * Parse a verified webhook body into zero or more inbound messages.
   * Providers deliver events that may not be messages (status updates,
   * delivery receipts, etc.) — those are returned as non-message events
   * so the ingest can update delivery_status without creating a message.
   */
  parseWebhook(body: unknown): ParsedWebhookResult;

  /**
   * Download a media attachment by its provider id. Returns Buffer + MIME.
   * Ingest persists this into `inbox-attachments` storage. Provider URLs
   * expire fast so callers must download synchronously.
   */
  downloadAttachment(mediaId: string): Promise<{ buffer: Buffer; mimeType: string }>;

  /**
   * Send an outbound message. Implementations may accept different payload
   * shapes (WhatsApp templates + free-form, LINE text/image). Keep payload
   * loose here; the `send.ts` caller validates per-channel.
   */
  sendMessage(payload: SendMessageInput): Promise<SendResult>;

  /**
   * WhatsApp-style providers require a separate media upload step: POST the
   * bytes to the provider, receive a provider-scoped media id, then reference
   * it in a subsequent sendMessage. Optional because channels that send media
   * via URL (email, LINE image) can skip this step.
   */
  uploadMedia?(buffer: Buffer, mimeType: string, filename: string): Promise<UploadMediaResult>;
};

export type SendMessageInput = {
  to: string;                         // channel identifier
  /** Freeform text body. For media sends, this becomes the media caption. */
  body_text?: string;
  /** WhatsApp-only: pre-uploaded media send. One media per message. */
  media?: {
    media_id: string;
    type: "image" | "document" | "audio" | "video";
    filename?: string;
  };
  /** WhatsApp-only: template send. */
  template?: {
    name: string;
    language_code: "zh_CN" | "en_US";
    components?: unknown[];
  };
};

export type UploadMediaResult = {
  /** true when creds missing — caller should flag the message as mocked. */
  mocked: boolean;
  media_id?: string;
  error?: string;
};

export type ParsedWebhookResult = {
  /** Inbound messages that should create or append to a conversation. */
  messages: ParsedInboundMessage[];
  /** Delivery-status updates for prior outbound messages. */
  statuses: Array<{
    channel: "whatsapp" | "line" | "email";
    external_message_id: string;
    status: "sent" | "delivered" | "read" | "failed";
    error?: string;
    timestamp: string | null;
  }>;
};
