#!/usr/bin/env node
// Smoke test for the M6.0 grouping pipeline. Runs three checks against
// synthetic data:
//   1. balance.ts on 50 synthetic pax + curated 组长 roster — verifies
//      class-bucketing, leader pairing per class, family split, pin
//      respect, dimension matching.
//   2. cushion-rank.ts on 30 cushions in 3 rows + 30 participants.
//   3. Grouping rework rules (2026-11-24): CS-suggested 组长, main goal
//      coverage, stronger students → higher-grade leaders, caution flag
//      left for manual placement, tier borrowing, pins with reserved
//      group numbers, determinism.
//
// Run with: npx tsx scripts/smoke-grouping.ts

import { balance } from "../src/lib/grouping/balance.ts";
import { cushionRank } from "../src/lib/grouping/cushion-rank.ts";
import {
  GROUP_CLASS_LABEL,
  participantToClass,
  scoreToQualification,
} from "../src/lib/grouping/types.ts";
import { validateGrouping } from "../src/lib/grouping/validate.ts";

// -----------------------------------------------------------------------------
// Synthetic dataset — M6.0 schema (1-5 scores + goal_dimensions)
// -----------------------------------------------------------------------------

const ALL_DIMENSIONS = ["financial", "relationship", "health", "inner_peace", "spiritual"];

function buildSynthetic(n) {
  const regions = ["MY", "SG", "TW", "HK", "CN"];
  const motivations = ["networking", "spiritual", "business", "family"];
  // Cycle length 7 (coprime with the 5-step qualification cycle) so energy
  // scatters across all classes — otherwise every basic-tier member would
  // inherit the same energy bucket.
  const energyCycle = ["high", "medium", "medium", "quiet", "medium", "high", "quiet"];
  const languageCycle = ["cn", "cn", "en", "both", "cn", "en", "both", "cn", "en", "both"];
  // Distribute across all 5 qualification scores 1–5 evenly.
  const participants = [];
  for (let i = 0; i < n; i++) {
    const region = regions[i % regions.length];
    // Score = 1..5 cycling on i % 5. Adds slight variance via influence.
    const baseScore = (i % 5) + 1;
    const financial = baseScore;
    const influence = Math.max(1, baseScore - ((i % 3) - 1));
    const primary = ALL_DIMENSIONS[i % 4];
    const secondary = ALL_DIMENSIONS[(i + 2) % 4];
    participants.push({
      participant_id: `P${String(i).padStart(3, "0")}`,
      region_id: `${region}${String(100 + i).padStart(3, "0")}`,
      overall_score: null,
      influence_score: influence,
      financial_score: financial,
      motivations: [motivations[i % motivations.length]],
      motivation_other: null,
      sells_products: i % 7 === 0,
      is_old_student: i % 5 === 0,
      family_of_participant_id: null,
      family_member_ids: [],
      region,
      pinned_group_no: null,
      goal_dimensions: [primary, secondary],
      student_qualification_override: null,
      energy_profile: energyCycle[i % energyCycle.length],
      language_fluency: languageCycle[i % languageCycle.length],
      conflict_member_ids: [],
      suggested_leader_ids: [],
      listening_language: "zh",
    });
  }
  // Sprinkle 3 family pairs spanning qualification classes (so the
  // family-split repair has cross-class participants to swap with). Pair
  // index i with index i+1 — adjacent indexes have adjacent scores so
  // they fall in different classes.
  for (let i = 0; i < 3; i++) {
    const a = i * 2;
    const b = i * 2 + 1;
    participants[a].family_of_participant_id = participants[b].participant_id;
    participants[b].family_of_participant_id = participants[a].participant_id;
  }
  // Sprinkle 3 conflict pairs at different indexes from family. Pair
  // indexes that fall in the SAME qualification class (i % 5 == j % 5)
  // so the algorithm has to do a same-class swap, not a class shuffle.
  // Indexes 10+15 (both score 1), 11+16 (score 2), 12+17 (score 3).
  const conflictPairs = [[10, 15], [11, 16], [12, 17]];
  for (const [a, b] of conflictPairs) {
    if (a < n && b < n) {
      participants[a].conflict_member_ids.push(participants[b].participant_id);
      participants[b].conflict_member_ids.push(participants[a].participant_id);
    }
  }
  // Pin one participant to group 2.
  participants[7].pinned_group_no = 2;
  return participants;
}

