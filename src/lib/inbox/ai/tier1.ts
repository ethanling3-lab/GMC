import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";
import { getAdapter, type ChannelKey } from "../channels";
import { TIER1_TOOLS, runTier1Tool } from "./tools";

// Tier 1 AI responder — narrow-scope WhatsApp chatbot that answers public
// event questions and handoffs everything else. Runs a manual Claude tool-
// use loop so we can (a) intercept handoff_to_human to flip the thread off
// AI, (b) log to ai_runs, and (c) only send a message when Claude returns
// actual text (not on tool errors, not on max-iteration exhaustion).
//
// Model: claude-opus-4-7 per project default. Swap to claude-haiku-4-5 by
// editing MODEL if cost/latency becomes an issue — Tier 1's scope is simple
// enough Haiku handles it well.

const MODEL = "claude-opus-4-7";
const MAX_ITERATIONS = 4;
const MAX_RESPONSE_TOKENS = 1024;

const SYSTEM_PROMPT = `You are GMC's WhatsApp AI assistant. GMC runs Dr Wu's bilingual leadership events.

Scope: answer ONLY public event information — dates, venue, price, description. Anything else: handoff_to_human.

Language: match the participant's exactly (English or 中文). Never switch unprompted.

Rules:
- State only facts returned by lookup_event. Never quote a price, date, venue, or policy from memory. If the tool doesn't return it, handoff_to_human.
- Never commit to approval, rejection, refund, waiver, or payment terms. Always handoff_to_human for those.
- If the participant sounds upset, confused, or unclear after one clarifying question, handoff_to_human.
- Keep replies under 3 sentences unless the participant explicitly asked for more.
- On your FIRST reply in a fresh conversation, end with: "— GMC AI assistant. Say 'talk to a person' anytime." Translate to 中文 if the participant is using 中文 ("— GMC AI 助手。如需联系人工客服，请回复'联系人工'。").
- If the participant says "talk to a person", "speak with someone", "human", "联系人工", "客服", "人工" or similar — call handoff_to_human immediately with reason "participant requested human".
- If the participant's message doesn't reference a specific event you can identify, ask ONE short clarifying question OR handoff_to_human. Do not speculate about which event they mean.`;

export type Tier1Input = {
  conversationId: string;
  messageId: string; // the inbound message that triggered this run
  participantLanguage: "en" | "zh" | null;
  inboundText: string | null;
};

export type Tier1Result = {
  status: "replied" | "handoff" | "skipped" | "error";
  reason: string | null;
};

function getClient(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  return new Anthropic({ apiKey: key });
}

function buildUserTurn(input: Tier1Input, isFirstReply: boolean): string {
  const lang = input.participantLanguage === "zh" ? "zh (中文)" : "en";
  const firstNote = isFirstReply
    ? "This is your first reply in this conversation — include the AI-assistant disclosure line at the end."
    : "You have already disclosed yourself as an AI earlier in this thread; do not repeat the disclosure.";
  return [
    `Participant language: ${lang}`,
    firstNote,
    "---",
    "Participant message:",
    input.inboundText ?? "(no text)",
  ].join("\n");
}

