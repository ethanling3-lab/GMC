import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { validateGrouping } from "./validate";
import type {
  DraftGroup,
  GroupingConfig,
  GroupingParticipant,
  GroupingResult,
} from "./types";

// LLM-driven grouping for table-mode events. claude-opus-4-7, system
// prompt cached with cache_control: ephemeral. The model is given a
// PII-safe view of all enrolled participants (region_id only, no names
// or emails) plus the constraint set, and returns a full assignment via
// the assign_groups tool.
//
// Validation runs server-side after each call. On failure, the error
// list is fed back as a tool_result and the model is asked to retry.
// Max 3 retries; after that the caller falls back to balance.ts.
//
// Mirrors the manual tool-loop pattern from src/lib/inbox/ai/tier1.ts.

const MODEL = "claude-opus-4-7";
const MAX_RETRIES = 3;
const MAX_RESPONSE_TOKENS = 16384;

const SYSTEM_PROMPT = `You assign event participants into seated groups for GMC's bilingual leadership events.

Goal: each group should be DIVERSE — a mix of score levels, regions, motivations, and old vs new students. Avoid clustering high scorers together; the discussion benefits from peer-to-peer learning across levels.

Roles per group:
- Exactly 1 组长 (zu_zhang) — the group leader. MUST be an old student (is_old_student=true) if any old students are available. Pick the highest combined overall+influence score among old students; if no old students in the event at all, pick the highest scoring participant.
- 1 to 2 副组长 (fu_zu_zhang) — deputy leaders. Prefer old students; pick the next 1-2 highest scorers among them. If the group has fewer than 3 old students, just pick 1 fu_zu_zhang.
- All other members = participant.

Hard constraints (the assignment will be rejected if any are violated):
1. Every enrolled participant must be assigned to exactly one group.
2. Every group's size must be in [group_size_min, group_size_max].
3. Family members (linked via family_of_region_id, in either direction or transitively) MUST land in DIFFERENT groups. Spouses especially — they should never end up at the same table.
4. Every group must have exactly 1 zu_zhang and 1-2 fu_zu_zhang.
5. Pinned participants (pinned_group_no set) MUST land in their assigned group_no.

For each group, also write a short bilingual rationale (1-2 sentences each in English and 中文) explaining the group's coherence — who anchors it, what the mix looks like, anything notable.

Use ONLY region_id to refer to participants in your rationale (e.g. "MY007", "SG042"). Never invent names — you don't have any.

Call the assign_groups tool exactly once per turn with your full proposal. If the validator rejects your proposal, you'll receive an error list and must call assign_groups again with a corrected proposal.`;

const ASSIGN_GROUPS_TOOL: Anthropic.Tool = {
  name: "assign_groups",
  description:
    "Submit a complete group assignment for the event. Includes role per member and a bilingual rationale per group. Call exactly once per turn.",
  input_schema: {
    type: "object",
    properties: {
      groups: {
        type: "array",
        items: {
          type: "object",
          properties: {
            group_no: { type: "integer", minimum: 1 },
            rationale_en: { type: "string", maxLength: 600 },
            rationale_cn: { type: "string", maxLength: 600 },
            members: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  region_id: { type: "string" },
                  role: {
                    type: "string",
                    enum: ["zu_zhang", "fu_zu_zhang", "participant"],
                  },
                },
                required: ["region_id", "role"],
              },
              minItems: 1,
            },
          },
          required: ["group_no", "rationale_en", "rationale_cn", "members"],
        },
        minItems: 1,
      },
    },
    required: ["groups"],
  },
};

export type LlmGroupingInput = {
  participants: GroupingParticipant[];
  config: GroupingConfig;
};

export type LlmGroupingOutcome = {
  result: GroupingResult | null;
  retries: number;
  validation_errors: string[];
  latency_ms: number;
  tokens_in: number;
  tokens_out: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  failure_reason: string | null;
};

function getClient(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  return new Anthropic({ apiKey: key });
}