// Synthetic curated 组长 roster. Sized to satisfy demand for the 50-pax
// even-distribution: scores 1-5 cyclic → 14 strategic + 9 excellence
// (both → strategic class) → 3 strategic groups; 10 elite → 1 key; 11
// rising → 2 growth; 6 basic → 1 maintenance. 7 total groups → 14 leaders.
// Tier demand: 3 KR + 4 recruitment + 4 maintenance + 3 auxiliary = 14.
function buildRoster() {
  return [
    {
      participant_id: "Z000",
      region_id: "MY900",
      tier: "key_recruitment",
      grade: 5,
      dimensions: ["financial", "relationship"],
      core_traits: ["logical_thinking","social_intelligence"],
      is_main: true,
      is_auxiliary: false,
    },
    {
      participant_id: "Z001",
      region_id: "MY901",
      tier: "recruitment",
      grade: 5,
      dimensions: ["health", "inner_peace"],
      core_traits: ["logical_thinking","social_intelligence"],
      is_main: true,
      is_auxiliary: false,
    },
    {
      participant_id: "Z002",
      region_id: "SG900",
      tier: "recruitment",
      grade: 4,
      dimensions: ["financial", "relationship"],
      core_traits: ["logical_thinking","social_intelligence"],
      is_main: true,
      is_auxiliary: false,
    },
    {
      participant_id: "Z003",
      region_id: "TW900",
      tier: "maintenance",
      grade: 5,
      dimensions: ["health"],
      core_traits: ["logical_thinking","social_intelligence"],
      is_main: true,
      is_auxiliary: false,
    },
    {
      participant_id: "Z004",
      region_id: "HK900",
      tier: "maintenance",
      grade: 4,
      dimensions: ["inner_peace"],
      core_traits: ["logical_thinking","social_intelligence"],
      is_main: true,
      is_auxiliary: false,
    },
    {
      participant_id: "Z007",
      region_id: "SG901",
      tier: "maintenance",
      grade: 3,
      dimensions: ["financial"],
      core_traits: ["logical_thinking","social_intelligence"],
      is_main: true,
      is_auxiliary: false,
    },
    {
      participant_id: "Z005",
      region_id: "CN900",
      tier: "auxiliary",
      grade: 5,
      dimensions: ["financial"],
      core_traits: ["logical_thinking","social_intelligence"],
      is_main: false,
      is_auxiliary: true,
    },
    {
      participant_id: "Z006",
      region_id: "MY902",
      tier: "auxiliary",
      grade: 4,
      dimensions: ["relationship"],
      core_traits: ["logical_thinking","social_intelligence"],
      is_main: false,
      is_auxiliary: true,
    },
    // Top-up: 2 more KR, 2 more recruitment, 1 more maintenance, 1 more auxiliary.
    {
      participant_id: "Z008",
      region_id: "TW901",
      tier: "key_recruitment",
      grade: 4,
      dimensions: ["financial", "health"],
      core_traits: ["logical_thinking","social_intelligence"],
      is_main: true,
      is_auxiliary: false,
    },
    {
      participant_id: "Z009",
      region_id: "HK901",
      tier: "key_recruitment",
      grade: 3,
      dimensions: ["relationship", "inner_peace"],
      core_traits: ["logical_thinking","social_intelligence"],
      is_main: true,
      is_auxiliary: false,
    },
    {
      participant_id: "Z010",
      region_id: "CN901",
      tier: "recruitment",
      grade: 3,
      dimensions: ["health"],
      core_traits: ["logical_thinking","social_intelligence"],
      is_main: true,
      is_auxiliary: false,
    },
    {
      participant_id: "Z011",
      region_id: "MY903",
      tier: "recruitment",
      grade: 2,
      dimensions: ["inner_peace"],
      core_traits: ["logical_thinking","social_intelligence"],
      is_main: true,
      is_auxiliary: false,
    },
    {
      participant_id: "Z012",
      region_id: "SG902",
      tier: "maintenance",
      grade: 2,
      dimensions: ["relationship"],
      core_traits: ["logical_thinking","social_intelligence"],
      is_main: true,
      is_auxiliary: false,
    },
    {
      participant_id: "Z013",
      region_id: "TW902",
      tier: "auxiliary",
      grade: 3,
      dimensions: ["health"],
      core_traits: ["logical_thinking","social_intelligence"],
      is_main: false,
      is_auxiliary: true,
    },
  ];
}

