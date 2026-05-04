import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { computeRosterShortfalls } from "./balance";
import { applyCuratedRoles } from "./roles";
import {
  effectiveQualification,
  isPriority,
  participantToClass,
  requiredLeaderTiers,
} from "./types";
import { validateGrouping } from "./validate";
import type {
  DraftGroup,
  GroupClass,
  GroupingConfig,
  GroupingParticipant,
  GroupingResult,
  GroupingZuZhang,
} from "./types";

// LLM-driven grouping for table-mode events. M6.0 rewrite — drops the
// derive-leader prompt; 组长 are pre-seeded into groups by `group_no`
// and `group_class` from the curated roster. The LLM's only job is to
// distribute the remaining participants WITHIN their qualification's
// class, optimising for goal↔dimension matching, priority spread,
// family split, and pin respect.
//
// Validation runs server-side after each call. On failure, the error
// list is fed back as a tool_result and the model is asked to retry.
// Max 3 retries; after that the caller falls back to balance.ts.

const MODEL = "claude-opus-4-7";
const MAX_RETRIES = 3;
const MAX_RESPONSE_TOKENS = 16384;

const SYSTEM_PROMPT = `You assign event participants into seated groups for GMC's bilingual leadership events.

# 4-class group taxonomy

Every group is one of four classes, determined by the qualification of its members:

- **strategic** (特级组) — members are 卓越级+ (potential new students at Excellence level or above, OR Excellence/Strategic old students). Seated front row, dead center facing the stage.
- **key** (重点组) — members are 精英级 (Elite). Seated front row sides OR second row center.
- **growth** (成长组) — members are 成长级 (Rising). Seated middle (excluding front + last rows).
- **maintenance** (维护组) — members are 基础级 (Basic). Seated last row.

# Leader pairings (PRE-SEEDED — do not change)

Each group already has its 组长 (zu_zhang) and 副组长 (fu_zu_zhang) seated by the curator. Pairings per class:

- strategic: 重点感召型 (key_recruitment) main + 感召型 (recruitment) auxiliary
- key:       感召型 (recruitment) main + 维护型 (maintenance) auxiliary
- growth:    维护型 (maintenance) main + 辅助 (auxiliary) auxiliary
- maintenance: 维护型 (maintenance) main + 辅助 (auxiliary) auxiliary

The seeded 组长 + 副组长 are listed in groups_seeded[]. They are already members of their group — do NOT include them again in your output.

# Your job

For each regular participant in participants[], pick a group from groups_seeded[] and add them to that group's members list.

Optimise for:

1. **Class match.** Each participant has a target_class. Place them in a group whose group_class matches it. NEVER move a 卓越级 participant into 成长组 (etc) unless they are explicitly pinned.
2. **Goal ↔ dimension matching.** Each participant declares goal_dimensions[] (ordered, index 0 = primary). Prefer a group whose 组长 dimensions cover the participant's primary goal.
3. **Priority spread.** Participants with is_priority=true (max(financial, influence) ≥ 4) should be evenly distributed across the strategic + key groups — do NOT cluster them.
4. **Family split.** Family-linked participants (each lists family_member_region_ids[] of their direct partners; chains are transitive) MUST land in DIFFERENT groups. Spouses especially — never same table.
5. **Pin respect.** If pinned_group_no is set, the participant MUST land in that exact group_no, even if it pulls them across class. Pin overrides everything.

# Hard constraints (assignment rejected if violated)

- Every regular participant must appear in exactly one group's members list.
- Every group's total size (seeded leaders + your assigned members) must be in [group_size_min, group_size_max].
- No two family-linked participants in the same group.
- All pins respected.

# Rationale

For each group, write a short bilingual rationale (1–2 sentences EN + 中文) explaining: the class, the leader pairing, the dimension coverage, the qualification mix, and any notable decisions (priority spread, family pairs handled).

Use ONLY region_id to refer to participants (e.g. "MY007", "SG042"). Never invent names — you don't have any.

Call the assign_groups tool exactly once per turn with your full proposal. If the validator rejects your proposal, you'll receive an error list and must call assign_groups again with a corrected proposal.`;

