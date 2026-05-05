// Post-LLM constraint validation. Pure function — no DB.
//
// Runs after the LLM returns a proposed assignment via the
// assign_groups tool. If any rule fails, llm-grouping.ts feeds the
// error list back to the model as a tool_result and asks it to retry.
// After 3 failed retries the route falls back to balance.ts.
//
// M6.0 rules (replaces score-derived leader rules):
//   1. Every enrolled participant assigned exactly once.
//   2. Every group within [group_size_min, group_size_max].
//   3. No two family_of-linked participants in same group.
//   4. Every group has exactly one zu_zhang and at most one fu_zu_zhang.
//   5. Each group's zu_zhang must be a curated 组长 from the roster
//      AND its tier must match the class-required main tier.
//   6. Each group's fu_zu_zhang (if present) must be from the roster
//      AND its tier must match the class-required auxiliary tier.
//   7. Each member's qualification class must match their group's
//      class — UNLESS pinned_group_no overrides it (warning, not
//      hard fail).
//   8. No 特级 / 重点 group has > ceil(class_priority / k_class)
//      priority members (max(fin, inf) ≥ 4 spread).
//   9. All pinned_group_no respected.

import { isPriority, participantToClass, requiredLeaderTiers } from "./types";
import type {
  DraftGroup,
  GroupingConfig,
  GroupingParticipant,
  GroupingZuZhang,
} from "./types";

