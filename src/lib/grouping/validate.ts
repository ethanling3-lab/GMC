// Post-LLM constraint validation. Pure function — no DB.
//
// Runs after the LLM returns a proposed assignment via the
// assign_groups tool. If any rule fails, llm-grouping.ts feeds the
// error list back to the model as a tool_result and asks it to retry.
// After 3 failed retries the route falls back to balance.ts.
//
// Six rules (plan order):
//   1. Every enrolled participant assigned exactly once.
//   2. Every group within [group_size_min, group_size_max].
//   3. No two family_of-linked participants in same group.
//   4. Every group has 1 zu_zhang (must be is_old_student=true if any
//      old students present in the event).
//   5. Every group has 1-2 fu_zu_zhang (relaxed if group has <3 OS).
//   6. All pinned_group_no respected.

import type {
  DraftGroup,
  GroupingConfig,
  GroupingParticipant,
} from "./types";

export type ValidationError = {
  code:
    | "missing_participant"
    | "duplicate_participant"
    | "unknown_participant"
    | "group_too_small"
    | "group_too_large"
    | "family_in_same_group"
    | "no_zu_zhang"
    | "multiple_zu_zhang"
    | "zu_zhang_not_old_student"
    | "no_fu_zu_zhang"
    | "too_many_fu_zu_zhang"
    | "pin_violated";
  group_no?: number;
  region_id?: string;
  detail: string;
};

export type ValidationResult = {
  valid: boolean;
  errors: ValidationError[];
};

