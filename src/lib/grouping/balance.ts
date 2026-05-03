// Deterministic stratified-balanced grouping for table-mode events.
//
// Used as the fallback when LLM grouping (M6.2) fails validation 3× or
// when ANTHROPIC_API_KEY is missing. Also useful for QA — the output is
// fully reproducible across runs given the same input.
//
// Goal: each group is intentionally DIVERSE (mix of score levels +
// regions + old/new students), satisfying these constraints:
//   1. Every group has size in [group_size_min, group_size_max].
//   2. Family-linked participants land in DIFFERENT groups.
//   3. Every group has ≥1 old student (becomes 组长 via roles.ts).
//   4. Pinned participants (enrollments.pinned_group_no) are honored.
//
// Algorithm:
//   Step 0 — pick k groups so all sizes fit in the policy range.
//   Step 1 — seed pinned participants into their assigned groups.
//   Step 2 — bucket the rest by score quartile within their region;
//            round-robin distribute high → low across groups so each
//            group gets a spread of scores AND regions.
//   Step 3 — constraint repair: iteratively swap to satisfy family-split
//            + old-student presence rules. Bounded at 100 swaps.
//   Step 4 — assign roles via roles.pickTableRoles per group.
//   Step 5 — write a plain-English bilingual rationale per group.
//
// Pure function. No DB. Caller persists.

import { pickTableRoles } from "./roles";
import type {
  DraftGroup,
  GroupingConfig,
  GroupingParticipant,
  GroupingResult,
} from "./types";

type WorkingGroup = {
  group_no: number;
  members: GroupingParticipant[];
};

export function balance(
  participants: GroupingParticipant[],
  config: GroupingConfig,
): GroupingResult {
  const n = participants.length;
  if (n === 0) {
    return {
      strategy: "balance",
      groups: [],
      cushion_assignments: [],
      metadata: { n: 0, k: 0 },
    };
  }

  // Step 0 — pick k. Prefer the smallest k whose largest group is ≤ max
  // and whose smallest group is ≥ min. Range: ceil(n/max) … ceil(n/min).
  const kMin = Math.ceil(n / config.group_size_max);
  const kMax = Math.max(kMin, Math.ceil(n / config.group_size_min));
  let k = kMin;
  // Heuristic: pick the k that minimises the difference between the
  // largest and smallest group (most balanced sizes).
  let bestImbalance = Infinity;
  for (let candidate = kMin; candidate <= kMax; candidate += 1) {
    const base = Math.floor(n / candidate);
    const remainder = n % candidate;
    const largest = remainder === 0 ? base : base + 1;
    const smallest = base;
    if (smallest < config.group_size_min) continue;
    if (largest > config.group_size_max) continue;
    const imbalance = largest - smallest;
    if (imbalance < bestImbalance) {
      bestImbalance = imbalance;
      k = candidate;
    }
  }

  const groups: WorkingGroup[] = Array.from({ length: k }, (_, i) => ({
    group_no: i + 1,
    members: [],
  }));

  // Step 1 — pinned participants.
  const remaining: GroupingParticipant[] = [];
  for (const p of participants) {
    if (p.pinned_group_no != null
        && p.pinned_group_no >= 1
        && p.pinned_group_no <= k) {
      groups[p.pinned_group_no - 1].members.push(p);
    } else {
      remaining.push(p);
    }
  }

  // Step 2 — stratified-balanced round-robin. Sort by composite score
  // descending; within score ties shuffle by region for cross-regional
  // mixing. Then deal out one-by-one across groups with capacity.
  const ranked = [...remaining].sort((a, b) => {
    const sa = compositeScore(a);
    const sb = compositeScore(b);
    if (sb !== sa) return sb - sa;
    // Tiebreak by region then region_id for determinism.
    const ra = a.region ?? "";
    const rb = b.region ?? "";
    if (ra !== rb) return ra.localeCompare(rb);
    return (a.region_id ?? "").localeCompare(b.region_id ?? "");
  });

  // Least-loaded-first distribution: pick the group with fewest current
  // members each round. This naturally balances around any pre-seeded
  // pinned members so a group that started with 1 pinned ends up with
  // the same final size as the others.
  for (const p of ranked) {
    let target = groups[0];
    for (const g of groups) {
      if (g.members.length < target.members.length) target = g;
    }
    target.members.push(p);
  }

  // Step 3 — constraint repair pass.
  const familyChains = buildFamilyChains(participants);
  let swapsDone = 0;
  const maxSwaps = 100;
  let stable = false;
  while (!stable && swapsDone < maxSwaps) {
    stable = true;

    // 3a. Family split: scan each group; if two members share a chain,
    // swap one out with someone from the largest other group.
    for (const g of groups) {
      const seenChains = new Map<string, GroupingParticipant>();
      for (const p of g.members) {
        const chainKey = familyChains.get(p.participant_id);
        if (!chainKey) continue;
        const partner = seenChains.get(chainKey);
        if (partner && partner.participant_id !== p.participant_id) {
          // Swap p out with someone unrelated from the largest group.
          const target = pickSwapTarget(groups, g.group_no, p, familyChains);
          if (target) {
            applySwap(groups, p, target);
            stable = false;
            swapsDone += 1;
            break;
          }
        } else {
          seenChains.set(chainKey, p);
        }
      }
      if (!stable) break;
    }
    if (!stable) continue;

    // 3b. Old-student presence: every group needs ≥1 OS. If a group
    // has none, swap an OS in from the most-OS-saturated group.
    for (const g of groups) {
      const hasOs = g.members.some((m) => m.is_old_student);
      if (hasOs) continue;
      // Find another group with ≥2 OS we can pull from.
      const donor = groups
        .filter((og) => og.group_no !== g.group_no)
        .map((og) => ({ og, osCount: og.members.filter((m) => m.is_old_student).length }))
        .sort((a, b) => b.osCount - a.osCount)[0];
      if (!donor || donor.osCount < 2) continue;
      const osPick = donor.og.members.find((m) => m.is_old_student && m.pinned_group_no == null);
      if (!osPick) continue;
      // Swap with a non-OS, non-pinned member of g.
      const swapOut = g.members.find((m) => !m.is_old_student && m.pinned_group_no == null);
      if (!swapOut) continue;
      applySwap(groups, osPick, swapOut);
      stable = false;
      swapsDone += 1;
      break;
    }
  }

  // Step 4 + 5 — assign roles + write rationale.
  const drafts: DraftGroup[] = groups.map((g) => {
    const roles = pickTableRoles(g.members);
    const roleByPid = new Map(roles.map((r) => [r.participant_id, r.role]));
    const leader = g.members.find(
      (m) => roleByPid.get(m.participant_id) === "zu_zhang",
    );
    return {
      group_no: g.group_no,
      leader_participant_id: leader?.participant_id ?? null,
      members: g.members.map((m) => ({
        participant_id: m.participant_id,
        region_id: m.region_id,
        role: roleByPid.get(m.participant_id) ?? "participant",
      })),
      rationale_en: writeRationaleEn(g.members, leader),
      rationale_cn: writeRationaleCn(g.members, leader),
    };
  });

  return {
    strategy: "balance",
    groups: drafts,
    cushion_assignments: [],
    metadata: { n, k: groups.length },
  };
}

