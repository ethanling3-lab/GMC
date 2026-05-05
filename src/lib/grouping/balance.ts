// Class-bucketed grouping for table-mode events. M6.0 rewrite — replaces
// the score-derived leader model with the curated 组长 + 4-class
// (特级 / 重点 / 成长 / 维护) taxonomy from migration 022.
//
// Used as the deterministic fallback when LLM grouping (M6.2) fails
// validation 3× or when ANTHROPIC_API_KEY is missing. Also used as the
// reference implementation against which the LLM's output is validated.
//
// Pipeline:
//   1. Bucket participants by class (effectiveQualification → group_class).
//   2. Compute k per class = ceil(class_n / group_size_max).
//   3. Validate the curated 组长 roster covers the per-class
//      leader-tier pairing requirements. Surface shortfalls; proceed
//      anyway with whichever 组长 are available (degraded mode).
//   4. Seed each group within each class with one main 组长 + one
//      auxiliary 组长 (per requiredLeaderTiers(class)).
//   5. Distribute regular participants WITHIN their class:
//      Phase A — dimension match (primary goal vs 组长 dimensions).
//      Phase B — priority spread (特级 + 重点 only — even-distribute
//                participants with max(fin, inf) ≥ 4).
//      Phase C — family split (no two family-linked participants in
//                the same group).
//      Phase D — pin respect (overrides A-C even if it pulls them
//                across class — admin's call).
//      Phase E — old-student mix (no group is 100% new students if
//                old students remain available in the class).
//   6. Generate plain-English bilingual rationale per group.
//
// Pure function. No DB. Caller persists.

import { applyCuratedRoles } from "./roles";
import {
  GROUP_CLASS_LABEL,
  GROWTH_DIMENSION_LABEL,
  ZU_ZHANG_TIER_LABEL,
  isPriority,
  participantToClass,
  requiredLeaderTiers,
} from "./types";
import type {
  DraftGroup,
  GroupClass,
  GroupingConfig,
  GroupingParticipant,
  GroupingResult,
  GroupingZuZhang,
  GrowthDimension,
  RosterShortfall,
  ZuZhangTier,
} from "./types";

type WorkingGroup = {
  group_no: number;
  group_class: GroupClass;
  main_zu_zhang: GroupingZuZhang | null;
  auxiliary_zu_zhang: GroupingZuZhang | null;
  members: GroupingParticipant[];
};

const CLASS_ORDER: GroupClass[] = ["strategic", "key", "growth", "maintenance"];

