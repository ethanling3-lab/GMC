import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// What the WhatsApp AI knows beyond the customer's latest message: approved
// FAQs, upcoming public events, and the recent conversation.
//
// Privacy: no names, emails or phone numbers are added here. GMC's template
// messages contain names and payment links, so they appear only as "GMC sent a
// notice", and contact details are scrubbed from the remaining history.

const HISTORY_MESSAGES = 8;
const HISTORY_BODY_CHARS = 400;
const MAX_EVENTS = 20;

export type AiContext = { knowledge: string; history: string };

function scrub(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, "[link]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\+?\d[\d\s-]{6,}\d/g, "[number]");
}

async function loadFaqBlock(service: SupabaseClient): Promise<string> {
  const { data: settings, error: settingsErr } = await service
    .from("whatsapp_automations")
    .select("faqs_enabled")
    .eq("id", true)
    .maybeSingle();
  if (settingsErr || !settings?.faqs_enabled) return "";

  const { data, error } = await service
    .from("whatsapp_faqs")
    .select("question, answer_en, answer_zh")
    .order("created_at", { ascending: true })
    .limit(100);
  if (error || !data?.length) return "";

  const rows = (data as Array<{ question: string; answer_en: string | null; answer_zh: string | null }>)
    .map((f) =>
      [`Q: ${f.question}`, f.answer_en ? `A (English): ${f.answer_en}` : null, f.answer_zh ? `A (中文): ${f.answer_zh}` : null]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
  return `GMC-approved FAQs. You may answer general questions from these, in addition to lookup_event. Keep the meaning exact and reply in the participant's language. If only the other language's answer exists, translate it faithfully. These state general policy only: never apply one to a person's own case or promise an outcome. Hand off for anything they don't clearly cover.\n\n${rows}`;
}

async function loadEventsBlock(service: SupabaseClient): Promise<string> {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore" }).format(new Date());
  const { data, error } = await service
    .from("events")
    .select("slug, title_en, title_cn, start_date, end_date, city")
    .eq("status", "open")
    .gte("start_date", today)
    .order("start_date", { ascending: true })
    .limit(MAX_EVENTS);
  if (error || !data?.length) return "";

  const rows = (data as Array<Record<string, string | null>>)
    .map((e) =>
      `- slug: ${e.slug} | ${[e.title_en, e.title_cn].filter(Boolean).join(" / ")} | ${e.start_date ?? "date to be confirmed"}${e.end_date ? ` to ${e.end_date}` : ""}${e.city ? ` | ${e.city}` : ""}`,
    )
    .join("\n");
  return `Upcoming public events. Use this list to work out which event someone means, or to tell them what's coming up. Call lookup_event with the slug before stating a venue or price.\n\n${rows}`;
}

async function loadHistory(
  service: SupabaseClient,
  conversationId: string,
  currentMessageId: string,
): Promise<string> {
  const { data, error } = await service
    .from("messages")
    .select("id, direction, sender_type, body_text, template_name, ai_tags")
    .eq("conversation_id", conversationId)
    .neq("id", currentMessageId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_MESSAGES);
  if (error || !data?.length) return "";

  return (data as Array<{
    direction: string;
    sender_type: string;
    body_text: string | null;
    template_name: string | null;
    ai_tags: { automation?: string } | null;
  }>)
    .reverse()
    .flatMap((m) => {
      // Staff-only system notes must not reach the model.
      if (m.sender_type === "system" && !m.ai_tags?.automation) return [];
      if (m.direction === "outbound" && m.template_name) return ["[GMC]: (sent an official notice)"];
      const body = scrub((m.body_text ?? "").trim()).slice(0, HISTORY_BODY_CHARS);
      if (!body) return [];
      const who = m.direction === "inbound" ? "[participant]" : m.sender_type === "ai_agent" ? "[assistant]" : "[GMC]";
      return [`${who}: ${body}`];
    })
    .join("\n");
}

/** Never throws: missing context must not stop the AI from answering. */
export async function loadAiContext(
  service: SupabaseClient,
  conversationId: string,
  currentMessageId: string,
): Promise<AiContext> {
  const safe = (p: Promise<string>) => p.catch(() => "");
  const [faqs, events, history] = await Promise.all([
    safe(loadFaqBlock(service)),
    safe(loadEventsBlock(service)),
    safe(loadHistory(service, conversationId, currentMessageId)),
  ]);
  return { knowledge: [faqs, events].filter(Boolean).join("\n\n---\n\n"), history };
}
