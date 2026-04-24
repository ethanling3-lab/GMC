import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { createSupabaseServiceClient } from "@/lib/supabase";

// Tier 1 tool surface for the inbox auto-responder.
//
// Two tools by design — lookup_event to ground factual answers, and
// handoff_to_human to escalate anything the assistant can't answer from
// tools alone. Keeping the surface narrow is the whole point of Tier 1:
// less surface = less risk of hallucinated commitments.
//
// Tool names must match the schemas below and the dispatch table at the
// bottom. Handlers return plain text (what Claude sees back as the tool
// result) plus an optional `meta` block that the calling agent uses for
// audit/control (e.g. to detect a handoff and stop the loop).

export const TIER1_TOOLS: Anthropic.Tool[] = [
  {
    name: "lookup_event",
    description:
      "Get public event details — title, dates, venue, description, price — for a specific event. Use this ONLY when the participant asks about the event itself (when/where/what/how much). Required argument: event_slug, the URL-safe identifier of the event (e.g. 'golden-principles-retreat-2026'). If the slug isn't obvious from the participant's message, call handoff_to_human instead of guessing.",
    input_schema: {
      type: "object",
      properties: {
        event_slug: {
          type: "string",
          description:
            "URL-safe event identifier. Must match an events.slug value exactly.",
        },
      },
      required: ["event_slug"],
    },
  },
  {
    name: "handoff_to_human",
    description:
      "Escalate the conversation to a human admin. Call this whenever the question touches the participant's personal enrollment, payment, refund, rejection, VIP status, complaint, emotional distress, OR any question that lookup_event cannot ground. Also call this if the participant explicitly asks for a human. Do not guess — handoff.",
    input_schema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description:
            "Short internal note explaining why handoff is needed. Not shown to the participant.",
        },
      },
      required: ["reason"],
    },
  },
];

export type ToolHandlerResult = {
  /** Returned to Claude as the tool_result content. */
  content: string;
  /** Meta flags the agent loop reads to change control flow. */
  meta?: {
    handoff?: { reason: string };
  };
};

type LookupEventInput = {
  event_slug?: unknown;
};

async function handleLookupEvent(input: LookupEventInput): Promise<ToolHandlerResult> {
  const slug = typeof input.event_slug === "string" ? input.event_slug.trim() : "";
  if (!slug) {
    return {
      content: JSON.stringify({
        error: "missing_event_slug",
        detail: "event_slug is required. Call handoff_to_human if the slug isn't clear from context.",
      }),
    };
  }

  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from("events")
    .select(
      "id, slug, title_en, title_cn, heading_en, heading_cn, sub_heading_en, sub_heading_cn, body_en, body_cn, start_date, end_date, venue, city, country, price, currency, status",
    )
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    return {
      content: JSON.stringify({ error: "lookup_failed", detail: error.message }),
    };
  }
  if (!data) {
    return {
      content: JSON.stringify({
        error: "event_not_found",
        detail: `No event with slug '${slug}'. Consider handoff_to_human.`,
      }),
    };
  }
  // Draft events aren't public yet — don't leak details.
  if (data.status === "draft") {
    return {
      content: JSON.stringify({
        error: "event_not_public",
        detail: `Event '${slug}' is not yet public. Call handoff_to_human.`,
      }),
    };
  }

  return {
    content: JSON.stringify({
      slug: data.slug,
      title_en: data.title_en,
      title_cn: data.title_cn,
      sub_heading_en: data.sub_heading_en,
      sub_heading_cn: data.sub_heading_cn,
      body_en: truncate(data.body_en, 800),
      body_cn: truncate(data.body_cn, 800),
      start_date: data.start_date,
      end_date: data.end_date,
      venue: data.venue,
      city: data.city,
      country: data.country,
      price: data.price,
      currency: data.currency,
      status: data.status,
    }),
  };
}

type HandoffInput = {
  reason?: unknown;
};

function handleHandoff(input: HandoffInput): ToolHandlerResult {
  const reason =
    typeof input.reason === "string" && input.reason.trim()
      ? input.reason.trim().slice(0, 400)
      : "no reason given";
  return {
    content: JSON.stringify({
      ok: true,
      message:
        "Handoff scheduled. Stop responding; the orchestrator will disable AI on this conversation and notify the admin.",
    }),
    meta: { handoff: { reason } },
  };
}

function truncate(s: string | null | undefined, max: number): string | null {
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export async function runTier1Tool(
  name: string,
  input: unknown,
): Promise<ToolHandlerResult> {
  const obj = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case "lookup_event":
      return handleLookupEvent(obj as LookupEventInput);
    case "handoff_to_human":
      return handleHandoff(obj as HandoffInput);
    default:
      return {
        content: JSON.stringify({
          error: "unknown_tool",
          detail: `Tool '${name}' is not available. Call handoff_to_human.`,
        }),
      };
  }
}