export function balance(
  participants: GroupingParticipant[],
  roster: GroupingZuZhang[],
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

  // 组长 are seeded into groups; they must NOT also be distributed as
  // regular members. Partition the participants list against the roster.
  const rosterPids = new Set(roster.map((z) => z.participant_id));
  const regularParticipants = participants.filter(
    (p) => !rosterPids.has(p.participant_id),
  );

  // Step 1 — bucket regular participants by class. Pinned participants
  // also bucket by class first; the pin is honored in Phase D below.
  const buckets: Record<GroupClass, GroupingParticipant[]> = {
    strategic: [],
    key: [],
    growth: [],
    maintenance: [],
  };
  for (const p of regularParticipants) {
    const cls = participantToClass(p);
    buckets[cls].push(p);
  }

  // Step 1b — pre-validate the curated roster against per-class demand.
  // Compute provisional k per class, identify surplus 组长 (those with
  // tiers that don't match any class's required tier), demote them to
  // regular participants in 'growth' so they're seated as members.
  // Each group seats up to 2 curated 组长 (main + auxiliary) PLUS
  // group_size_max regular members, so the per-class group count is
  // computed off the regular-member capacity = group_size_max - 2.
  // Floor at 1 to avoid divide-by-zero when admin sets group_size_max
  // to 2 or smaller.
  const regularCapacity = Math.max(1, config.group_size_max - 2);
  const provisionalK: Record<GroupClass, number> = {
    strategic: 0,
    key: 0,
    growth: 0,
    maintenance: 0,
  };
  for (const cls of CLASS_ORDER) {
    if (buckets[cls].length === 0) continue;
    provisionalK[cls] = Math.ceil(buckets[cls].length / regularCapacity);
  }
  const tierDemand: Record<ZuZhangTier, number> = {
    key_recruitment: 0,
    recruitment: 0,
    maintenance: 0,
    auxiliary: 0,
  };
  for (const cls of CLASS_ORDER) {
    const k = provisionalK[cls];
    if (k === 0) continue;
    const { main, auxiliary } = requiredLeaderTiers(cls);
    tierDemand[main] += k;
    tierDemand[auxiliary] += k;
  }
  const tierHave: Record<ZuZhangTier, number> = {
    key_recruitment: 0,
    recruitment: 0,
    maintenance: 0,
    auxiliary: 0,
  };
  for (const z of roster) tierHave[z.tier] += 1;
  // Surplus per tier = max(0, have - demand). Demote surplus 组长 to
  // regular members in 'growth' (safe middle bucket). Each surplus
  // participant counts toward k_growth so they get a seat. Demote the
  // LOWEST-graded leaders so the strongest ones stay in the seeding
  // queue.
  const surplusPids = new Set<string>();
  for (const tier of Object.keys(tierHave) as ZuZhangTier[]) {
    const surplus = Math.max(0, tierHave[tier] - tierDemand[tier]);
    if (surplus === 0) continue;
    const pool = roster
      .filter((z) => z.tier === tier)
      .slice()
      .sort((a, b) => (b.grade ?? 0) - (a.grade ?? 0));
    for (let i = pool.length - surplus; i < pool.length; i += 1) {
      const z = pool[i];
      surplusPids.add(z.participant_id);
      buckets.growth.push({
        participant_id: z.participant_id,
        region_id: z.region_id,
        overall_score: null,
        influence_score: null,
        financial_score: null,
        motivation_tag: null,
        is_old_student: false,
        family_of_participant_id: null,
        family_member_ids: [],
        region: null,
        pinned_group_no: null,
        goal_dimensions: z.dimensions,
        student_qualification_override: null,
        energy_profile: null,
        language_fluency: null,
        conflict_member_ids: [],
      });
    }
  }
  // Filter the curated roster down to non-surplus.
  const seatedRoster = roster.filter((z) => !surplusPids.has(z.participant_id));

  // Step 2 — compute final k per class using the regular-member
  // capacity (max - 2 for the seeded leader pair). Empty classes get 0.
  const kByClass: Record<GroupClass, number> = {
    strategic: 0,
    key: 0,
    growth: 0,
    maintenance: 0,
  };
  for (const cls of CLASS_ORDER) {
    const classN = buckets[cls].length;
    if (classN === 0) continue;
    kByClass[cls] = Math.ceil(classN / regularCapacity);
  }

  // Step 3 — validate curated roster against per-class requirements.
  const shortfalls = computeRosterShortfalls(roster, kByClass);

  // Step 4 — seed groups within each class with main + auxiliary 组长.
  // Build a working set of 组长 we haven't placed yet (each 组长 can
  // only be at one table). Walk classes in order.
  const remainingByTier = bucketRosterByTier(seatedRoster);
  const groups: WorkingGroup[] = [];
  let groupCounter = 0;
  for (const cls of CLASS_ORDER) {
    const k = kByClass[cls];
    if (k === 0) continue;
    const { main, auxiliary } = requiredLeaderTiers(cls);
    for (let i = 0; i < k; i += 1) {
      groupCounter += 1;
      const mainPick = popPreferringDimensionSpread(
        remainingByTier,
        main,
        groups.filter((g) => g.group_class === cls),
      );
      const auxPick = popPreferringDimensionSpread(
        remainingByTier,
        auxiliary,
        // Spread auxiliary against the main we just seeded if we have one.
        mainPick ? [{ ...emptyWorkingGroupShape(cls, mainPick) }] : [],
      );
      groups.push({
        group_no: groupCounter,
        group_class: cls,
        main_zu_zhang: mainPick,
        auxiliary_zu_zhang: auxPick,
        members: [],
      });
    }
  }


  // Step 5 — distribute participants within their class. Pinned
  // participants land in their `pinned_group_no` regardless of class
  // (Phase D); everyone else flows through Phase A → E within their
  // bucket.

  // Phase D first (pin respect) so they're locked before we try to
  // balance around them.
  const remainingPerClass: Record<GroupClass, GroupingParticipant[]> = {
    strategic: [],
    key: [],
    growth: [],
    maintenance: [],
  };
  for (const cls of CLASS_ORDER) {
    for (const p of buckets[cls]) {
      if (
        p.pinned_group_no != null
        && p.pinned_group_no >= 1
        && p.pinned_group_no <= groups.length
      ) {
        groups[p.pinned_group_no - 1].members.push(p);
      } else {
        remainingPerClass[cls].push(p);
      }
    }
  }

  // Phase A + B + E within each class.
  const familyChains = buildFamilyChains(participants);
  // Migration 030 — conflict pairs. Same hardness as family; built as a
  // parallel chains map so the same swap logic can repair violations.
  const conflictChains = buildConflictChains(participants);
  for (const cls of CLASS_ORDER) {
    const classGroups = groups.filter((g) => g.group_class === cls);
    if (classGroups.length === 0) continue;

    // Phase A — dimension match. For each participant with a primary
    // goal dimension, prefer the group whose main 组长 covers it.
    // Tie-break by lowest current size.
    const sorted = [...remainingPerClass[cls]].sort((a, b) => {
      // Priority participants first (so 特级 + 重点 spread phase has
      // them already placed when it scans for over-clusters).
      const ap = isPriority(a) ? 1 : 0;
      const bp = isPriority(b) ? 1 : 0;
      if (ap !== bp) return bp - ap;
      // Then old students first (helps Phase E).
      if (a.is_old_student !== b.is_old_student) {
        return a.is_old_student ? -1 : 1;
      }
      // Then by region_id for determinism.
      return (a.region_id ?? "").localeCompare(b.region_id ?? "");
    });

    for (const p of sorted) {
      const targetGroup = pickGroupForParticipant(
        p,
        classGroups,
        familyChains,
        conflictChains,
        config.group_size_max,
      );
      targetGroup.members.push(p);
    }

    // Phase B — priority spread (特级 + 重点 only).
    if (cls === "strategic" || cls === "key") {
      rebalancePriority(classGroups, familyChains, conflictChains);
    }

    // Phase C — family split repair within class.
    repairFamilySplit(classGroups, familyChains, conflictChains);

    // Phase C2 — conflict-pair split repair (same hardness, separate
    // adjacency). Runs after family so the family swap doesn't undo a
    // conflict swap.
    repairConflictSplit(classGroups, familyChains, conflictChains);

    // Phase E — old-student mix balance.
    repairOldStudentMix(classGroups, familyChains, conflictChains);

    // Phase F — energy_profile distribution (soft).
    repairEnergyDistribution(classGroups, familyChains, conflictChains);

    // Phase G — language fluency mix (soft).
    repairLanguageMix(classGroups, familyChains, conflictChains);
  }

  // Step 6 — assign roles + generate rationale.
  const drafts: DraftGroup[] = groups.map((g) => {
    const roles = applyCuratedRoles(g);
    return {
      group_no: g.group_no,
      group_class: g.group_class,
      leader_participant_id: g.main_zu_zhang?.participant_id ?? null,
      members: roles,
      rationale_en: writeRationaleEn(g),
      rationale_cn: writeRationaleCn(g),
    };
  });

  return {
    strategy: "balance",
    groups: drafts,
    cushion_assignments: [],
    metadata: {
      n,
      k: groups.length,
      roster_shortfalls: shortfalls.length > 0 ? shortfalls : undefined,
    },
  };
}