export type ValidationError = {
  code:
    | "missing_participant"
    | "duplicate_participant"
    | "unknown_participant"
    | "group_too_small"
    | "group_too_large"
    | "family_in_same_group"
    | "conflict_in_same_group"
    | "no_zu_zhang"
    | "multiple_zu_zhang"
    | "too_many_fu_zu_zhang"
    | "zu_zhang_not_in_roster"
    | "zu_zhang_tier_mismatch"
    | "fu_zu_zhang_not_in_roster"
    | "fu_zu_zhang_tier_mismatch"
    | "class_qualification_mismatch"
    | "priority_cluster"
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
  roster: GroupingZuZhang[],
  config: GroupingConfig,
): ValidationResult {
  const errors: ValidationError[] = [];
  const participantById = new Map(
    participants.map((p) => [p.participant_id, p]),
  );
  const rosterByPid = new Map(roster.map((z) => [z.participant_id, z]));

  // Combined enrolment set = regular participants + curated 组长.
  // 组长 are members of their seeded group; everyone else expects
  // exactly one assignment too.
  const expected = new Set([
    ...participants.map((p) => p.participant_id),
    ...roster.map((z) => z.participant_id),
  ]);

  // Rule 1 — set diff (assignment integrity).
  const seen = new Set<string>();
  for (const g of groups) {
    for (const m of g.members) {
      if (!expected.has(m.participant_id)) {
        errors.push({
          code: "unknown_participant",
          group_no: g.group_no,
          region_id: m.region_id ?? undefined,
          detail: `participant ${m.participant_id} not in enrolment list or 组长 roster`,
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
      const p = participantById.get(pid) ?? rosterByPid.get(pid);
      errors.push({
        code: "missing_participant",
        region_id: (p as { region_id?: string | null })?.region_id ?? undefined,
        detail: `participant ${(p as { region_id?: string | null })?.region_id ?? pid} is not assigned to any group`,
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
    const chainsInGroup = new Map<string, string>();
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

  // Rule 3b — conflict-pair split (migration 030). Same hardness as
  // family — admin tagged these as must-not-sit-together.
  const conflictChains = buildConflictChains(participants);
  for (const g of groups) {
    const chainsInGroup = new Map<string, string>();
    for (const m of g.members) {
      const chain = conflictChains.get(m.participant_id);
      if (!chain) continue;
      if (chainsInGroup.has(chain)) {
        const otherRegionId = chainsInGroup.get(chain);
        errors.push({
          code: "conflict_in_same_group",
          group_no: g.group_no,
          region_id: m.region_id ?? undefined,
          detail: `${m.region_id ?? m.participant_id} is conflict-flagged with ${otherRegionId} in group ${g.group_no} — they must be in different groups`,
        });
      } else {
        chainsInGroup.set(chain, m.region_id ?? m.participant_id);
      }
    }
  }

  // Rules 4-6 — role distribution + curated 组长 enforcement.
  for (const g of groups) {
    const zuMembers = g.members.filter((m) => m.role === "zu_zhang");
    const fuMembers = g.members.filter((m) => m.role === "fu_zu_zhang");
    const { main: requiredMain, auxiliary: requiredAux } = requiredLeaderTiers(
      g.group_class,
    );

    if (zuMembers.length === 0) {
      errors.push({
        code: "no_zu_zhang",
        group_no: g.group_no,
        detail: `group ${g.group_no} (${g.group_class}) has no 组长 — exactly one is required`,
      });
    } else if (zuMembers.length > 1) {
      errors.push({
        code: "multiple_zu_zhang",
        group_no: g.group_no,
        detail: `group ${g.group_no} has ${zuMembers.length} 组长 — exactly one is required`,
      });
    } else {
      const zu = zuMembers[0];
      const z = rosterByPid.get(zu.participant_id);
      if (!z) {
        errors.push({
          code: "zu_zhang_not_in_roster",
          group_no: g.group_no,
          region_id: zu.region_id ?? undefined,
          detail: `${zu.region_id ?? zu.participant_id} is seated as 组长 but not in the curated roster — admin must enable 'Serve as 组长' on their enrolment`,
        });
      } else if (z.tier !== requiredMain) {
        errors.push({
          code: "zu_zhang_tier_mismatch",
          group_no: g.group_no,
          region_id: zu.region_id ?? undefined,
          detail: `${g.group_class} group requires a ${requiredMain} 组长; ${zu.region_id ?? zu.participant_id} is ${z.tier}`,
        });
      }
    }

    if (fuMembers.length > 1) {
      errors.push({
        code: "too_many_fu_zu_zhang",
        group_no: g.group_no,
        detail: `group ${g.group_no} has ${fuMembers.length} 副组长 — at most one allowed in the M6.0 model`,
      });
    } else if (fuMembers.length === 1) {
      const fu = fuMembers[0];
      const z = rosterByPid.get(fu.participant_id);
      if (!z) {
        errors.push({
          code: "fu_zu_zhang_not_in_roster",
          group_no: g.group_no,
          region_id: fu.region_id ?? undefined,
          detail: `${fu.region_id ?? fu.participant_id} is seated as 副组长 but not in the curated roster`,
        });
      } else if (z.tier !== requiredAux) {
        errors.push({
          code: "fu_zu_zhang_tier_mismatch",
          group_no: g.group_no,
          region_id: fu.region_id ?? undefined,
          detail: `${g.group_class} group requires a ${requiredAux} 副组长; ${fu.region_id ?? fu.participant_id} is ${z.tier}`,
        });
      }
    }
  }

  // Rule 7 — class-qualification consistency. Pinned participants are
  // exempt (warning surface lives in the audit metadata, not validate).
  for (const g of groups) {
    for (const m of g.members) {
      const p = participantById.get(m.participant_id);
      if (!p) continue; // 组长 entries are skipped — they're seeded by class
      if (p.pinned_group_no != null && p.pinned_group_no === g.group_no) {
        // Pin overrides — soft warning surfaced elsewhere if needed.
        continue;
      }
      const expectedClass = participantToClass(p);
      if (expectedClass !== g.group_class) {
        errors.push({
          code: "class_qualification_mismatch",
          group_no: g.group_no,
          region_id: m.region_id ?? undefined,
          detail: `${m.region_id ?? m.participant_id} (${expectedClass}) placed in ${g.group_class} without a pin — qualification class should drive bucket`,
        });
      }
    }
  }

  // Rule 8 — priority spread within 特级 + 重点.
  for (const cls of ["strategic", "key"] as const) {
    const classGroups = groups.filter((g) => g.group_class === cls);
    if (classGroups.length === 0) continue;
    const totalPriority = classGroups.reduce(
      (acc, g) =>
        acc
        + g.members.filter((m) => {
          const p = participantById.get(m.participant_id);
          return p ? isPriority(p) : false;
        }).length,
      0,
    );
    if (totalPriority === 0) continue;
    const cap = Math.ceil(totalPriority / classGroups.length);
    for (const g of classGroups) {
      const count = g.members.filter((m) => {
        const p = participantById.get(m.participant_id);
        return p ? isPriority(p) : false;
      }).length;
      if (count > cap) {
        errors.push({
          code: "priority_cluster",
          group_no: g.group_no,
          detail: `${cls} group ${g.group_no} has ${count} priority members; cap is ${cap} (total ${totalPriority} across ${classGroups.length} groups)`,
        });
      }
    }
  }

  // Rule 9 — pin respect.
  for (const p of participants) {
    if (p.pinned_group_no == null) continue;
    const placedIn = groups.find((g) =>
      g.members.some((m) => m.participant_id === p.participant_id),
    );
    if (!placedIn) continue; // missing_participant covers this
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
    for (const other of p.family_member_ids) {
      if (other === p.participant_id) continue;
      if (!adj.has(other)) adj.set(other, new Set());
      adj.get(p.participant_id)!.add(other);
      adj.get(other)!.add(p.participant_id);
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

// Mirror of buildFamilyChains for the conflict-pair adjacency.
function buildConflictChains(
  participants: GroupingParticipant[],
): Map<string, string> {
  const adj = new Map<string, Set<string>>();
  for (const p of participants) {
    if (!adj.has(p.participant_id)) adj.set(p.participant_id, new Set());
    for (const other of p.conflict_member_ids) {
      if (other === p.participant_id) continue;
      if (!adj.has(other)) adj.set(other, new Set());
      adj.get(p.participant_id)!.add(other);
      adj.get(other)!.add(p.participant_id);
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