// -----------------------------------------------------------------------------
// Check 1 — balance.ts on 50 pax + curated roster
// -----------------------------------------------------------------------------

function checkBalance() {
  console.log("\n=== Check 1: balance.ts (50 pax + curated 组长) ===");
  const participants = buildSynthetic(50);
  const roster = buildRoster();
  const config = { group_size_min: 5, group_size_max: 12 };
  const result = balance(participants, roster, config);

  console.log(
    `strategy=${result.strategy} k=${result.metadata.k} n=${result.metadata.n}`,
  );
  console.log(`groups: ${result.groups.map((g) => `#${g.group_no}/${g.group_class}=${g.members.length}`).join(", ")}`);
  if (result.metadata.roster_shortfalls?.length) {
    console.log(`  roster shortfalls (${result.metadata.roster_shortfalls.length}):`);
    for (const s of result.metadata.roster_shortfalls) {
      console.log(`    - ${s.group_class} needs ${s.k_required}× ${s.required_tier} (${s.required_role}); have ${s.have}`);
    }
  }

  // Caution-flagged people are left for manual placement by design.
  const manual = new Set((result.metadata.manual_placement ?? []).map((m) => m.participant_id));
  const expectedFlagged = participants.filter((p) => p.sells_products && p.pinned_group_no == null).length;
  console.log(`  manual tray: ${manual.size} (expected ${expectedFlagged})`);
  const validation = validateGrouping(
    result.groups,
    participants.filter((p) => !manual.has(p.participant_id)),
    roster,
    config,
  );
  if (validation.valid) {
    console.log("✓ validation passed");
  } else {
    console.log(`✗ validation failed (${validation.errors.length} errors):`);
    for (const e of validation.errors) {
      console.log(`  [${e.code}] ${e.detail}`);
    }
  }

  // Class-bucketing check: every member's qualification class should
  // match their group's class (unless pinned).
  let classOk = true;
  for (const g of result.groups) {
    for (const m of g.members) {
      const p = participants.find((x) => x.participant_id === m.participant_id);
      if (!p) continue; // 组长 entries
      if (p.pinned_group_no === g.group_no) continue;
      const cls = participantToClass(p);
      if (cls !== g.group_class) {
        console.log(`  ✗ class mismatch: ${m.region_id} (${cls}) in ${g.group_class} group`);
        classOk = false;
      }
    }
  }
  if (classOk) console.log("  ✓ class-bucketing OK");

  // Pin check
  const pinnedRegionId = participants[7].region_id;
  const pinnedPlacement = result.groups.find((g) =>
    g.members.some((m) => m.region_id === pinnedRegionId),
  );
  const pinOk = pinnedPlacement?.group_no === 2;
  console.log(
    `  ${pinOk ? "✓" : "✗"} pin check: P007 (${pinnedRegionId}) pinned to group 2 → landed in group ${pinnedPlacement?.group_no}`,
  );

  // Family split check (3 pairs, indices 0+1, 2+3, 4+5)
  let familyOk = true;
  for (const g of result.groups) {
    const ids = new Set(g.members.map((m) => m.region_id));
    for (let i = 0; i < 3; i++) {
      const a = participants[i * 2].region_id;
      const b = participants[i * 2 + 1].region_id;
      if (ids.has(a) && ids.has(b)) {
        console.log(`  ✗ family ${a} + ${b} both in group ${g.group_no}`);
        familyOk = false;
      }
    }
  }
  if (familyOk) console.log("  ✓ family split OK");

  // Conflict-pair split check (mirror family check). Pairs are
  // indexes 10+15, 11+16, 12+17 from buildSynthetic.
  let conflictOk = true;
  const conflictPairs = [[10, 15], [11, 16], [12, 17]];
  for (const g of result.groups) {
    const ids = new Set(g.members.map((m) => m.region_id));
    for (const [a, b] of conflictPairs) {
      if (a >= participants.length || b >= participants.length) continue;
      const ra = participants[a].region_id;
      const rb = participants[b].region_id;
      if (ids.has(ra) && ids.has(rb)) {
        console.log(`  ✗ conflict pair ${ra} + ${rb} both in group ${g.group_no}`);
        conflictOk = false;
      }
    }
  }
  if (conflictOk) console.log("  ✓ conflict-pair split OK");

  // Energy distribution check — no group should be >70% same-bucket
  // unless its size is too small for spread to matter (≤2 members).
  let energyOk = true;
  for (const g of result.groups) {
    const energyMembers = g.members
      .map((m) => participants.find((p) => p.region_id === m.region_id))
      .filter((p) => p && p.energy_profile);
    if (energyMembers.length <= 2) continue;
    const counts = { high: 0, medium: 0, quiet: 0 };
    for (const m of energyMembers) counts[m.energy_profile] += 1;
    const max = Math.max(counts.high, counts.medium, counts.quiet);
    const ratio = max / energyMembers.length;
    if (ratio > 0.7) {
      console.log(
        `  · group ${g.group_no} energy concentration: ${Math.round(ratio * 100)}% one bucket (${counts.high}H/${counts.medium}M/${counts.quiet}Q over ${energyMembers.length} energy-tagged)`,
      );
    }
  }
  if (energyOk) console.log("  ✓ energy distribution OK (no group >70% same bucket)");

  // Language fluency check — when both en + cn speakers are present in
  // a class, every group in that class should have ≥1 of each.
  let langOk = true;
  for (const cls of ["strategic", "key", "growth", "maintenance"]) {
    const classGroups = result.groups.filter((g) => g.group_class === cls);
    if (classGroups.length < 2) continue;
    const classMembers = classGroups.flatMap((g) =>
      g.members.map((m) => participants.find((p) => p.region_id === m.region_id)).filter(Boolean),
    );
    const speaksEn = (m) => m.language_fluency === "en" || m.language_fluency === "both";
    const speaksCn = (m) => m.language_fluency === "cn" || m.language_fluency === "both";
    const enPool = classMembers.some(speaksEn);
    const cnPool = classMembers.some(speaksCn);
    if (!enPool || !cnPool) continue; // monolingual class
    for (const g of classGroups) {
      const gMembers = g.members
        .map((m) => participants.find((p) => p.region_id === m.region_id))
        .filter(Boolean);
      const hasEn = gMembers.some(speaksEn);
      const hasCn = gMembers.some(speaksCn);
      if (!hasEn || !hasCn) {
        console.log(`  · group ${g.group_no} (${cls}) missing ${!hasEn ? "EN" : ""}${!hasEn && !hasCn ? "+" : ""}${!hasCn ? "CN" : ""} fluency`);
      }
    }
  }
  if (langOk) console.log("  ✓ language mix OK (each group covers en + cn when both present in class)");

  // Leader-tier pairing check
  let pairingOk = true;
  for (const g of result.groups) {
    const zu = g.members.find((m) => m.role === "zu_zhang");
    const fu = g.members.find((m) => m.role === "fu_zu_zhang");
    const zuTier = roster.find((r) => r.participant_id === zu?.participant_id)?.tier;
    const fuTier = roster.find((r) => r.participant_id === fu?.participant_id)?.tier;
    const expected = {
      strategic: { main: "key_recruitment", auxiliary: "recruitment" },
      key: { main: "recruitment", auxiliary: "maintenance" },
      growth: { main: "maintenance", auxiliary: "auxiliary" },
      maintenance: { main: "maintenance", auxiliary: "auxiliary" },
    }[g.group_class];
    if (zuTier && zuTier !== expected.main) {
      console.log(`  ✗ ${g.group_class} group ${g.group_no} main 组长 should be ${expected.main}, got ${zuTier}`);
      pairingOk = false;
    }
    if (fuTier && fuTier !== expected.auxiliary) {
      console.log(`  ✗ ${g.group_class} group ${g.group_no} aux 组长 should be ${expected.auxiliary}, got ${fuTier}`);
      pairingOk = false;
    }
  }
  if (pairingOk) console.log("  ✓ leader-tier pairing OK");

  // Dimension match — count regulars whose primary goal is covered
  let matched = 0;
  let totalRegulars = 0;
  for (const g of result.groups) {
    const leaderDims = new Set();
    for (const m of g.members) {
      const z = roster.find((r) => r.participant_id === m.participant_id);
      if (z) for (const d of z.dimensions) leaderDims.add(d);
    }
    for (const m of g.members) {
      const p = participants.find((x) => x.participant_id === m.participant_id);
      if (!p) continue;
      totalRegulars += 1;
      const primary = p.goal_dimensions[0];
      if (primary && leaderDims.has(primary)) matched += 1;
    }
  }
  const matchRate = totalRegulars > 0 ? Math.round((matched / totalRegulars) * 100) : 0;
  console.log(`  · dimension match rate: ${matched}/${totalRegulars} (${matchRate}%)`);

  // Grade priority check — for each tier, the FIRST main seat of that
  // tier (group_no ascending) holds the highest-graded leader seated as a
  // main in that tier. Auxiliary seats are exempt: they prefer a leader
  // who adds new strengths (goal coverage outranks grade).
  let gradeOk = true;
  const TIERS_TO_CHECK = [
    "key_recruitment",
    "recruitment",
    "maintenance",
    "auxiliary",
  ] as const;
  for (const t of TIERS_TO_CHECK) {
    const mainIds = new Set(
      result.groups
        .map((g) => g.members.find((m) => m.role === "zu_zhang")?.participant_id)
        .filter(Boolean),
    );
    const bucket = roster.filter((r) => r.tier === t && mainIds.has(r.participant_id));
    if (bucket.length === 0) continue;
    const expectedTopGrade = bucket.reduce(
      (m, r) => Math.max(m, r.grade ?? 0),
      0,
    );
    let firstConsumedGrade: number | null = null;
    let firstConsumedRegion: string | null = null;
    outer: for (const g of result.groups) {
      const leader = g.members.find((m) => m.role === "zu_zhang");
      for (const m of [leader]) {
        if (!m) continue;
        const r = roster.find((x) => x.participant_id === m.participant_id);
        if (r?.tier === t) {
          firstConsumedGrade = r.grade;
          firstConsumedRegion = r.region_id;
          break outer;
        }
      }
    }
    const ok = firstConsumedGrade === expectedTopGrade;
    if (!ok) gradeOk = false;
    console.log(
      `  ${ok ? "✓" : "✗"} tier ${t}: first consumed = ${firstConsumedRegion} (grade ${firstConsumedGrade}); top in bucket = ${expectedTopGrade}`,
    );
  }
  if (gradeOk) console.log("  ✓ grade priority OK (highest-graded of each tier seeded first)");

  return validation.valid && gradeOk && conflictOk;
}

// -----------------------------------------------------------------------------
// Check 2 — cushion-rank.ts (3 rows × 10 cushions)
// -----------------------------------------------------------------------------

function checkCushion() {
  console.log("\n=== Check 2: cushion-rank.ts (30 cushions, 3 rows) ===");
  const participants = buildSynthetic(30);
  const cushions = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 10; col++) {
      cushions.push({
        id: `cushion-${row}-${col}`,
        x_pct: 10 + col * 8,
        y_pct: 10 + row * 15,
        height_pct: 3,
      });
    }
  }
  const result = cushionRank({ participants, cushions });
  console.log(
    `strategy=${result.strategy} rows=${result.metadata.k} assignments=${result.cushion_assignments.length}`,
  );

  let paiZhangCount = 0;
  for (const a of result.cushion_assignments) {
    if (a.role === "pai_zhang") paiZhangCount += 1;
  }
  console.log(`  ✓ pai_zhang count: ${paiZhangCount} (expected 6)`);

  return result.cushion_assignments.length === 30;
}