// =============================================================================
// Roster shortfalls — exported helper so the curate modal can preview
// requirements without running the whole algorithm.
// =============================================================================

export function computeRosterShortfalls(
  roster: GroupingZuZhang[],
  kByClass: Record<GroupClass, number>,
): RosterShortfall[] {
  // Required = sum across classes by tier role.
  // 维护型 mains are pooled across 成长 + 维护 (same tier required).
  const required: Array<{
    group_class: GroupClass;
    k_required: number;
    tier: ZuZhangTier;
    role: "main" | "auxiliary";
  }> = [];
  for (const cls of CLASS_ORDER) {
    const k = kByClass[cls];
    if (k === 0) continue;
    const { main, auxiliary } = requiredLeaderTiers(cls);
    required.push({ group_class: cls, k_required: k, tier: main, role: "main" });
    required.push({
      group_class: cls,
      k_required: k,
      tier: auxiliary,
      role: "auxiliary",
    });
  }

  // Pool tier counts. Each 组长 counts once toward whichever role-slot
  // they're allocated to — but for the SHORTFALL diagnostic we just
  // compare aggregate availability vs aggregate demand per (tier, role).
  const haveByTier: Record<ZuZhangTier, number> = {
    key_recruitment: 0,
    recruitment: 0,
    maintenance: 0,
    auxiliary: 0,
  };
  for (const z of roster) haveByTier[z.tier] += 1;

  // Aggregate demand per tier across role slots. Note that a 感召型
  // 组长 may be either a main (重点组) or an auxiliary (特级组), so we
  // don't double-count or split — total demand for the tier is what
  // matters.
  const demandByTier: Record<ZuZhangTier, number> = {
    key_recruitment: 0,
    recruitment: 0,
    maintenance: 0,
    auxiliary: 0,
  };
  for (const r of required) demandByTier[r.tier] += r.k_required;

  const shortfalls: RosterShortfall[] = [];
  for (const r of required) {
    // Available = haveByTier[tier], proportionally allocated to this
    // role's k_required share of demandByTier[tier].
    const totalDemand = demandByTier[r.tier];
    if (totalDemand === 0) continue;
    const totalHave = haveByTier[r.tier];
    // Per-role share = floor((have * k_required) / totalDemand) —
    // worst case for diagnostic purposes.
    const share = Math.floor((totalHave * r.k_required) / totalDemand);
    if (share < r.k_required) {
      shortfalls.push({
        group_class: r.group_class,
        k_required: r.k_required,
        required_tier: r.tier,
        required_role: r.role,
        have: share,
        need: r.k_required,
      });
    }
  }
  return shortfalls;
}

