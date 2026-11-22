// Which list a conversation belongs in. Pure — safe on server and client.
//
// The inbox answers one question for staff: who needs a reply from a person?
//
//   needs_reply  the customer spoke last and no one is answering: the AI is
//                off for this chat, or it hasn't replied within the grace
//                period (it failed, was stopped, or hit its daily cap)
//   ai           the AI is looking after this chat
//   waiting      staff replied; the customer hasn't answered yet
//   done         closed
//
// `last_message_at` takes the message's own timestamp on inbound, so "the
// customer spoke last" is last_inbound_at catching up with it. Internal system
// notes don't move last_message_at, so a handoff note still reads as waiting.

export const INBOX_QUEUES = ["needs_reply", "ai", "waiting", "done"] as const;

export type InboxQueue = (typeof INBOX_QUEUES)[number];

export const QUEUE_LABEL: Record<InboxQueue, { en: string; cn: string }> = {
  needs_reply: { en: "Needs reply", cn: "待回复" },
  ai: { en: "AI handling", cn: "AI处理中" },
  waiting: { en: "Waiting", cn: "等客户回复" },
  done: { en: "Done", cn: "已完成" },
};

export const AI_REPLY_GRACE_MS = 2 * 60_000;

export type QueueFields = {
  status: string;
  ai_enabled: boolean;
  last_inbound_at: string | null;
  last_message_at: string | null;
};

export function queueOf(row: QueueFields, now: number = Date.now()): InboxQueue {
  if (row.status === "closed") return "done";
  const inbound = row.last_inbound_at ? Date.parse(row.last_inbound_at) : null;
  const latest = row.last_message_at ? Date.parse(row.last_message_at) : null;
  const customerSpokeLast = inbound !== null && (latest === null || inbound >= latest);
  if (customerSpokeLast) {
    if (!row.ai_enabled) return "needs_reply";
    return now - inbound > AI_REPLY_GRACE_MS ? "needs_reply" : "ai";
  }
  return row.ai_enabled ? "ai" : "waiting";
}