export async function runTier1Reply(input: Tier1Input): Promise<Tier1Result> {
  const client = getClient();
  if (!client) {
    await logAiRun({
      conversationId: input.conversationId,
      messageId: input.messageId,
      task: "tier1_reply",
      model: MODEL,
      latencyMs: 0,
      result: { status: "skipped", reason: "anthropic_not_configured" },
    });
    return { status: "skipped", reason: "anthropic_not_configured" };
  }

  if (!input.inboundText || !input.inboundText.trim()) {
    await logAiRun({
      conversationId: input.conversationId,
      messageId: input.messageId,
      task: "tier1_reply",
      model: MODEL,
      latencyMs: 0,
      result: { status: "skipped", reason: "empty_inbound" },
    });
    return { status: "skipped", reason: "empty_inbound" };
  }

  const service = createSupabaseServiceClient();

  // Detect first reply: look for any prior outbound with sender_type='ai_agent'
  // on this conversation. First-reply means "first AI reply" — humans replying
  // before AI is enabled doesn't count as AI disclosure.
  const { count: priorAi } = await service
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", input.conversationId)
    .eq("sender_type", "ai_agent")
    .limit(1);
  const isFirstReply = !priorAi || priorAi === 0;

  const startedAt = Date.now();
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: buildUserTurn(input, isFirstReply) },
  ];

  let tokensIn = 0;
  let tokensOut = 0;
  let cacheReads = 0;
  let cacheCreates = 0;
  let handoffReason: string | null = null;

  try {
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      const resp = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_RESPONSE_TOKENS,
        system: [
          {
            type: "text",
            text: SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        tools: TIER1_TOOLS,
        messages,
      });

      tokensIn += resp.usage.input_tokens;
      tokensOut += resp.usage.output_tokens;
      cacheReads += resp.usage.cache_read_input_tokens ?? 0;
      cacheCreates += resp.usage.cache_creation_input_tokens ?? 0;

      if (resp.stop_reason === "end_turn") {
        const text = extractText(resp.content);
        if (handoffReason) {
          // Tool said "handoff" already — even if Claude also returned text,
          // don't send it; the handoff flow below takes over.
          break;
        }
        if (!text.trim()) {
          await failAndHandoff(
            service,
            input,
            "empty_text_response",
            startedAt,
            { tokensIn, tokensOut, cacheReads, cacheCreates },
          );
          return { status: "error", reason: "empty_text_response" };
        }
        await sendAiReply(service, input.conversationId, text.trim());
        await writeAuditLog({
          actor_id: null,
          action: "inbox.ai_replied",
          entity: "conversations",
          entity_id: input.conversationId,
          metadata: {
            message_id: input.messageId,
            model: MODEL,
            iterations: iter + 1,
            tokens_in: tokensIn,
            tokens_out: tokensOut,
            cache_read: cacheReads,
          },
        });
        await logAiRun({
          conversationId: input.conversationId,
          messageId: input.messageId,
          task: "tier1_reply",
          model: MODEL,
          latencyMs: Date.now() - startedAt,
          tokensIn,
          tokensOut,
          cacheReads,
          cacheCreates,
          result: { status: "replied", iterations: iter + 1, reply_preview: text.slice(0, 200) },
        });
        return { status: "replied", reason: null };
      }

      if (resp.stop_reason !== "tool_use") {
        await failAndHandoff(
          service,
          input,
          `unexpected_stop_reason:${resp.stop_reason ?? "null"}`,
          startedAt,
          { tokensIn, tokensOut, cacheReads, cacheCreates },
        );
        return { status: "error", reason: `unexpected_stop_reason:${resp.stop_reason}` };
      }

      // Append the assistant turn so the loop preserves context.
      messages.push({ role: "assistant", content: resp.content });

      // Collect tool_use blocks, run each, append tool_result as a single user turn.
      const toolUses = resp.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const ran = await runTier1Tool(tu.name, tu.input);
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: ran.content,
        });
        if (ran.meta?.handoff) {
          handoffReason = ran.meta.handoff.reason;
        }
      }
      messages.push({ role: "user", content: toolResults });

      // If the model called handoff_to_human, we can break early without
      // forcing another round-trip — the orchestrator disables the thread.
      if (handoffReason) break;
    }

    if (handoffReason) {
      await handoffConversation(service, input.conversationId, handoffReason);
      await logAiRun({
        conversationId: input.conversationId,
        messageId: input.messageId,
        task: "tier1_reply",
        model: MODEL,
        latencyMs: Date.now() - startedAt,
        tokensIn,
        tokensOut,
        cacheReads,
        cacheCreates,
        result: { status: "handoff", reason: handoffReason },
      });
      return { status: "handoff", reason: handoffReason };
    }

    // Max iterations hit without a terminal turn — safest is to handoff.
    await failAndHandoff(
      service,
      input,
      "max_iterations_without_end_turn",
      startedAt,
      { tokensIn, tokensOut, cacheReads, cacheCreates },
    );
    return { status: "error", reason: "max_iterations" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failAndHandoff(service, input, `exception:${message}`, startedAt, {
      tokensIn,
      tokensOut,
      cacheReads,
      cacheCreates,
    });
    return { status: "error", reason: message };
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

async function failAndHandoff(
  service: ReturnType<typeof createSupabaseServiceClient>,
  input: Tier1Input,
  reason: string,
  startedAt: number,
  usage: { tokensIn: number; tokensOut: number; cacheReads: number; cacheCreates: number },
): Promise<void> {
  await handoffConversation(service, input.conversationId, `tier1_error:${reason}`);
  await logAiRun({
    conversationId: input.conversationId,
    messageId: input.messageId,
    task: "tier1_reply",
    model: MODEL,
    latencyMs: Date.now() - startedAt,
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
    cacheReads: usage.cacheReads,
    cacheCreates: usage.cacheCreates,
    result: { status: "error", reason },
  });
}

async function handoffConversation(
  service: ReturnType<typeof createSupabaseServiceClient>,
  conversationId: string,
  reason: string,
): Promise<void> {
  // Flip AI off + bump status so it lands in the admin queue.
  await service
    .from("conversations")
    .update({ ai_enabled: false, status: "pending" })
    .eq("id", conversationId);

  await writeAuditLog({
    actor_id: null,
    action: "inbox.ai_handoff",
    entity: "conversations",
    entity_id: conversationId,
    metadata: { reason },
  });
}

type AiRunLog = {
  conversationId: string;
  messageId: string;
  task: string;
  model: string;
  latencyMs: number;
  tokensIn?: number;
  tokensOut?: number;
  cacheReads?: number;
  cacheCreates?: number;
  result: Record<string, unknown>;
};

async function logAiRun(entry: AiRunLog): Promise<void> {
  const service = createSupabaseServiceClient();
  await service.from("ai_runs").insert({
    conversation_id: entry.conversationId,
    message_id: entry.messageId,
    task: entry.task,
    model: entry.model,
    input_tokens: entry.tokensIn ?? 0,
    output_tokens: entry.tokensOut ?? 0,
    cache_read_tokens: entry.cacheReads ?? 0,
    cache_creation_tokens: entry.cacheCreates ?? 0,
    latency_ms: entry.latencyMs,
    result: entry.result,
  });
}

// -----------------------------------------------------------------------------
// Send an AI-authored reply. Mirrors the shape of send.ts sendSingle but
// stamps sender_type='ai_agent' + sender_admin_id=null so the thread visually
// distinguishes bot turns from admin turns. Templates + media aren't part of
// Tier 1 — text only.
// -----------------------------------------------------------------------------

async function sendAiReply(
  service: ReturnType<typeof createSupabaseServiceClient>,
  conversationId: string,
  bodyText: string,
): Promise<void> {
  const { data: conv, error: convErr } = await service
    .from("conversations")
    .select("id, channel, external_thread_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (convErr || !conv) {
    throw new Error(
      `tier1: conversation load failed: ${convErr?.message ?? "not_found"}`,
    );
  }
  const channel = conv.channel as ChannelKey;
  const adapter = getAdapter(channel);

  const { data: pending, error: pendingErr } = await service
    .from("messages")
    .insert({
      conversation_id: conversationId,
      direction: "outbound",
      channel,
      sender_type: "ai_agent",
      sender_admin_id: null,
      body_text: bodyText,
      delivery_status: "pending",
      created_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (pendingErr || !pending) {
    throw new Error(`tier1: message insert failed: ${pendingErr?.message}`);
  }

  const result = await adapter
    .sendMessage({
      to: conv.external_thread_id as string,
      body_text: bodyText,
    })
    .catch((err) => ({
      mocked: false,
      error: err instanceof Error ? err.message : "send_threw",
    }));

  const success = !result.error && "external_message_id" in result;
  const newStatus: "sent" | "failed" | "pending" = success
    ? "sent"
    : result.mocked
      ? "pending"
      : "failed";

  const update: Record<string, unknown> = {
    delivery_status: newStatus,
    error_message: result.error ?? null,
  };
  if (success && "external_message_id" in result) {
    update.external_message_id = result.external_message_id ?? null;
    update.sent_at = new Date().toISOString();
  }
  await service.from("messages").update(update).eq("id", pending.id);

  if (newStatus !== "failed") {
    await service
      .from("conversations")
      .update({
        last_message_at: new Date().toISOString(),
        last_message_preview: bodyText.slice(0, 280),
      })
      .eq("id", conversationId);
  }
}