// =============================================================================
// Helpers
// =============================================================================

function bucketRosterByTier(
  roster: GroupingZuZhang[],
): Record<ZuZhangTier, GroupingZuZhang[]> {
  const out: Record<ZuZhangTier, GroupingZuZhang[]> = {
    key_recruitment: [],
    recruitment: [],
    maintenance: [],
    auxiliary: [],
  };
  for (const z of roster) out[z.tier].push(z);
  // Sort each tier bucket by grade desc (nulls last) so pool.shift() in
  // popPreferringDimensionSpread picks the highest-graded leader first
  // when there's no comparison group to spread against.
  for (const tier of Object.keys(out) as ZuZhangTier[]) {
    out[tier].sort((a, b) => (b.grade ?? 0) - (a.grade ?? 0));
  }
  return out;
}

// Pick a 组长 of `tier` from the bucket; prefer one whose dimensions
// least overlap with already-seeded groups in the same class (broadens
// coverage). Returns null if the bucket is empty (graceful degraded
// mode — group will lack that role).
function popPreferringDimensionSpread(
  bucket: Record<ZuZhangTier, GroupingZuZhang[]>,
  tier: ZuZhangTier,
  comparisonGroups: Array<{ main_zu_zhang: GroupingZuZhang | null }>,
): GroupingZuZhang | null {
  const pool = bucket[tier];
  if (pool.length === 0) return null;
  if (comparisonGroups.length === 0) {
    return pool.shift() ?? null;
  }
  const seenDimensions = new Set<GrowthDimension>();
  for (const g of comparisonGroups) {
    if (!g.main_zu_zhang) continue;
    for (const d of g.main_zu_zhang.dimensions) seenDimensions.add(d);
  }
  // Score each candidate by NEW dimensions they bring; lower score
  // means more redundant; we want the highest score. Tiebreak by grade
  // desc so within equal-coverage candidates the strongest leader wins.
  let bestIndex = 0;
  let bestNewCount = -1;
  let bestGrade = -1;
  for (let i = 0; i < pool.length; i += 1) {
    const newCount = pool[i].dimensions.filter((d) => !seenDimensions.has(d))
      .length;
    const grade = pool[i].grade ?? 0;
    if (
      newCount > bestNewCount
      || (newCount === bestNewCount && grade > bestGrade)
    ) {
      bestNewCount = newCount;
      bestGrade = grade;
      bestIndex = i;
    }
  }
  const [picked] = pool.splice(bestIndex, 1);
  return picked;
}

// Used only for dimension-spread comparison when seeding auxiliary
// against an already-seeded main within a class.
function emptyWorkingGroupShape(
  cls: GroupClass,
  main: GroupingZuZhang,
): WorkingGroup {
  return {
    group_no: 0,
    group_class: cls,
    main_zu_zhang: main,
    auxiliary_zu_zhang: null,
    members: [],
  };
}