export async function runLlmGrouping(
  input: LlmGroupingInput,
): Promise<LlmGroupingOutcome> {
  const startedAt = Date.now();
  const empty: LlmGroupingOutcome = {
    result: null,
    retries: 0,
    validation_errors: [],
    latency_ms: 0,
    tokens_in: 0,
    tokens_out: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    failure_reason: null,
  };

  const client = getClient();
  if (!client) {
    return { ...empty, failure_reason: "anthropic_not_configured" };
  }
  if (input.participants.length === 0) {
    return { ...empty, failure_reason: "no_participants" };
  }

  // region_id is mandatory for the LLM input — anyone without one would
  // create unresolvable references. Block the LLM path and let the
  // caller fall back to balance.ts (which uses participant_id internally).
  const missingRegion = input.participants.filter((p) => !p.region_id);
  if (missingRegion.length > 0) {
    return {
      ...empty,
      failure_reason: `missing_region_id_count:${missingRegion.length}`,
    };
  }

  // Estimate target k for the prompt: midpoint of allowable range.
  const kMin = Math.ceil(input.participants.length / input.config.group_size_max);
  const kMax = Math.max(
    kMin,
    Math.ceil(input.participants.length / input.config.group_size_min),
  );
  const kTarget = Math.round((kMin + kMax) / 2);

  // Build the participant table once. Used as the user's first turn.
  // family_of_participant_id is resolved to family_of_region_id for the
  // LLM (which only knows region_ids). Only same-event family links are
  // surfaced — out-of-event links are dropped because the LLM can't act
  // on them anyway.
  const regionIdById = new Map(
    input.participants.map((p) => [p.participant_id, p.region_id ?? ""]),
  );
  const participantTable = input.participants.map((p) => ({
    region_id: p.region_id,
    overall: p.overall_score,
    influence: p.influence_score,
    financial: p.financial_score,
    motivation_tag: p.motivation_tag,
    is_old_student: p.is_old_student,
    family_of_region_id: p.family_of_participant_id
      ? regionIdById.get(p.family_of_participant_id) || null
      : null,
    pinned_group_no: p.pinned_group_no,
  }));

  const userTurn = JSON.stringify(
    {
      event: {
        group_size_min: input.config.group_size_min,
        group_size_max: input.config.group_size_max,
        k_target: kTarget,
      },
      participants: participantTable,
    },
    null,
    2,
  );

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userTurn },
  ];

  let tokensIn = 0;
  let tokensOut = 0;
  let cacheReads = 0;
  let cacheCreates = 0;
  let lastErrors: string[] = [];

  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    let resp: Anthropic.Message;
    try {
      resp = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_RESPONSE_TOKENS,
        system: [
          {
            type: "text",
            text: SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        tools: [ASSIGN_GROUPS_TOOL],
        tool_choice: { type: "tool", name: "assign_groups" },
        messages,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return {
        ...empty,
        retries: attempt,
        failure_reason: `anthropic_call_failed:${reason}`,
        latency_ms: Date.now() - startedAt,
        tokens_in: tokensIn,
        tokens_out: tokensOut,
        cache_read_tokens: cacheReads,
        cache_creation_tokens: cacheCreates,
        validation_errors: lastErrors,
      };
    }

    tokensIn += resp.usage.input_tokens;
    tokensOut += resp.usage.output_tokens;
    cacheReads += resp.usage.cache_read_input_tokens ?? 0;
    cacheCreates += resp.usage.cache_creation_input_tokens ?? 0;

    const toolUse = resp.content.find(
      (b): b is Anthropic.ToolUseBlock =>
        b.type === "tool_use" && b.name === "assign_groups",
    );
    if (!toolUse) {
      // Model didn't call the tool — treat as failure but log as a
      // validation error so the retry path tells it what to do next.
      lastErrors = ["model did not call assign_groups; you must call the tool exactly once per turn"];
      messages.push({ role: "assistant", content: resp.content });
      messages.push({
        role: "user",
        content: `Validation failed: ${lastErrors[0]}`,
      });
      continue;
    }

    // Parse the tool input. Map region_id back to participant_id.
    let drafts: DraftGroup[];
    try {
      drafts = parseToolInput(toolUse.input, regionIdById);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      lastErrors = [`tool input parse failed: ${reason}`];
      messages.push({ role: "assistant", content: resp.content });
      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: `Validation failed:\n- ${lastErrors[0]}\n\nCall assign_groups again with corrected output.`,
            is_error: true,
          },
        ],
      });
      continue;
    }

    const validation = validateGrouping(drafts, input.participants, input.config);
    if (validation.valid) {
      return {
        result: {
          strategy: "llm",
          groups: drafts.map((d) => ({
            ...d,
            // Stamp leader_participant_id from the zu_zhang member.
            leader_participant_id:
              d.members.find((m) => m.role === "zu_zhang")?.participant_id ?? null,
          })),
          cushion_assignments: [],
          metadata: { n: input.participants.length, k: drafts.length, retry_count: attempt },
        },
        retries: attempt,
        validation_errors: [],
        latency_ms: Date.now() - startedAt,
        tokens_in: tokensIn,
        tokens_out: tokensOut,
        cache_read_tokens: cacheReads,
        cache_creation_tokens: cacheCreates,
        failure_reason: null,
      };
    }

    // Validation failed — feed errors back and ask for a retry.
    lastErrors = validation.errors.map((e) => `[${e.code}] ${e.detail}`);
    messages.push({ role: "assistant", content: resp.content });
    messages.push({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: `Validation failed:\n- ${lastErrors.join("\n- ")}\n\nCall assign_groups again with corrected output. Address every error above.`,
          is_error: true,
        },
      ],
    });
  }

  return {
    ...empty,
    retries: MAX_RETRIES,
    validation_errors: lastErrors,
    latency_ms: Date.now() - startedAt,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    cache_read_tokens: cacheReads,
    cache_creation_tokens: cacheCreates,
    failure_reason: "max_retries_exceeded",
  };
}

