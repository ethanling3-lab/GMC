import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { createSupabaseServiceClient } from "@/lib/supabase";

// Admin-facing AI Assist. Three actions, all initiated by the admin from the
// inbox thread drawer:
//   - draftReply    : suggests a reply in the participant's language. Streaming.
//   - summarizeThread: 3-5 bullet summary of the thread so far.
//   - translateText : EN↔CN of free-form text (typically the composer draft).
//
// Privacy: per project rule, anything sent to an external model is tokenized
// to region_id. Names, emails, phones are NEVER included in prompts. The
// participant is referred to as `[participant]` plus their region_id when
// available. Message bodies themselves are user content and pass through —
// redacting them would defeat the point of asking the model to help.
//
// Model: claude-sonnet-4-6. Sonnet is fast/cheap enough for synchronous
// admin-triggered actions; Opus is reserved for the autonomous Tier 1 agent.

const MODEL = "claude-sonnet-4-6";
const MAX_THREAD_MESSAGES = 30;
const MAX_BODY_CHARS = 800;

export type AssistMessage = {
  direction: "inbound" | "outbound";
  sender_type: string;
  body_text: string | null;
  created_at: string;
};

export type AssistContext = {
  conversationId: string;
  channel: string;
  regionId: string | null;
  participantLanguage: "en" | "zh" | "both" | null;
  messages: AssistMessage[];
};

function getClient(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  return new Anthropic({ apiKey: key });
}

export async function loadAssistContext(
  conversationId: string,
): Promise<AssistContext | null> {
  const service = createSupabaseServiceClient();
  const { data: conv } = await service
    .from("conversations")
    .select(
      "id, channel, participant:participants(region_id, language_fluency)",
    )
    .eq("id", conversationId)
    .maybeSingle();
  if (!conv) return null;

  const { data: msgs } = await service
    .from("messages")
    .select("direction, sender_type, body_text, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(MAX_THREAD_MESSAGES);

  const participant = (
    conv as unknown as {
      participant: { region_id: string | null; language_fluency: string | null } | null;
    }
  ).participant;
  const langRaw = participant?.language_fluency ?? null;
  const participantLanguage =
    langRaw === "en" || langRaw === "zh" || langRaw === "both" ? langRaw : null;

  return {
    conversationId,
    channel: (conv as { channel: string }).channel,
    regionId: participant?.region_id ?? null,
    participantLanguage,
    messages: ((msgs ?? []) as AssistMessage[]).reverse(),
  };
}

// -----------------------------------------------------------------------------
// Prompt builders. Tokenized — no names, no email, no phone.
// -----------------------------------------------------------------------------

function formatTranscript(ctx: AssistContext): string {
  const ref = ctx.regionId ? `[participant ${ctx.regionId}]` : "[participant]";
  return ctx.messages
    .filter((m) => (m.body_text ?? "").trim().length > 0)
    .map((m) => {
      const who =
        m.direction === "inbound"
          ? ref
          : m.sender_type === "ai_agent"
            ? "[ai_agent]"
            : "[admin]";
      const body = (m.body_text ?? "").slice(0, MAX_BODY_CHARS).trim();
      return `${who}: ${body}`;
    })
    .join("\n\n");
}

function languageHint(ctx: AssistContext): string {
  switch (ctx.participantLanguage) {
    case "zh":
      return "The participant speaks 中文 — reply in 中文.";
    case "en":
      return "The participant speaks English — reply in English.";
    case "both":
      return "The participant is bilingual — match the language of their most recent message.";
    default:
      return "Detect the language of the participant's most recent message and reply in that language.";
  }
}

// -----------------------------------------------------------------------------
// Draft reply — streaming
// -----------------------------------------------------------------------------

const DRAFT_SYSTEM = `You are an AI assistant helping an admin draft a reply on a customer-service thread for GMC, a bilingual events company. You suggest a reply; the admin reviews and sends.

Rules:
- Output ONLY the reply text — no preamble, no "Here's a draft:", no quoted thread, no signature unless the previous admin messages included one.
- Keep it under 3 short sentences unless the participant asked for more.
- Never invent prices, dates, venues, refund decisions, approvals, or policies. If those are needed, write a holding reply that says the admin will follow up with details, and end with a square-bracketed note like "[ADMIN: confirm price before sending]".
- Never promise refunds, approvals, or waivers. Always defer those to the admin.
- Match the tone of the prior admin replies in this thread if any exist.
- Do not address the participant by name. Use a generic salutation appropriate to the language.`;

export type DraftStream = AsyncIterable<string> & {
  finalize: () => Promise<DraftMeta>;
};

export type DraftMeta = {
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
};

export function streamDraft(ctx: AssistContext): DraftStream | null {
  const client = getClient();
  if (!client) return null;
  if (ctx.messages.length === 0) return null;

  const transcript = formatTranscript(ctx);
  const user = [
    languageHint(ctx),
    "",
    "Thread so far:",
    "---",
    transcript,
    "---",
    "",
    "Draft a single reply for the admin to send next.",
  ].join("\n");

  const startedAt = Date.now();
  let tokensIn = 0;
  let tokensOut = 0;

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 512,
    system: DRAFT_SYSTEM,
    messages: [{ role: "user", content: user }],
  });

  async function* iterator() {
    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        yield event.delta.text;
      }
    }
  }

  return Object.assign(iterator(), {
    finalize: async () => {
      const final = await stream.finalMessage();
      tokensIn = final.usage.input_tokens;
      tokensOut = final.usage.output_tokens;
      return {
        tokensIn,
        tokensOut,
        latencyMs: Date.now() - startedAt,
      };
    },
  });
}