// Phase A — pick a target group for a participant within their class.
// Preference order:
//   1. Group whose main 组长 covers the participant's primary goal
//      AND group has spare capacity AND no family conflict.
//   2. Group whose auxiliary 组长 covers the primary goal (same gates).
//   3. Smallest group with capacity AND no family conflict.
//   4. Smallest group (accept family/capacity overflow; Phase C repairs).
//
// Each filter step requires `members.length < groupSizeMax`. The
// algorithm degrades gracefully if every group is full (e.g. when
// surplus 组长 demoted to 'growth' push the bucket over the policy
// total) by falling through to step 4.
function pickGroupForParticipant(
  p: GroupingParticipant,
  classGroups: WorkingGroup[],
  familyChains: Map<string, string>,
  conflictChains: Map<string, string>,
  groupSizeMax: number,
): WorkingGroup {
  const primaryGoal = p.goal_dimensions[0] ?? null;
  const pFamilyChain = familyChains.get(p.participant_id);
  const pConflictChain = conflictChains.get(p.participant_id);

  // Hard-safe: respects BOTH family-split and conflict-pair-split rules.
  const hardSafe = (g: WorkingGroup): boolean => {
    if (pFamilyChain) {
      const familyHit = g.members.some(
        (m) => familyChains.get(m.participant_id) === pFamilyChain,
      );
      if (familyHit) return false;
    }
    if (pConflictChain) {
      const conflictHit = g.members.some(
        (m) => conflictChains.get(m.participant_id) === pConflictChain,
      );
      if (conflictHit) return false;
    }
    return true;
  };
  // Account for the seeded leader pair when checking capacity — those
  // already occupy 1-2 seats per group before any regular member lands.
  const seatedHead = (g: WorkingGroup): number =>
    (g.main_zu_zhang ? 1 : 0) + (g.auxiliary_zu_zhang ? 1 : 0);
  const hasCapacity = (g: WorkingGroup): boolean =>
    g.members.length + seatedHead(g) < groupSizeMax;

  if (primaryGoal) {
    const mainMatch = classGroups
      .filter((g) => hardSafe(g) && hasCapacity(g))
      .filter(
        (g) =>
          g.main_zu_zhang
          && g.main_zu_zhang.dimensions.includes(primaryGoal),
      )
      .sort((a, b) => a.members.length - b.members.length)[0];
    if (mainMatch) return mainMatch;

    const auxMatch = classGroups
      .filter((g) => hardSafe(g) && hasCapacity(g))
      .filter(
        (g) =>
          g.auxiliary_zu_zhang
          && g.auxiliary_zu_zhang.dimensions.includes(primaryGoal),
      )
      .sort((a, b) => a.members.length - b.members.length)[0];
    if (auxMatch) return auxMatch;
  }

  const safeGroup = classGroups
    .filter((g) => hardSafe(g) && hasCapacity(g))
    .sort((a, b) => a.members.length - b.members.length)[0];
  if (safeGroup) return safeGroup;

  const anyWithCapacity = classGroups
    .filter((g) => hasCapacity(g))
    .sort((a, b) => a.members.length - b.members.length)[0];
  if (anyWithCapacity) return anyWithCapacity;

  // Every group full — last resort. Take the smallest and accept overflow;
  // validation will surface group_too_large for admin to handle.
  return [...classGroups].sort(
    (a, b) => a.members.length - b.members.length,
  )[0];
}

// Phase B — for 特级 + 重点, ensure priority participants are spread
// evenly. No group should hold more than ceil(priority_count / k) of
// them.
function rebalancePriority(
  classGroups: WorkingGroup[],
  familyChains: Map<string, string>,
  conflictChains: Map<string, string>,
): void {
  const priorityMembers = classGroups
    .flatMap((g) => g.members.filter((m) => isPriority(m)).map((m) => ({ g, m })));
  if (priorityMembers.length === 0) return;
  const cap = Math.ceil(priorityMembers.length / classGroups.length);

  let stable = false;
  let swaps = 0;
  while (!stable && swaps < 50) {
    stable = true;
    for (const g of classGroups) {
      const groupPriority = g.members.filter((m) => isPriority(m));
      if (groupPriority.length <= cap) continue;
      // Find a sibling group with fewer priority members AND a
      // non-priority swap candidate to receive.
      const donor = g;
      const receiverCandidates = classGroups
        .filter((c) => c.group_no !== g.group_no)
        .map((c) => ({
          c,
          priorityCount: c.members.filter((m) => isPriority(m)).length,
        }))
        .filter((x) => x.priorityCount < cap)
        .sort((a, b) => a.priorityCount - b.priorityCount);
      let swapped = false;
      for (const { c } of receiverCandidates) {
        const moveOut = donor.members.find(
          (m) => isPriority(m) && m.pinned_group_no == null,
        );
        if (!moveOut) continue;
        const moveIn = c.members.find(
          (m) => !isPriority(m) && m.pinned_group_no == null,
        );
        if (!moveIn) continue;
        if (createsHardConflict(moveOut, c, familyChains, conflictChains)) continue;
        if (createsHardConflict(moveIn, donor, familyChains, conflictChains)) continue;
        swapMembers(donor, c, moveOut, moveIn);
        swaps += 1;
        stable = false;
        swapped = true;
        break;
      }
      if (swapped) break;
    }
  }
}

// Phase C — repair family-split violations within a class.
function repairFamilySplit(
  classGroups: WorkingGroup[],
  familyChains: Map<string, string>,
  conflictChains: Map<string, string>,
): void {
  let stable = false;
  let swaps = 0;
  while (!stable && swaps < 100) {
    stable = true;
    for (const g of classGroups) {
      const seen = new Map<string, GroupingParticipant>();
      let conflict: GroupingParticipant | null = null;
      for (const m of g.members) {
        const chain = familyChains.get(m.participant_id);
        if (!chain) continue;
        if (seen.has(chain)) {
          conflict = m;
          break;
        }
        seen.set(chain, m);
      }
      if (!conflict) continue;
      // Find a swap target in another group within the same class. The
      // swap target must be hard-safe in BOTH directions so the swap
      // doesn't fix a family violation while creating a conflict-pair
      // one (or vice versa).
      const target = findHardSafeSwapTarget(
        classGroups,
        g.group_no,
        conflict,
        familyChains,
        conflictChains,
        "family",
      );
      if (!target) continue;
      const targetGroup = classGroups.find((cg) =>
        cg.members.some((m) => m.participant_id === target.participant_id),
      )!;
      swapMembers(g, targetGroup, conflict, target);
      swaps += 1;
      stable = false;
      break;
    }
  }
}