// Parse the Anthropic tool input. Validates shape and resolves region_id
// → participant_id. Throws on shape errors so the caller surfaces them
// to the model on retry.
function parseToolInput(
  raw: unknown,
  regionIdById: Map<string, string>,
): DraftGroup[] {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("tool input is not an object");
  }
  const obj = raw as { groups?: unknown };
  if (!Array.isArray(obj.groups)) {
    throw new Error("tool input missing groups array");
  }

  // Reverse lookup: region_id → participant_id (only for participants
  // in this event).
  const pidByRegionId = new Map<string, string>();
  for (const [pid, rid] of regionIdById) {
    if (rid) pidByRegionId.set(rid, pid);
  }

  const drafts: DraftGroup[] = [];
  for (const g of obj.groups as Array<Record<string, unknown>>) {
    if (typeof g.group_no !== "number") {
      throw new Error(`group missing group_no`);
    }
    if (!Array.isArray(g.members)) {
      throw new Error(`group ${g.group_no} missing members array`);
    }
    const members = (g.members as Array<Record<string, unknown>>).map((m) => {
      const region = String(m.region_id ?? "").trim();
      const role = String(m.role ?? "participant");
      if (!region) {
        throw new Error(`group ${g.group_no} has a member with no region_id`);
      }
      const pid = pidByRegionId.get(region);
      if (!pid) {
        throw new Error(
          `group ${g.group_no} references unknown region_id ${region}`,
        );
      }
      if (
        role !== "zu_zhang"
        && role !== "fu_zu_zhang"
        && role !== "participant"
      ) {
        throw new Error(
          `group ${g.group_no} member ${region} has invalid role ${role}`,
        );
      }
      return {
        participant_id: pid,
        region_id: region,
        role: role as "zu_zhang" | "fu_zu_zhang" | "participant",
      };
    });
    drafts.push({
      group_no: g.group_no,
      leader_participant_id: null, // filled in by caller after validation
      members,
      rationale_en: String(g.rationale_en ?? "").trim(),
      rationale_cn: String(g.rationale_cn ?? "").trim(),
    });
  }
  return drafts;
}