const ASSIGN_GROUPS_TOOL: Anthropic.Tool = {
  name: "assign_groups",
  description:
    "Submit a complete group assignment for the event. For each pre-seeded group, list the regular participants you are assigning to it (do NOT re-include the seeded 组长 + 副组长). Includes a bilingual rationale per group. Call exactly once per turn.",
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
              description:
                "Regular participants to add to this group. Do NOT include the seeded 组长 / 副组长 — those are already members. Use region_id values from participants[] only.",
              items: {
                type: "object",
                properties: {
                  region_id: { type: "string" },
                },
                required: ["region_id"],
              },
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
  roster: GroupingZuZhang[];
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

  // Partition the inputs: 组长 are seeded, regular participants are
  // what the LLM must place.
  const rosterPids = new Set(input.roster.map((z) => z.participant_id));
  const regularParticipants = input.participants.filter(
    (p) => !rosterPids.has(p.participant_id),
  );
  if (regularParticipants.length === 0) {
    return { ...empty, failure_reason: "no_regular_participants" };
  }

  // region_id is mandatory for the LLM input — anyone without one would
  // create unresolvable references. Block the LLM path so the caller
  // falls back to balance.ts (which uses participant_id internally).
  const missingRegion = input.participants.filter((p) => !p.region_id);
  if (missingRegion.length > 0) {
    return {
      ...empty,
      failure_reason: `missing_region_id_count:${missingRegion.length}`,
    };
  }
  const rosterMissingRegion = input.roster.filter((z) => !z.region_id);
  if (rosterMissingRegion.length > 0) {
    return {
      ...empty,
      failure_reason: `roster_missing_region_id_count:${rosterMissingRegion.length}`,
    };
  }

  // Compute groups_seeded[] from roster + per-class k. We build the
  // skeleton here so the LLM gets group_no's it can index into; the
  // server is the source of truth for seeding.
  const skeleton = buildGroupSkeleton(regularParticipants, input.roster, input.config);
  if ("error" in skeleton) {
    return { ...empty, failure_reason: skeleton.error };
  }

  const regionIdById = new Map(
    [...input.participants, ...rosterAsParticipants(input.roster)].map((p) => [
      "participant_id" in p ? p.participant_id : "",
      p.region_id ?? "",
    ]),
  );

  // Build the LLM payload: groups_seeded + participants (regular only).
  // leader_grade is informational — the LLM doesn't choose leaders, but
  // can reason about queue position when distributing priority members.
  const groupsSeeded = skeleton.groups.map((g) => ({
    group_no: g.group_no,
    group_class: g.group_class,
    leader: g.main_zu_zhang
      ? {
          region_id: g.main_zu_zhang.region_id,
          tier: g.main_zu_zhang.tier,
          grade: g.main_zu_zhang.grade,
          dimensions: g.main_zu_zhang.dimensions,
        }
      : null,
    auxiliary: g.auxiliary_zu_zhang
      ? {
          region_id: g.auxiliary_zu_zhang.region_id,
          tier: g.auxiliary_zu_zhang.tier,
          grade: g.auxiliary_zu_zhang.grade,
          dimensions: g.auxiliary_zu_zhang.dimensions,
        }
      : null,
  }));

  const participantTable = regularParticipants.map((p) => ({
    region_id: p.region_id,
    qualification: effectiveQualification(p),
    target_class: participantToClass(p),
    is_priority: isPriority(p),
    financial: p.financial_score,
    influence: p.influence_score,
    motivation_tag: p.motivation_tag,
    is_old_student: p.is_old_student,
    goal_dimensions: p.goal_dimensions,
    // Union legacy single-edge column with the multi-edge join table
    // so the LLM sees the full family graph as one list.
    family_member_region_ids: (() => {
      const ids = new Set<string>();
      if (p.family_of_participant_id) ids.add(p.family_of_participant_id);
      for (const o of p.family_member_ids) ids.add(o);
      const regionIds: string[] = [];
      for (const id of ids) {
        const r = regionIdById.get(id);
        if (r) regionIds.push(r);
      }
      return regionIds;
    })(),
    pinned_group_no: p.pinned_group_no,
  }));

  const userTurn = JSON.stringify(
    {
      event: {
        group_size_min: input.config.group_size_min,
        group_size_max: input.config.group_size_max,
      },
      groups_seeded: groupsSeeded,
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
      lastErrors = [
        "model did not call assign_groups; you must call the tool exactly once per turn",
      ];
      messages.push({ role: "assistant", content: resp.content });
      messages.push({
        role: "user",
        content: `Validation failed: ${lastErrors[0]}`,
      });
      continue;
    }

    let drafts: DraftGroup[];
    try {
      drafts = mergeLlmOutputWithSeeds(toolUse.input, skeleton.groups, regionIdById);
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

    const validation = validateGrouping(
      drafts,
      input.participants,
      input.roster,
      input.config,
    );
    if (validation.valid) {
      return {
        result: {
          strategy: "llm",
          groups: drafts,
          cushion_assignments: [],
          metadata: {
            n: input.participants.length,
            k: drafts.length,
            retry_count: attempt,
            roster_shortfalls: skeleton.shortfalls.length > 0 ? skeleton.shortfalls : undefined,
          },
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

// Build the per-class k + seeded leader pairings. Returns the same
// skeleton balance.ts uses, so both algorithms agree on group_no
// numbering + class assignment.
function buildGroupSkeleton(
  regular: GroupingParticipant[],
  roster: GroupingZuZhang[],
  config: GroupingConfig,
): {
  groups: Array<{
    group_no: number;
    group_class: GroupClass;
    main_zu_zhang: GroupingZuZhang | null;
    auxiliary_zu_zhang: GroupingZuZhang | null;
  }>;
  shortfalls: ReturnType<typeof computeRosterShortfalls>;
} | { error: string } {
  const buckets: Record<GroupClass, number> = {
    strategic: 0,
    key: 0,
    growth: 0,
    maintenance: 0,
  };
  for (const p of regular) buckets[participantToClass(p)] += 1;

  const kByClass: Record<GroupClass, number> = {
    strategic: 0,
    key: 0,
    growth: 0,
    maintenance: 0,
  };
  for (const cls of ["strategic", "key", "growth", "maintenance"] as GroupClass[]) {
    if (buckets[cls] === 0) continue;
    kByClass[cls] = Math.ceil(buckets[cls] / config.group_size_max);
  }

  const shortfalls = computeRosterShortfalls(roster, kByClass);

  // Seed greedily: pop main + auxiliary tier 组长 by class. Each tier
  // bucket sorted by grade desc (nulls last) so the highest-graded
  // leader of a tier seeds the first group of its required class.
  const remaining: Record<string, GroupingZuZhang[]> = {
    key_recruitment: [],
    recruitment: [],
    maintenance: [],
    auxiliary: [],
  };
  for (const z of roster) remaining[z.tier].push(z);
  for (const tier of Object.keys(remaining)) {
    remaining[tier].sort((a, b) => (b.grade ?? 0) - (a.grade ?? 0));
  }

  const groups: Array<{
    group_no: number;
    group_class: GroupClass;
    main_zu_zhang: GroupingZuZhang | null;
    auxiliary_zu_zhang: GroupingZuZhang | null;
  }> = [];
  let counter = 0;
  for (const cls of ["strategic", "key", "growth", "maintenance"] as GroupClass[]) {
    const k = kByClass[cls];
    if (k === 0) continue;
    const { main, auxiliary } = requiredLeaderTiers(cls);
    for (let i = 0; i < k; i += 1) {
      counter += 1;
      groups.push({
        group_no: counter,
        group_class: cls,
        main_zu_zhang: remaining[main].shift() ?? null,
        auxiliary_zu_zhang: remaining[auxiliary].shift() ?? null,
      });
    }
  }

  return { groups, shortfalls };
}

// LLM returns regular-member region_ids per group_no. We merge with
// the seeded leader pairings to produce full DraftGroup[].
function mergeLlmOutputWithSeeds(
  raw: unknown,
  seeded: Array<{
    group_no: number;
    group_class: GroupClass;
    main_zu_zhang: GroupingZuZhang | null;
    auxiliary_zu_zhang: GroupingZuZhang | null;
  }>,
  regionIdById: Map<string, string>,
): DraftGroup[] {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("tool input is not an object");
  }
  const obj = raw as { groups?: unknown };
  if (!Array.isArray(obj.groups)) {
    throw new Error("tool input missing groups array");
  }

  const pidByRegionId = new Map<string, string>();
  for (const [pid, rid] of regionIdById) if (rid) pidByRegionId.set(rid, pid);

  const seededByNo = new Map(seeded.map((s) => [s.group_no, s]));

  const drafts: DraftGroup[] = [];
  for (const g of obj.groups as Array<Record<string, unknown>>) {
    if (typeof g.group_no !== "number") {
      throw new Error(`group missing group_no`);
    }
    const seed = seededByNo.get(g.group_no);
    if (!seed) {
      throw new Error(`group ${g.group_no} not in seeded skeleton`);
    }
    if (!Array.isArray(g.members)) {
      throw new Error(`group ${g.group_no} missing members array`);
    }
    const llmMembers = (g.members as Array<Record<string, unknown>>).map((m) => {
      const region = String(m.region_id ?? "").trim();
      if (!region) {
        throw new Error(`group ${g.group_no} has a member with no region_id`);
      }
      const pid = pidByRegionId.get(region);
      if (!pid) {
        throw new Error(
          `group ${g.group_no} references unknown region_id ${region}`,
        );
      }
      return { participant_id: pid, region_id: region };
    });

    // Re-stamp roles by stitching the seeded leader pairing back in.
    const memberRoles = applyCuratedRoles({
      main_zu_zhang: seed.main_zu_zhang,
      auxiliary_zu_zhang: seed.auxiliary_zu_zhang,
      members: llmMembers.map((m) => ({
        participant_id: m.participant_id,
        region_id: m.region_id,
        // Stub the algorithm fields it needs — applyCuratedRoles only
        // reads participant_id + region_id.
        overall_score: null,
        influence_score: null,
        financial_score: null,
        motivation_tag: null,
        is_old_student: false,
        family_of_participant_id: null,
        family_member_ids: [],
        region: null,
        pinned_group_no: null,
        goal_dimensions: [],
        student_qualification_override: null,
      })),
    });

    drafts.push({
      group_no: g.group_no,
      group_class: seed.group_class,
      leader_participant_id: seed.main_zu_zhang?.participant_id ?? null,
      members: memberRoles,
      rationale_en: String(g.rationale_en ?? "").trim(),
      rationale_cn: String(g.rationale_cn ?? "").trim(),
    });
  }
  return drafts;
}

// Treat 组长 roster entries as participants for the regionIdById map
// so we can resolve their family_of_region_id references too.
function rosterAsParticipants(
  roster: GroupingZuZhang[],
): Array<{ participant_id: string; region_id: string | null }> {
  return roster.map((z) => ({
    participant_id: z.participant_id,
    region_id: z.region_id,
  }));
}

