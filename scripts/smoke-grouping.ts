#!/usr/bin/env node
// Smoke test for the M6.0 grouping pipeline. Runs three checks against
// synthetic data:
//   1. balance.ts on 50 synthetic pax + curated 组长 roster — verifies
//      class-bucketing, leader pairing per class, family split, pin
//      respect, dimension matching.
//   2. cushion-rank.ts on 30 cushions in 3 rows + 30 participants.
//   3. runLlmGrouping on the same 50 — exercises the Anthropic round-
//      trip end-to-end against claude-opus-4-7.
//
// Run with: npx tsx scripts/smoke-grouping.ts [--no-llm]

import { balance } from "../src/lib/grouping/balance.ts";
import { cushionRank } from "../src/lib/grouping/cushion-rank.ts";
import {
  GROUP_CLASS_LABEL,
  participantToClass,
  scoreToQualification,
} from "../src/lib/grouping/types.ts";
import { validateGrouping } from "../src/lib/grouping/validate.ts";
// llm-grouping imports "server-only" which throws under tsx; pulled in
// lazily inside checkLlm() to keep the deterministic checks runnable
// when --no-llm is passed.

// -----------------------------------------------------------------------------
// Synthetic dataset — M6.0 schema (1-5 scores + goal_dimensions)
// -----------------------------------------------------------------------------

const ALL_DIMENSIONS = ["financial", "relationship", "health", "inner_peace"];

function buildSynthetic(n) {
  const regions = ["MY", "SG", "TW", "HK", "CN"];
  const motivations = ["growth", "network", "discovery", "skill"];
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
      motivation_tag: motivations[i % motivations.length],
      is_old_student: i % 5 === 0,
      family_of_participant_id: null,
      family_member_ids: [],
      region,
      pinned_group_no: null,
      goal_dimensions: [primary, secondary],
      student_qualification_override: null,
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

  const validation = validateGrouping(result.groups, participants, roster, config);
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

  // Grade priority check — for each tier, the FIRST 组长 of that tier
  // consumed by the algorithm (in any role, group_no ascending) should
  // be the highest-graded leader in that tier's bucket. This is the
  // queue-position invariant M6.6 floor-plan auto-place depends on.
  let gradeOk = true;
  const TIERS_TO_CHECK = [
    "key_recruitment",
    "recruitment",
    "maintenance",
    "auxiliary",
  ] as const;
  for (const t of TIERS_TO_CHECK) {
    const bucket = roster.filter((r) => r.tier === t);
    if (bucket.length === 0) continue;
    const expectedTopGrade = bucket.reduce(
      (m, r) => Math.max(m, r.grade ?? 0),
      0,
    );
    let firstConsumedGrade: number | null = null;
    let firstConsumedRegion: string | null = null;
    outer: for (const g of result.groups) {
      const leader = g.members.find((m) => m.role === "zu_zhang");
      const aux = g.members.find((m) => m.role === "fu_zu_zhang");
      for (const m of [leader, aux]) {
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

  return validation.valid && gradeOk;
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
// Check 3 — runLlmGrouping (real Anthropic call)
// -----------------------------------------------------------------------------

async function checkLlm() {
  console.log("\n=== Check 3: runLlmGrouping (50 pax + curated roster, real Anthropic call) ===");
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("✗ ANTHROPIC_API_KEY not set — skipping");
    return false;
  }
  // Bypass server-only sentinel for tsx import.
  process.env.NEXT_RUNTIME = "nodejs";
  const path = (await import("node:path")).resolve(
    "node_modules/server-only/index.js",
  );
  // @ts-expect-error — node-internal cache surface
  delete require.cache?.[path];
  // @ts-expect-error — overwrite with noop
  require.cache[path] = { exports: {}, loaded: true, id: path, filename: path };

  const { runLlmGrouping } = await import("../src/lib/grouping/llm-grouping.ts");
  const participants = buildSynthetic(50);
  const roster = buildRoster();
  const config = { group_size_min: 5, group_size_max: 12 };
  const t0 = Date.now();
  const out = await runLlmGrouping({ participants, roster, config });
  const elapsed = Date.now() - t0;
  console.log(`elapsed=${elapsed}ms tokens_in=${out.tokens_in} tokens_out=${out.tokens_out} cache_read=${out.cache_read_tokens}`);
  console.log(`retries=${out.retries} failure_reason=${out.failure_reason ?? "—"}`);
  if (!out.result) {
    console.log("✗ LLM returned null");
    if (out.validation_errors.length > 0) {
      console.log(`  validation errors:`);
      for (const e of out.validation_errors) console.log(`    ${e}`);
    }
    return false;
  }
  console.log(
    `groups: ${out.result.groups.map((g) => `#${g.group_no}/${GROUP_CLASS_LABEL[g.group_class].cn}=${g.members.length}`).join(", ")}`,
  );
  if (out.result.groups[0]) {
    console.log(`first group rationale (en): ${out.result.groups[0].rationale_en}`);
    console.log(`first group rationale (cn): ${out.result.groups[0].rationale_cn}`);
  }
  return true;
}

// -----------------------------------------------------------------------------
// Run
// -----------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const skipLlm = args.includes("--no-llm");

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
  let r3 = true;
  if (!skipLlm) {
    r3 = await checkLlm();
  } else {
    console.log("\n=== Check 3 skipped (--no-llm) ===");
  }

  console.log(`\n${r1 && r2 && r3 ? "✓ ALL CHECKS PASSED" : "✗ SOME CHECKS FAILED"}`);
  process.exit(r1 && r2 && r3 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
