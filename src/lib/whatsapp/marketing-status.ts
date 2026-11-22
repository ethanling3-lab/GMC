// Marketing permission: shared labels and the WhatsApp reply keywords.
// Pure — safe on server and client.

export const MARKETING_STATUSES = ["not_asked", "subscribed", "unsubscribed"] as const;

export type MarketingStatus = (typeof MARKETING_STATUSES)[number];

export type MarketingSource =
  | "registration"
  | "whatsapp_keyword"
  | "meta_opt_out"
  | "admin"
  | "merge"
  | "email_link";

export const MARKETING_STATUS_LABEL: Record<MarketingStatus, { en: string; cn: string }> = {
  not_asked: { en: "Not asked", cn: "未询问" },
  subscribed: { en: "Subscribed", cn: "已订阅" },
  unsubscribed: { en: "Unsubscribed", cn: "已退订" },
};

const SUBSCRIBE = new Set(["join", "subscribe", "订阅"]);
const UNSUBSCRIBE = new Set(["stop", "unsubscribe", "退订", "取消订阅"]);

/**
 * The whole message must be the keyword. "Please don't stop the class" or
 * "how do I join?" are questions for a person or the AI, not a consent change.
 */
export function parseConsentKeyword(text: string | null): "subscribe" | "unsubscribe" | null {
  if (!text) return null;
  const bare = text
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (SUBSCRIBE.has(bare)) return "subscribe";
  if (UNSUBSCRIBE.has(bare)) return "unsubscribe";
  return null;
}

/** When two records merge, a "no" from either one always wins. */
export function mergedMarketingStatus(a: MarketingStatus, b: MarketingStatus): MarketingStatus {
  if (a === "unsubscribed" || b === "unsubscribed") return "unsubscribed";
  if (a === "subscribed" || b === "subscribed") return "subscribed";
  return "not_asked";
}
