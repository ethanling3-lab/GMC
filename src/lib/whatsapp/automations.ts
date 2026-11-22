import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAuditLog } from "@/lib/audit";
import { getAdapter, type ChannelKey } from "@/lib/inbox/channels";
import {
  evaluateWindow,
  WINDOW_COLUMNS,
  type ConversationWindowRow,
  type WindowChannel,
} from "@/lib/inbox/window";
import type { WhatsAppAutomations } from "./automations-types";

// Automatic WhatsApp messages admins configure on /admin/whatsapp.

export async function loadWhatsAppAutomations(
  service: SupabaseClient,
): Promise<WhatsAppAutomations | null> {
  const { data, error } = await service
    .from("whatsapp_automations")
    .select("welcome_enabled, welcome_en, welcome_zh")
    .eq("id", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as WhatsAppAutomations | null) ?? null;
}

/**
 * Sends one automatic text inside the 24-hour window and records it in the
 * thread. sender_type "system" with no external id is a staff-only note, so
 * the `automation` tag is what tells the thread to draw a real outbound bubble.
 * Doesn't move the conversation cursor: only the caller knows whether this
 * message actually answered the customer (see inbox/queue.ts).
 */
export async function sendAutomatedText(
  service: SupabaseClient,
  args: { conversationId: string; body: string; automation: "welcome" | "consent" },
): Promise<"sent" | "pending" | "failed" | "skipped"> {
  const { data: conv, error: convErr } = await service
    .from("conversations")
    .select(`id, channel, external_thread_id, ${WINDOW_COLUMNS}`)
    .eq("id", args.conversationId)
    .maybeSingle();
  if (convErr || !conv) return "skipped";
  const row = conv as unknown as ConversationWindowRow & {
    channel: string;
    external_thread_id: string;
  };
  if (row.channel !== "whatsapp") return "skipped";
  if (!evaluateWindow(row.channel as WindowChannel, row).open) return "skipped";

  const { data: pending, error: insertErr } = await service
    .from("messages")
    .insert({
      conversation_id: args.conversationId,
      direction: "outbound",
      channel: row.channel,
      sender_type: "system",
      body_text: args.body,
      ai_tags: { automation: args.automation },
      delivery_status: "pending",
    })
    .select("id")
    .single();
  if (insertErr || !pending) {
    console.warn("[automation] message insert failed: %s", insertErr?.message);
    return "failed";
  }

  const adapter = getAdapter(row.channel as ChannelKey);
  const result = await adapter
    .sendMessage({ to: row.external_thread_id, body_text: args.body })
    .catch((err) => ({
      mocked: false,
      error: err instanceof Error ? err.message : "send_threw",
    }));
  const success = !result.error && "external_message_id" in result;
  const status = success ? "sent" : result.mocked ? "pending" : "failed";

  await service
    .from("messages")
    .update({
      delivery_status: status,
      error_message: result.error ?? null,
      ...(success && "external_message_id" in result
        ? { external_message_id: result.external_message_id ?? null, sent_at: new Date().toISOString() }
        : {}),
    })
    .eq("id", pending.id);
  return status;
}

const CJK = /[㐀-鿿]/;

// A message that only says hello. The welcome already answers it, so the AI
// stays quiet rather than sending a second greeting straight after.
const GREETING =
  /^(hi|hii+|hello|helo|hey|hai|good (morning|afternoon|evening)|你好|您好|嗨|哈喽|哈囉|早安|早上好|午安|下午好|晚上好|在吗|在嗎)( there| gmc)?$/;

function isGreetingOnly(text: string | null): boolean {
  if (!text) return false;
  const bare = text
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return GREETING.test(bare);
}

/**
 * Sends the welcome on someone's first contact, once. Returns true when the
 * welcome fully answers their message (they only said hello), so the caller
 * can skip the AI reply.
 *
 * Never throws: a welcome that fails must not lose or retry the inbound message.
 *
 * It only moves the conversation's last-message cursor in that greeting case.
 * Otherwise the customer's question is still unanswered, and bumping the cursor
 * would take them out of Needs reply (see inbox/queue.ts).
 */
export async function sendWelcomeIfFirstContact(
  service: SupabaseClient,
  args: { conversationId: string; inboundText: string | null },
): Promise<boolean> {
  try {
    const { conversationId, inboundText } = args;

    const settings = await loadWhatsAppAutomations(service);
    if (!settings?.welcome_enabled) return false;

    const { data: conv, error: convErr } = await service
      .from("conversations")
      .select(
        `id, channel, external_thread_id, welcome_sent_at, ${WINDOW_COLUMNS}, participant:participants(language_fluency)`,
      )
      .eq("id", conversationId)
      .maybeSingle();
    if (convErr || !conv) return false;
    const row = conv as unknown as ConversationWindowRow & {
      channel: string;
      external_thread_id: string;
      welcome_sent_at: string | null;
      participant: { language_fluency: string | null } | null;
    };
    if (row.channel !== "whatsapp" || row.welcome_sent_at) return false;
    if (!evaluateWindow(row.channel as WindowChannel, row).open) return false;

    // GMC already wrote to them first (a notice or broadcast): they aren't new.
    const { count: priorOutbound } = await service
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversationId)
      .eq("direction", "outbound")
      .neq("sender_type", "system");
    const firstContact = !priorOutbound;

    // Claim either way, so this is only ever decided once per conversation.
    const { data: claimed } = await service
      .from("conversations")
      .update({ welcome_sent_at: new Date().toISOString() })
      .eq("id", conversationId)
      .is("welcome_sent_at", null)
      .select("id");
    if (!claimed?.length || !firstContact) return false;

    const useChinese = inboundText
      ? CJK.test(inboundText)
      : row.participant?.language_fluency === "cn";
    const body = useChinese ? settings.welcome_zh : settings.welcome_en;

    const status = await sendAutomatedText(service, {
      conversationId,
      body,
      automation: "welcome",
    });

    await writeAuditLog({
      actor_id: null,
      action: "whatsapp.welcome_sent",
      entity: "conversations",
      entity_id: conversationId,
      metadata: { status, language: useChinese ? "zh" : "en" },
    });

    if (status !== "sent" || !isGreetingOnly(inboundText)) return false;

    await service
      .from("conversations")
      .update({
        last_message_at: new Date().toISOString(),
        last_message_preview: body.slice(0, 280),
      })
      .eq("id", conversationId);
    return true;
  } catch (err) {
    console.warn("[welcome] failed: %s", err instanceof Error ? err.message : err);
    return false;
  }
}