// -----------------------------------------------------------------------------
// Summarize thread — non-streaming
// -----------------------------------------------------------------------------

const SUMMARIZE_SYSTEM = `You are an AI assistant helping an admin triage a customer-service thread quickly. Output a short summary in English (regardless of thread language) so the admin can decide what to do next.

Format strictly:
- One-line opener: who reached out and what they want (one sentence).
- 2-4 bullet points: key facts, requests, or open questions. Each bullet under 15 words.
- Final line starting with "Next:" — the most likely admin action (e.g. "Confirm payment received", "Send venue address", "Escalate to finance").

Rules:
- English output only.
- No filler ("This thread is about...", "In summary..."). Get to the point.
- If the thread has no meaningful content, output "Empty thread — nothing to summarize."`;

export type SummaryResult = {
  summary: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
};

export async function summarizeThread(
  ctx: AssistContext,
): Promise<SummaryResult | null> {
  const client = getClient();
  if (!client) return null;
  if (ctx.messages.length === 0) {
    return {
      summary: "Empty thread — nothing to summarize.",
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: 0,
    };
  }

  const transcript = formatTranscript(ctx);
  const startedAt = Date.now();

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    system: SUMMARIZE_SYSTEM,
    messages: [
      {
        role: "user",
        content: ["Thread:", "---", transcript, "---"].join("\n"),
      },
    ],
  });

  const summary = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  return {
    summary: summary || "(no summary produced)",
    tokensIn: resp.usage.input_tokens,
    tokensOut: resp.usage.output_tokens,
    latencyMs: Date.now() - startedAt,
  };
}

// -----------------------------------------------------------------------------
// Translate text — non-streaming, EN ↔ CN
// -----------------------------------------------------------------------------

const TRANSLATE_SYSTEM = `You are a translator. Translate the user's text between English and Simplified Chinese (中文). Output ONLY the translated text — no labels, no quotes, no explanation. Preserve tone, line breaks, and any placeholders inside curly braces (like {name}).`;

export type TranslateResult = {
  translated: string;
  targetLang: "en" | "zh";
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
};

// Heuristic language detect: presence of CJK chars → text is Chinese, target=en.
function detectTarget(text: string): "en" | "zh" {
  return /[一-鿿]/.test(text) ? "en" : "zh";
}

export async function translateText(
  text: string,
  targetOverride?: "en" | "zh",
): Promise<TranslateResult | null> {
  const client = getClient();
  if (!client) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  const target = targetOverride ?? detectTarget(trimmed);
  const startedAt = Date.now();

  const prompt =
    target === "zh"
      ? `Translate to Simplified Chinese (中文):\n\n${trimmed}`
      : `Translate to English:\n\n${trimmed}`;

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: Math.min(1024, Math.ceil(trimmed.length * 2) + 100),
    system: TRANSLATE_SYSTEM,
    messages: [{ role: "user", content: prompt }],
  });

  const translated = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  return {
    translated,
    targetLang: target,
    tokensIn: resp.usage.input_tokens,
    tokensOut: resp.usage.output_tokens,
    latencyMs: Date.now() - startedAt,
  };
}

// -----------------------------------------------------------------------------
// ai_runs logger — shared by all three actions
// -----------------------------------------------------------------------------

export async function logAssistRun(entry: {
  conversationId: string;
  task: "assist_draft" | "assist_summarize" | "assist_translate";
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  result: Record<string, unknown>;
}): Promise<void> {
  const service = createSupabaseServiceClient();
  await service.from("ai_runs").insert({
    conversation_id: entry.conversationId,
    message_id: null,
    task: entry.task,
    model: MODEL,
    input_tokens: entry.tokensIn,
    output_tokens: entry.tokensOut,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    latency_ms: entry.latencyMs,
    result: entry.result,
  });
}
