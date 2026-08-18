import "server-only";

// The 24-hour WhatsApp customer service window — ONE predicate, one place.
//
// Before this file the window existed only as a post-mortem: `send.ts` asked
// `isOutsideWindowError(result.error)` AFTER Meta had already rejected the
// message, by substring-matching an error string. So every first message to a
// cold thread cost a guaranteed-failed Graph call and left a FAILED bubble the
// admin had to interpret.
//
// This is deliberately not a method on a conversation object and not inlined
// into send.ts: the composer needs to ask the same question before the admin
// types, and the AI path needs to ask it before it spends a model call. Three
// callers, one answer — the alternative is three drifting copies, which is how
// `language_fluency` ended up resolved four different ways in this codebase.

/** Only WhatsApp has a service window. Email has no such concept. */
export type WindowChannel = "whatsapp" | "email";

export type ConversationWindowRow = {
  last_inbound_at: string | null;
  window_expires_at: string | null;
  window_verified_closed_at: string | null;
  marketing_backoff_until: string | null;
};

export type WindowState =
  | { open: true; reason: "no_window_on_channel" }
  | { open: true; reason: "within_window"; expiresAt: string; msRemaining: number }
  | { open: false; reason: "never_inbound" }
  | { open: false; reason: "expired"; expiredAt: string }
  | { open: false; reason: "verified_closed"; verifiedAt: string }
  | { open: false; reason: "marketing_backoff"; until: string };

/**
 * Can we send a FREE-FORM message on this thread right now?
 *
 * Templates are exempt — a template is the thing that re-opens a closed
 * window — so callers must only consult this for free-form sends.
 *
 * Order matters. Backoff is checked before expiry because it is the more
 * serious refusal: an expired window is re-opened by sending a template, but
 * sending a template into a frequency cap or an opt-out is precisely the
 * retry that damages the quality rating. Reporting "send a template" there
 * would be advice that makes things worse.
 */
export function evaluateWindow(
  channel: WindowChannel,
  row: ConversationWindowRow,
  now: Date = new Date(),
): WindowState {
  if (channel !== "whatsapp") return { open: true, reason: "no_window_on_channel" };

  const t = now.getTime();

  if (row.marketing_backoff_until) {
    const until = new Date(row.marketing_backoff_until);
    if (until.getTime() > t) {
      return { open: false, reason: "marketing_backoff", until: row.marketing_backoff_until };
    }
  }

  // Meta told us this window is shut. Trust the provider over our arithmetic —
  // a missed inbound webhook or a clock skew would otherwise have us cheerfully
  // retrying into a wall. Cleared by mark_conversation_inbound the moment a
  // genuinely newer inbound arrives.
  if (row.window_verified_closed_at) {
    const verified = new Date(row.window_verified_closed_at);
    const lastInbound = row.last_inbound_at ? new Date(row.last_inbound_at) : null;
    if (!lastInbound || lastInbound.getTime() <= verified.getTime()) {
      return { open: false, reason: "verified_closed", verifiedAt: row.window_verified_closed_at };
    }
  }

  if (!row.last_inbound_at || !row.window_expires_at) {
    return { open: false, reason: "never_inbound" };
  }

  const expires = new Date(row.window_expires_at);
  if (expires.getTime() <= t) {
    return { open: false, reason: "expired", expiredAt: row.window_expires_at };
  }

  return {
    open: true,
    reason: "within_window",
    expiresAt: row.window_expires_at,
    msRemaining: expires.getTime() - t,
  };
}

/** Columns evaluateWindow needs — kept next to it so a caller cannot under-select. */
export const WINDOW_COLUMNS =
  "last_inbound_at, window_expires_at, window_verified_closed_at, marketing_backoff_until";

/**
 * Staff-facing explanation. Bilingual to match the admin chrome, and it names
 * the remedy rather than only the problem — "outside the window" tells an
 * admin nothing they can act on.
 */
export function describeWindow(state: WindowState): string | null {
  switch (state.reason) {
    case "no_window_on_channel":
    case "within_window":
      return null;
    case "never_inbound":
      return "This contact has never messaged us · 对方从未发过消息 — only an approved template can open the conversation.";
    case "expired":
      return "The 24-hour reply window has closed · 24 小时回复窗口已关闭 — send an approved template to re-open it.";
    case "verified_closed":
      return "WhatsApp rejected the last free-form message on this thread · WhatsApp 已拒绝自由文本 — send an approved template to re-open it.";
    case "marketing_backoff":
      return "This contact is opted out or frequency-capped · 对方已退订或被限流 — do not retry; retrying damages the number's quality rating.";
  }
}