// Phase C2 — repair conflict-pair violations within a class. Mirrors
// repairFamilySplit but scans for conflict-chain collisions.
function repairConflictSplit(
  classGroups: WorkingGroup[],
  familyChains: Map<string, string>,
  conflictChains: Map<string, string>,
): void {
  let stable = false;
  let swaps = 0;
  while (!stable && swaps < 100) {
    stable = true;
    for (const g of classGroups) {
      const seen = new Map<string, GroupingParticipant>();
      let conflict: GroupingParticipant | null = null;
      for (const m of g.members) {
        const chain = conflictChains.get(m.participant_id);
        if (!chain) continue;
        if (seen.has(chain)) {
          conflict = m;
          break;
        }
        seen.set(chain, m);
      }
      if (!conflict) continue;
      const target = findHardSafeSwapTarget(
        classGroups,
        g.group_no,
        conflict,
        familyChains,
        conflictChains,
        "conflict",
      );
      if (!target) continue;
      const targetGroup = classGroups.find((cg) =>
        cg.members.some((m) => m.participant_id === target.participant_id),
      )!;
      swapMembers(g, targetGroup, conflict, target);
      swaps += 1;
      stable = false;
      break;
    }
  }
}

// Phase E — ensure no group is 100% new students if old students
// remain available within the class.
function repairOldStudentMix(
  classGroups: WorkingGroup[],
  familyChains: Map<string, string>,
  conflictChains: Map<string, string>,
): void {
  for (const g of classGroups) {
    const hasOs = g.members.some((m) => m.is_old_student);
    if (hasOs) continue;
    const donor = classGroups
      .filter((c) => c.group_no !== g.group_no)
      .map((c) => ({
        c,
        osCount: c.members.filter((m) => m.is_old_student).length,
      }))
      .filter((x) => x.osCount >= 2)
      .sort((a, b) => b.osCount - a.osCount)[0];
    if (!donor) continue;
    const osPick = donor.c.members.find(
      (m) =>
        m.is_old_student
        && m.pinned_group_no == null
        && !createsHardConflict(m, g, familyChains, conflictChains),
    );
    if (!osPick) continue;
    const swapOut = g.members.find(
      (m) =>
        !m.is_old_student
        && m.pinned_group_no == null
        && !createsHardConflict(m, donor.c, familyChains, conflictChains),
    );
    if (!swapOut) continue;
    swapMembers(g, donor.c, osPick, swapOut);
  }
}

// Phase F — soft balance of energy_profile (high/medium/quiet) across
// groups within a class. Mirrors the OS-mix idea: if a group has too
// many of one bucket vs. the per-group average, swap with a sibling
// group that has the opposite imbalance. Bounded iterations; no
// validation error if it can't converge — soft constraint.
function repairEnergyDistribution(
  classGroups: WorkingGroup[],
  familyChains: Map<string, string>,
  conflictChains: Map<string, string>,
): void {
  if (classGroups.length < 2) return;
  const k = classGroups.length;
  type Bucket = "high" | "medium" | "quiet";
  const buckets: Bucket[] = ["high", "medium", "quiet"];

  // Per-class target: ceil(global_count / k) for each bucket.
  const totals: Record<Bucket, number> = { high: 0, medium: 0, quiet: 0 };
  for (const g of classGroups) {
    for (const m of g.members) {
      if (m.energy_profile) totals[m.energy_profile] += 1;
    }
  }
  const cap: Record<Bucket, number> = {
    high: Math.ceil(totals.high / k),
    medium: Math.ceil(totals.medium / k),
    quiet: Math.ceil(totals.quiet / k),
  };

  let stable = false;
  let swaps = 0;
  while (!stable && swaps < 30) {
    stable = true;
    for (const bucket of buckets) {
      for (const donor of classGroups) {
        const donorCount = donor.members.filter(
          (m) => m.energy_profile === bucket,
        ).length;
        if (donorCount <= cap[bucket]) continue;
        const receiver = classGroups
          .filter((c) => c.group_no !== donor.group_no)
          .map((c) => ({
            c,
            count: c.members.filter((m) => m.energy_profile === bucket).length,
          }))
          .filter((x) => x.count < cap[bucket])
          .sort((a, b) => a.count - b.count)[0];
        if (!receiver) continue;
        const moveOut = donor.members.find(
          (m) => m.energy_profile === bucket && m.pinned_group_no == null,
        );
        if (!moveOut) continue;
        const moveIn = receiver.c.members.find(
          (m) => m.energy_profile !== bucket && m.pinned_group_no == null,
        );
        if (!moveIn) continue;
        if (createsHardConflict(moveOut, receiver.c, familyChains, conflictChains))
          continue;
        if (createsHardConflict(moveIn, donor, familyChains, conflictChains))
          continue;
        swapMembers(donor, receiver.c, moveOut, moveIn);
        swaps += 1;
        stable = false;
      }
    }
  }
}