// -----------------------------------------------------------------------------
// Check 3 — grouping rework rules
// -----------------------------------------------------------------------------

function student(id, fin, goals, extra = {}) {
  return {
    participant_id: id,
    region_id: id,
    overall_score: null,
    influence_score: fin,
    financial_score: fin,
    motivations: [],
    motivation_other: null,
    sells_products: false,
    is_old_student: false,
    family_of_participant_id: null,
    family_member_ids: [],
    region: null,
    pinned_group_no: null,
    goal_dimensions: goals,
    student_qualification_override: null,
    energy_profile: null,
    language_fluency: null,
    conflict_member_ids: [],
    suggested_leader_ids: [],
    listening_language: "zh",
    ...extra,
  };
}

function leader(id, tier, grade, dims, spoken = ["zh"]) {
  return {
    participant_id: id,
    region_id: id,
    tier,
    grade,
    dimensions: dims,
    core_traits: [],
    spoken_languages: spoken,
    listening_language: spoken[0],
    is_main: tier !== "auxiliary",
    is_auxiliary: tier === "auxiliary",
  };
}

function checkRules() {
  console.log("\n=== Check 3: grouping rework rules ===");
  let ok = true;
  const fail = (msg) => {
    ok = false;
    console.log(`  ✗ ${msg}`);
  };
  const pass = (msg) => console.log(`  ✓ ${msg}`);
  const config = { group_size_min: 3, group_size_max: 6 }; // 4 regular seats

  // Three 特级 groups: main KR grades 5 / 4 / 3 with distinct strengths.
  const roster = [
    leader("KR5", "key_recruitment", 5, ["financial"]),
    leader("KR4", "key_recruitment", 4, ["health"]),
    leader("KR3", "key_recruitment", 3, ["relationship"]),
    leader("RC5", "recruitment", 5, ["inner_peace"]),
    leader("RC4", "recruitment", 4, ["inner_peace"]),
    leader("RC3", "recruitment", 3, ["inner_peace"]),
  ];
  const students = [
    student("S01", 5, ["financial"]), // strongest, goal covered by KR5
    student("S02", 5, ["health"]),
    student("S03", 5, ["relationship"]),
    student("S04", 4, ["financial"]),
    student("S05", 4, ["health"]),
    student("S06", 4, ["relationship"]),
    student("S07", 4, ["inner_peace"]),
    student("S08", 4, []), // no goal
    student("S09", 4, ["financial"], { suggested_leader_ids: ["KR3"] }), // suggestion beats goal
    student("S10", 4, ["health"], { suggested_leader_ids: ["NOPE"] }), // leader not serving
    student("S11", 4, ["financial"], { sells_products: true }), // caution → manual
    student("S12", 4, ["health"], { pinned_group_no: 3 }), // pin with reserved #1
  ];
  const all = [...students, ...roster.map((z) => student(z.participant_id, 5, []))];

  const result = balance(all, roster, config, { reserved_group_nos: [1] });
  const groupOf = (pid) => result.groups.find((g) => g.members.some((m) => m.participant_id === pid));
  const mainOf = (g) => g?.members.find((m) => m.role === "zu_zhang")?.participant_id;
  const reasonOf = (pid) => {
    const g = groupOf(pid);
    const line = (g?.rationale_en ?? "").split("\n").find((l) => l.startsWith(`• ${pid} — `));
    return line ?? "";
  };
  console.log(`  groups: ${result.groups.map((g) => `#${g.group_no}(${mainOf(g)})=${g.members.map((m) => m.participant_id).join(",")}`).join("  ")}`);

  // Group numbers skip the reserved #1.
  if (result.groups.some((g) => g.group_no === 1)) fail("group #1 was reserved but used");
  else pass("reserved group number skipped");

  // Pin lands in the group the admin sees as #3.
  if (groupOf("S12")?.group_no === 3) pass("pin to #3 honoured");
  else fail(`S12 pinned to #3 but in #${groupOf("S12")?.group_no}`);

  // Suggestion beats goal.
  if (mainOf(groupOf("S09")) === "KR3") pass(`suggested 组长 honoured — ${reasonOf("S09")}`);
  else fail(`S09 suggested KR3 but under ${mainOf(groupOf("S09"))}`);
  if (/not leading at this event/.test(reasonOf("S10"))) pass("unserved suggestion explained in reason");
  else fail(`S10 reason missing the suggestion note: ${reasonOf("S10")}`);

  // Caution flag → manual tray, not placed.
  const manual = (result.metadata.manual_placement ?? []).map((m) => m.participant_id);
  if (!groupOf("S11") && manual.includes("S11")) pass("caution-flagged student left for manual placement");
  else fail("S11 (flagged) was auto-placed");

  // Main goal covered whenever a covering group had room.
  for (const s of students) {
    const g = groupOf(s.participant_id);
    if (!g || s.suggested_leader_ids.length || s.pinned_group_no) continue;
    const goal = s.goal_dimensions[0];
    if (!goal) continue;
    const leaders = g.members.filter((m) => m.role !== "participant").map((m) => roster.find((z) => z.participant_id === m.participant_id));
    const covered = leaders.some((z) => z?.dimensions.includes(goal));
    if (!covered && !/no group with room covers/.test(reasonOf(s.participant_id))) {
      fail(`${s.participant_id} goal ${goal} not covered and no reason given`);
    }
  }
  pass("main goals covered (or explained)");

  // Strongest student with a financial goal sits under the grade-5 leader.
  if (mainOf(groupOf("S01")) === "KR5") pass("strongest student → grade-5 leader");
  else fail(`S01 under ${mainOf(groupOf("S01"))}, expected KR5`);

  // Every placed student has a reason line.
  const missing = students.filter((s) => groupOf(s.participant_id) && !reasonOf(s.participant_id));
  if (missing.length === 0) pass("every placed student has a reason");
  else fail(`no reason for ${missing.map((s) => s.participant_id).join(", ")}`);

  // Determinism.
  const again = balance(all, roster, config, { reserved_group_nos: [1] });
  if (JSON.stringify(again) === JSON.stringify(result)) pass("same input → identical output");
  else fail("output differs between identical runs");

  // Tier gap: no key_recruitment → borrow recruitment for the 特级 main + warn.
  const roster2 = [
    leader("RC9", "recruitment", 5, ["financial"]),
    leader("RC8", "recruitment", 4, ["health"]),
  ];
  const students2 = [student("T01", 5, ["financial"]), student("T02", 5, ["health"])];
  const all2 = [...students2, ...roster2.map((z) => student(z.participant_id, 5, []))];
  const r2 = balance(all2, roster2, config);
  const borrowed = (r2.metadata.warnings ?? []).filter((w) => w.code === "tier_borrowed");
  const g2 = r2.groups[0];
  if (g2 && mainOf(g2) && borrowed.length > 0) {
    pass(`missing 重点感召型 → borrowed (${borrowed.map((w) => w.detail_en).join("; ")})`);
  } else {
    fail("tier gap did not borrow / warn");
  }
  if (/borrowed/.test(g2?.rationale_en ?? "")) pass("borrow shown in group rationale");
  else fail("borrow missing from rationale");

  // ---- Language groups (universal) ----
  const roster3 = [
    leader("ZH5", "key_recruitment", 5, ["financial"]),
    leader("ZH4", "recruitment", 4, ["health"]),
    leader("BI5", "key_recruitment", 5, ["health"], ["zh", "en"]), // bilingual
    leader("EN3", "recruitment", 3, ["relationship"], ["en"]),
    leader("VI4", "maintenance", 4, ["inner_peace"], ["vi", "zh"]),
  ];
  const students3 = [
    student("C01", 5, ["financial"]),
    student("C02", 5, ["health"]),
    student("E01", 5, ["health"], { listening_language: "en" }),
    student("E02", 2, ["financial"], { listening_language: "en" }), // other type, same language
    student("E03", 1, [], { listening_language: "en", suggested_leader_ids: ["ZH5"] }), // can't cross language
    student("V01", 3, ["inner_peace"], { listening_language: "vi" }),
    student("V02", 4, [], { listening_language: "vi" }),
    student("M01", 3, [], { listening_language: "ms" }), // a language nobody speaks
  ];
  const all3 = [...students3, ...roster3.map((z) => student(z.participant_id, 5, [], { listening_language: z.listening_language }))];
  const r3 = balance(all3, roster3, config);
  const g3 = (pid) => r3.groups.find((g) => g.members.some((m) => m.participant_id === pid));
  console.log(`  language groups: ${r3.groups.map((g) => `#${g.group_no}[${g.language}/${g.group_class}]=${g.members.map((m) => m.participant_id).join(",")}`).join("  ")}`);
  const langOk = students3.every((s) => g3(s.participant_id)?.language === s.listening_language);
  if (langOk) pass("every student sits in a group of their listening language");
  else fail("a student landed in another language's group");
  const enGroup = g3("E01");
  if (enGroup && g3("E02") === enGroup) pass("English listeners of different types share the English group");
  else fail("English listeners split by type");
  const speaker = (g) => {
    const main = g?.members.find((m) => m.role === "zu_zhang");
    const z = roster3.find((x) => x.participant_id === main?.participant_id);
    return z && g ? z.spoken_languages.includes(g.language) : false;
  };
  if (["E01", "V01", "C01"].every((pid) => speaker(g3(pid)))) pass("EN / VI / 中文 groups each led by a speaker");
  else fail("a language group's 主组长 doesn't speak its language");
  const reasonE03 = (g3("E03")?.rationale_en ?? "").split("\n").find((l) => l.startsWith("• E03 — ")) ?? "";
  if (mainOf(g3("E03")) !== "ZH5" && /student listens in English/.test(reasonE03)) pass("suggestion never crosses language (explained)");
  else fail(`E03 suggestion crossed language or unexplained: ${reasonE03}`);
  const missingLang = (r3.metadata.warnings ?? []).filter((w) => w.code === "language_leader_missing");
  if (missingLang.some((w) => /Melayu/.test(w.detail_en))) pass(`no Malay speaker → warned (${missingLang[0].detail_en})`);
  else fail("missing-speaker language not warned");
  // A speaker of another tier must be borrowed for a rarer language before
  // a 中文 group claims them as an exact-tier leader (regression, 2026-11-25).
  const roster4 = [
    leader("K1", "key_recruitment", 5, ["financial"]),
    leader("R1", "recruitment", 5, ["health"]),
    leader("M1", "maintenance", 3, ["spiritual"], ["zh", "vi"]),
    leader("A1", "auxiliary", 3, ["health"]),
    leader("A2", "auxiliary", 2, ["financial"]),
  ];
  const students4 = [
    student("Z01", 5, ["financial"]),
    student("Z02", 2, ["health"]),
    student("VV1", 4, [], { listening_language: "vi" }),
  ];
  const r4 = balance(
    [...students4, ...roster4.map((z) => student(z.participant_id, 5, [], { listening_language: z.listening_language }))],
    roster4,
    config,
  );
  const viGroup = r4.groups.find((g) => g.members.some((m) => m.participant_id === "VV1"));
  if (mainOf(viGroup) === "M1") pass("Vietnamese group borrows the only vi speaker before 中文 groups take them");
  else fail(`Vietnamese group led by ${mainOf(viGroup)}, expected M1`);

  const v3 = validateGrouping(r3.groups, all3.filter((p) => !roster3.some((z) => z.participant_id === p.participant_id)), roster3, config);
  const langErrs = v3.errors.filter((e) => e.code === "language_mismatch");
  if (langErrs.length === 0) pass("validator: no language mismatches");
  else fail(`validator language errors: ${langErrs.map((e) => e.detail).join("; ")}`);

  return ok;
}

// -----------------------------------------------------------------------------
// Run
// -----------------------------------------------------------------------------

async function main() {
  // Sanity-check our synthetic generator: print qualification distribution.
  const sample = buildSynthetic(50);
  const qDist = { basic: 0, rising: 0, elite: 0, excellence: 0, strategic: 0, unscored: 0 };
  for (const p of sample) {
    const q = scoreToQualification(Math.max(p.financial_score ?? 0, p.influence_score ?? 0)) ?? "unscored";
    qDist[q] += 1;
  }
  console.log(`Synthetic qualification distribution: ${Object.entries(qDist).map(([k, v]) => `${k}=${v}`).join(", ")}`);

  const r1 = checkBalance();
  const r2 = checkCushion();
  const r3 = checkRules();

  console.log(`\n${r1 && r2 && r3 ? "✓ ALL CHECKS PASSED" : "✗ SOME CHECKS FAILED"}`);
  process.exit(r1 && r2 && r3 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
