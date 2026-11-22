import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAuditLog } from "@/lib/audit";
import { sendAutomatedText } from "./automations";
import {
  parseConsentKeyword,
  type MarketingSource,
  type MarketingStatus,
} from "./marketing-status";

// Who has agreed to receive marketing, and the WhatsApp replies that change it.

const CJK = /[㐀-鿿]/;

const CONFIRMATION = {
  subscribe: {
    en: 'You\'re subscribed to GMC news and event updates. Reply STOP anytime to unsubscribe.',
    zh: "您已订阅 GMC 的最新消息和活动资讯。如需退订，请随时回复“退订”。",
  },
  unsubscribe: {
    en: "You're unsubscribed from GMC marketing messages. You'll still receive important notices about events you've registered for. Reply JOIN to subscribe again.",
    zh: "您已退订 GMC 的推广消息。您仍会收到已报名活动的重要通知。如需重新订阅，请回复“订阅”。",
  },
} as const;

export async function setMarketingStatus(
  service: SupabaseClient,
  args: {
    participantId: string;
    status: MarketingStatus;
    source: MarketingSource;
    actorId: string | null;
  },
): Promise<void> {
  const { participantId, status, source, actorId } = args;
  const { data: before, error: readErr } = await service
    .from("participants")
    .select("marketing_status")
    .eq("id", participantId)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);
  if (!before || before.marketing_status === status) return;

  const { error } = await service
    .from("participants")
    .update({
      marketing_status: status,
      marketing_status_at: new Date().toISOString(),
      marketing_status_source: source,
    })
    .eq("id", participantId);
  if (error) throw new Error(error.message);

  await writeAuditLog({
    actor_id: actorId,
    action: "participant.marketing_status_changed",
    entity: "participants",
    entity_id: participantId,
    before: { marketing_status: before.marketing_status },
    after: { marketing_status: status },
    metadata: { source },
  });
}

/**
 * Handles a message that is just STOP or JOIN (and their Chinese forms).
 * Returns true when it was one, so the welcome and AI stay out of it.
 *
 * The status is saved before the confirmation is attempted: someone who said
 * STOP is unsubscribed even if the reply fails to send. Never throws.
 */
export async function handleConsentKeyword(
  service: SupabaseClient,
  args: { conversationId: string; participantId: string; text: string | null },
): Promise<boolean> {
  const keyword = parseConsentKeyword(args.text);
  if (!keyword) return false;
  try {
    await setMarketingStatus(service, {
      participantId: args.participantId,
      status: keyword === "subscribe" ? "subscribed" : "unsubscribed",
      source: "whatsapp_keyword",
      actorId: null,
    });

    // A first message of STOP shouldn't be followed by a welcome later.
    await service
      .from("conversations")
      .update({ welcome_sent_at: new Date().toISOString() })
      .eq("id", args.conversationId)
      .is("welcome_sent_at", null);

    const copy = CONFIRMATION[keyword];
    const body = CJK.test(args.text ?? "") ? copy.zh : copy.en;
    const status = await sendAutomatedText(service, {
      conversationId: args.conversationId,
      body,
      automation: "consent",
    });
    if (status === "sent") {
      await service
        .from("conversations")
        .update({
          last_message_at: new Date().toISOString(),
          last_message_preview: body.slice(0, 280),
        })
        .eq("id", args.conversationId);
    }
  } catch (err) {
    console.warn("[consent] keyword failed: %s", err instanceof Error ? err.message : err);
  }
  return true;
}

/** Meta says this person opted out: find who the failed message was to. */
export async function unsubscribeFromFailedMessage(
  service: SupabaseClient,
  messageId: string,
): Promise<void> {
  try {
    const { data } = await service
      .from("messages")
      .select("conversation:conversations(participant_id)")
      .eq("id", messageId)
      .maybeSingle();
    const conversation = (data as { conversation?: { participant_id?: string | null } | null } | null)
      ?.conversation;
    if (!conversation?.participant_id) return;
    await setMarketingStatus(service, {
      participantId: conversation.participant_id,
      status: "unsubscribed",
      source: "meta_opt_out",
      actorId: null,
    });
  } catch (err) {
    console.warn("[consent] opt-out failed: %s", err instanceof Error ? err.message : err);
  }
}