function compositeScore(p: GroupingParticipant): number {
  const overall = p.overall_score ?? 5;
  const influence = p.influence_score ?? 5;
  const financial = p.financial_score ?? 5;
  return overall * 2 + influence + financial;
}

// Walk the family_of edges to assign a stable chain-key to every
// participant in the same connected component. Two participants share
// a chain iff they're in the same component — which is exactly the
// "must split" relationship per spec.
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
    // BFS the component.
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
  // Strip lone-node chains (no family link → no constraint).
  const filtered = new Map<string, string>();
  for (const [pid, chain] of chains) {
    const linked = (adj.get(pid)?.size ?? 0) > 0;
    if (linked) filtered.set(pid, chain);
  }
  return filtered;
}

function pickSwapTarget(
  groups: WorkingGroup[],
  excludeGroupNo: number,
  movingOut: GroupingParticipant,
  familyChains: Map<string, string>,
): GroupingParticipant | null {
  const movingChain = familyChains.get(movingOut.participant_id);
  // Sort other groups by size descending so we draw from the most-loaded.
  const candidates = groups
    .filter((g) => g.group_no !== excludeGroupNo)
    .sort((a, b) => b.members.length - a.members.length);
  for (const g of candidates) {
    for (const m of g.members) {
      if (m.pinned_group_no != null) continue;
      // Don't swap into our group if m would join its own family chain.
      if (movingChain && familyChains.get(m.participant_id) === movingChain) continue;
      // Don't pull a member that would create a NEW family conflict in
      // movingOut's old group.
      const otherChain = familyChains.get(m.participant_id);
      if (otherChain) {
        const otherInOldGroup = groups[excludeGroupNo - 1].members.some(
          (cur) =>
            cur.participant_id !== movingOut.participant_id
            && familyChains.get(cur.participant_id) === otherChain,
        );
        if (otherInOldGroup) continue;
      }
      return m;
    }
  }
  return null;
}

function applySwap(
  groups: WorkingGroup[],
  a: GroupingParticipant,
  b: GroupingParticipant,
): void {
  const ga = groups.find((g) => g.members.some((m) => m.participant_id === a.participant_id));
  const gb = groups.find((g) => g.members.some((m) => m.participant_id === b.participant_id));
  if (!ga || !gb || ga === gb) return;
  ga.members = ga.members.filter((m) => m.participant_id !== a.participant_id);
  gb.members = gb.members.filter((m) => m.participant_id !== b.participant_id);
  ga.members.push(b);
  gb.members.push(a);
}

function writeRationaleEn(
  members: GroupingParticipant[],
  leader: GroupingParticipant | undefined,
): string {
  const oldCount = members.filter((m) => m.is_old_student).length;
  const newCount = members.length - oldCount;
  const regionMix = new Set(members.map((m) => m.region).filter(Boolean));
  const leaderId = leader?.region_id ?? "—";
  return `Mixed-region group with host ${leaderId}. ${oldCount} old students + ${newCount} new students across ${regionMix.size} region(s).`;
}

function writeRationaleCn(
  members: GroupingParticipant[],
  leader: GroupingParticipant | undefined,
): string {
  const oldCount = members.filter((m) => m.is_old_student).length;
  const newCount = members.length - oldCount;
  const regionMix = new Set(members.map((m) => m.region).filter(Boolean));
  const leaderId = leader?.region_id ?? "—";
  return `多地区混合小组，由 ${leaderId} 担任组长。包含 ${oldCount} 位旧生与 ${newCount} 位新生，跨 ${regionMix.size} 个地区。`;
}