// Phase G — soft language fluency mix. For each group within a class,
// guarantee ≥1 person who can converse in EACH language present in the
// wider class enrolment. "both" counts toward both languages.
//
// Skipped when the class has only one language present (no mix to
// enforce).
function repairLanguageMix(
  classGroups: WorkingGroup[],
  familyChains: Map<string, string>,
  conflictChains: Map<string, string>,
): void {
  if (classGroups.length < 2) return;
  // Snapshot which languages are present anywhere in the class.
  const present = { en: false, cn: false };
  for (const g of classGroups) {
    for (const m of g.members) {
      if (m.language_fluency === "en" || m.language_fluency === "both")
        present.en = true;
      if (m.language_fluency === "cn" || m.language_fluency === "both")
        present.cn = true;
    }
  }
  if (!present.en || !present.cn) return; // monolingual class — skip

  const speaksEn = (m: GroupingParticipant) =>
    m.language_fluency === "en" || m.language_fluency === "both";
  const speaksCn = (m: GroupingParticipant) =>
    m.language_fluency === "cn" || m.language_fluency === "both";

  const groupHasEn = (g: WorkingGroup) => g.members.some(speaksEn);
  const groupHasCn = (g: WorkingGroup) => g.members.some(speaksCn);

  let stable = false;
  let swaps = 0;
  while (!stable && swaps < 30) {
    stable = true;
    for (const g of classGroups) {
      const needsLang: "en" | "cn" | null = !groupHasEn(g)
        ? "en"
        : !groupHasCn(g)
          ? "cn"
          : null;
      if (!needsLang) continue;
      // Find a donor group with surplus speakers of `needsLang`.
      const donorList = classGroups
        .filter((c) => c.group_no !== g.group_no)
        .map((c) => ({
          c,
          surplus: c.members.filter((m) =>
            needsLang === "en" ? speaksEn(m) : speaksCn(m),
          ).length,
        }))
        .filter((x) => x.surplus >= 2)
        .sort((a, b) => b.surplus - a.surplus);
      let swapped = false;
      for (const { c: donor } of donorList) {
        // Move someone fluent in needsLang OUT of donor INTO g.
        const moveOut = donor.members.find(
          (m) =>
            (needsLang === "en" ? speaksEn(m) : speaksCn(m))
            && m.pinned_group_no == null,
        );
        if (!moveOut) continue;
        // And move someone NOT-fluent-in-needsLang from g into donor.
        // (any member is fine; we just want to keep group sizes equal.)
        const moveIn = g.members.find(
          (m) =>
            !(needsLang === "en" ? speaksEn(m) : speaksCn(m))
            && m.pinned_group_no == null,
        );
        if (!moveIn) continue;
        if (createsHardConflict(moveOut, g, familyChains, conflictChains)) continue;
        if (createsHardConflict(moveIn, donor, familyChains, conflictChains)) continue;
        swapMembers(g, donor, moveIn, moveOut);
        swaps += 1;
        stable = false;
        swapped = true;
        break;
      }
      if (swapped) continue;
    }
  }
}

// Find a swap partner in a sibling group that respects BOTH family and
// conflict-pair constraints in BOTH directions. The `repairing` arg
// signals which constraint we're prioritising fixing — but all rules
// must hold afterwards regardless.
function findHardSafeSwapTarget(
  classGroups: WorkingGroup[],
  excludeGroupNo: number,
  movingOut: GroupingParticipant,
  familyChains: Map<string, string>,
  conflictChains: Map<string, string>,
  _repairing: "family" | "conflict",
): GroupingParticipant | null {
  const movingFamily = familyChains.get(movingOut.participant_id);
  const movingConflict = conflictChains.get(movingOut.participant_id);
  const sourceGroup = classGroups.find((cg) => cg.group_no === excludeGroupNo)!;
  const candidates = classGroups
    .filter((g) => g.group_no !== excludeGroupNo)
    .sort((a, b) => b.members.length - a.members.length);
  for (const g of candidates) {
    for (const m of g.members) {
      if (m.pinned_group_no != null) continue;
      // movingOut going INTO g: must not collide on either chain with g's
      // existing members.
      const mFamily = familyChains.get(m.participant_id);
      const mConflict = conflictChains.get(m.participant_id);
      if (movingFamily && g.members.some(
        (other) =>
          other.participant_id !== m.participant_id
          && familyChains.get(other.participant_id) === movingFamily,
      )) continue;
      if (movingConflict && g.members.some(
        (other) =>
          other.participant_id !== m.participant_id
          && conflictChains.get(other.participant_id) === movingConflict,
      )) continue;
      // m going INTO sourceGroup: must not collide with anyone there
      // (excluding movingOut who's leaving).
      if (mFamily && sourceGroup.members.some(
        (cur) =>
          cur.participant_id !== movingOut.participant_id
          && familyChains.get(cur.participant_id) === mFamily,
      )) continue;
      if (mConflict && sourceGroup.members.some(
        (cur) =>
          cur.participant_id !== movingOut.participant_id
          && conflictChains.get(cur.participant_id) === mConflict,
      )) continue;
      return m;
    }
  }
  return null;
}