export function validateGrouping(
  groups: DraftGroup[],
  participants: GroupingParticipant[],
  config: GroupingConfig,
): ValidationResult {
  const errors: ValidationError[] = [];
  const participantById = new Map(
    participants.map((p) => [p.participant_id, p]),
  );

  // Rule 1 — set diff (participant assignment integrity).
  const expected = new Set(participants.map((p) => p.participant_id));
  const seen = new Set<string>();
  for (const g of groups) {
    for (const m of g.members) {
      if (!expected.has(m.participant_id)) {
        errors.push({
          code: "unknown_participant",
          group_no: g.group_no,
          region_id: m.region_id ?? undefined,
          detail: `participant ${m.participant_id} not in enrolment list`,
        });
        continue;
      }
      if (seen.has(m.participant_id)) {
        errors.push({
          code: "duplicate_participant",
          group_no: g.group_no,
          region_id: m.region_id ?? undefined,
          detail: `participant ${m.region_id ?? m.participant_id} assigned to multiple groups`,
        });
      }
      seen.add(m.participant_id);
    }
  }
  for (const pid of expected) {
    if (!seen.has(pid)) {
      const p = participantById.get(pid);
      errors.push({
        code: "missing_participant",
        region_id: p?.region_id ?? undefined,
        detail: `participant ${p?.region_id ?? pid} is not assigned to any group`,
      });
    }
  }

  // Rule 2 — group size bounds.
  for (const g of groups) {
    if (g.members.length < config.group_size_min) {
      errors.push({
        code: "group_too_small",
        group_no: g.group_no,
        detail: `group ${g.group_no} has ${g.members.length} members but minimum is ${config.group_size_min}`,
      });
    }
    if (g.members.length > config.group_size_max) {
      errors.push({
        code: "group_too_large",
        group_no: g.group_no,
        detail: `group ${g.group_no} has ${g.members.length} members but maximum is ${config.group_size_max}`,
      });
    }
  }

  // Rule 3 — family split.
  const familyChains = buildFamilyChains(participants);
  for (const g of groups) {
    const chainsInGroup = new Map<string, string>(); // chain_root → first region_id
    for (const m of g.members) {
      const chain = familyChains.get(m.participant_id);
      if (!chain) continue;
      if (chainsInGroup.has(chain)) {
        const otherRegionId = chainsInGroup.get(chain);
        errors.push({
          code: "family_in_same_group",
          group_no: g.group_no,
          region_id: m.region_id ?? undefined,
          detail: `${m.region_id ?? m.participant_id} shares a family link with ${otherRegionId} in group ${g.group_no} — they must be in different groups`,
        });
      } else {
        chainsInGroup.set(chain, m.region_id ?? m.participant_id);
      }
    }
  }

  // Rules 4 + 5 — role distribution.
  const anyOldStudents = participants.some((p) => p.is_old_student);
  for (const g of groups) {
    const zuZhangCount = g.members.filter((m) => m.role === "zu_zhang").length;
    const fuZuZhangCount = g.members.filter((m) => m.role === "fu_zu_zhang").length;
    const oldStudentMembers = g.members.filter((m) => {
      const p = participantById.get(m.participant_id);
      return p?.is_old_student;
    });

    if (zuZhangCount === 0) {
      errors.push({
        code: "no_zu_zhang",
        group_no: g.group_no,
        detail: `group ${g.group_no} has no 组长 (zu_zhang) — exactly one is required`,
      });
    } else if (zuZhangCount > 1) {
      errors.push({
        code: "multiple_zu_zhang",
        group_no: g.group_no,
        detail: `group ${g.group_no} has ${zuZhangCount} 组长 — exactly one is required`,
      });
    } else if (anyOldStudents) {
      // The single zu_zhang must be an old student if any are present
      // in the event at all.
      const zuMember = g.members.find((m) => m.role === "zu_zhang")!;
      const zuParticipant = participantById.get(zuMember.participant_id);
      const groupHasOs = oldStudentMembers.length > 0;
      if (groupHasOs && !zuParticipant?.is_old_student) {
        errors.push({
          code: "zu_zhang_not_old_student",
          group_no: g.group_no,
          region_id: zuMember.region_id ?? undefined,
          detail: `group ${g.group_no} 组长 ${zuMember.region_id ?? zuMember.participant_id} should be an old student (group has ${oldStudentMembers.length} available)`,
        });
      }
    }

    if (fuZuZhangCount === 0) {
      errors.push({
        code: "no_fu_zu_zhang",
        group_no: g.group_no,
        detail: `group ${g.group_no} has no 副组长 (fu_zu_zhang) — at least one is required`,
      });
    } else if (fuZuZhangCount > 2) {
      errors.push({
        code: "too_many_fu_zu_zhang",
        group_no: g.group_no,
        detail: `group ${g.group_no} has ${fuZuZhangCount} 副组长 — at most two allowed`,
      });
    }
  }

  // Rule 6 — pin respect.
  for (const p of participants) {
    if (p.pinned_group_no == null) continue;
    const placedIn = groups.find((g) =>
      g.members.some((m) => m.participant_id === p.participant_id),
    );
    if (!placedIn) continue; // already covered by missing_participant
    if (placedIn.group_no !== p.pinned_group_no) {
      errors.push({
        code: "pin_violated",
        group_no: placedIn.group_no,
        region_id: p.region_id ?? undefined,
        detail: `${p.region_id ?? p.participant_id} pinned to group ${p.pinned_group_no} but landed in group ${placedIn.group_no}`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// Same family-chain walker as balance.ts. Duplicated rather than
// imported to keep this validator a pure dependency-free leaf module.
function buildFamilyChains(
  participants: GroupingParticipant[],
): Map<string, string> {
  const adj = new Map<string, Set<string>>();
  for (const p of participants) {
    if (!adj.has(p.participant_id)) adj.set(p.participant_id, new Set());
    if (p.family_of_participant_id) {
      const a = p.participant_id;
      const b = p.family_of_participant_id;
      if (!adj.has(b)) adj.set(b, new Set());
      adj.get(a)!.add(b);
      adj.get(b)!.add(a);
    }
  }
  const chains = new Map<string, string>();
  for (const p of participants) {
    if (chains.has(p.participant_id)) continue;
    const root = p.participant_id;
    const queue = [root];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (chains.has(cur)) continue;
      chains.set(cur, root);
      for (const neigh of adj.get(cur) ?? []) {
        if (!chains.has(neigh)) queue.push(neigh);
      }
    }
  }
  const filtered = new Map<string, string>();
  for (const [pid, chain] of chains) {
    if ((adj.get(pid)?.size ?? 0) > 0) filtered.set(pid, chain);
  }
  return filtered;
}