// Returns true if dropping `candidate` into `group` would put two
// members of the same family-chain OR conflict-chain together.
function createsHardConflict(
  candidate: GroupingParticipant,
  group: WorkingGroup,
  familyChains: Map<string, string>,
  conflictChains: Map<string, string>,
): boolean {
  const familyChain = familyChains.get(candidate.participant_id);
  if (familyChain && group.members.some(
    (m) =>
      m.participant_id !== candidate.participant_id
      && familyChains.get(m.participant_id) === familyChain,
  )) return true;
  const conflictChain = conflictChains.get(candidate.participant_id);
  if (conflictChain && group.members.some(
    (m) =>
      m.participant_id !== candidate.participant_id
      && conflictChains.get(m.participant_id) === conflictChain,
  )) return true;
  return false;
}

function swapMembers(
  ga: WorkingGroup,
  gb: WorkingGroup,
  fromGa: GroupingParticipant,
  fromGb: GroupingParticipant,
): void {
  ga.members = ga.members.filter(
    (m) => m.participant_id !== fromGa.participant_id,
  );
  gb.members = gb.members.filter(
    (m) => m.participant_id !== fromGb.participant_id,
  );
  ga.members.push(fromGb);
  gb.members.push(fromGa);
}

// Walk family edges (legacy single-edge column + multi-edge join table)
// to assign a stable chain-key per connected component. Two participants
// share a chain iff they're in the same component — exactly the "must
// split" relationship per spec.
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

// Same shape as buildFamilyChains but using the conflict_member_ids
// adjacency. Connected components → must split. Mirror of family logic.
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

function writeRationaleEn(g: WorkingGroup): string {
  const cls = GROUP_CLASS_LABEL[g.group_class].en;
  const mainTier = g.main_zu_zhang
    ? ZU_ZHANG_TIER_LABEL[g.main_zu_zhang.tier].en
    : null;
  const mainId = g.main_zu_zhang?.region_id ?? "—";
  const dims = collectGroupDimensions(g);
  const dimText =
    dims.length > 0
      ? dims.map((d) => GROWTH_DIMENSION_LABEL[d].en).join(" / ")
      : "no declared focus";
  const oldCount = g.members.filter((m) => m.is_old_student).length;
  const newCount = g.members.length - oldCount;
  const priorityCount = g.members.filter((m) => isPriority(m)).length;
  return `${cls} group hosted by ${mainId}${
    mainTier ? ` (${mainTier})` : ""
  }. Focus dimensions: ${dimText}. ${oldCount} old + ${newCount} new students; ${priorityCount} priority.`;
}

function writeRationaleCn(g: WorkingGroup): string {
  const cls = GROUP_CLASS_LABEL[g.group_class].cn;
  const mainTier = g.main_zu_zhang
    ? ZU_ZHANG_TIER_LABEL[g.main_zu_zhang.tier].cn
    : null;
  const mainId = g.main_zu_zhang?.region_id ?? "—";
  const dims = collectGroupDimensions(g);
  const dimText =
    dims.length > 0
      ? dims.map((d) => GROWTH_DIMENSION_LABEL[d].cn).join(" / ")
      : "未声明方向";
  const oldCount = g.members.filter((m) => m.is_old_student).length;
  const newCount = g.members.length - oldCount;
  const priorityCount = g.members.filter((m) => isPriority(m)).length;
  return `${cls}，由 ${mainId}${
    mainTier ? `（${mainTier}）` : ""
  }担任组长。覆盖方向：${dimText}。包含 ${oldCount} 位旧生与 ${newCount} 位新生；其中 ${priorityCount} 位重点学员。`;
}

function collectGroupDimensions(g: WorkingGroup): GrowthDimension[] {
  const set = new Set<GrowthDimension>();
  if (g.main_zu_zhang) for (const d of g.main_zu_zhang.dimensions) set.add(d);
  if (g.auxiliary_zu_zhang) {
    for (const d of g.auxiliary_zu_zhang.dimensions) set.add(d);
  }
  return Array.from(set);
}
