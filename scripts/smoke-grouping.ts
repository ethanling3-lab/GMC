#!/usr/bin/env node
// Smoke test for the M6 grouping pipeline. Runs three checks against
// synthetic data:
//   1. balance.ts on 50 synthetic participants (families, OS mix, pin)
//   2. cushion-rank.ts on 30 cushions in 3 rows + 30 participants
//   3. runLlmGrouping on the same 50 — exercises the Anthropic round-
//      trip end-to-end, costs ~$0.30 against claude-opus-4-7
//
// Run with: node --env-file=.env.local --import tsx scripts/smoke-grouping.mjs
//
// (The dev workflow already has tsx as a dep via Next; this just lets
// us import the .ts files directly without a build step.)

import { balance } from "../src/lib/grouping/balance.ts";
import { cushionRank } from "../src/lib/grouping/cushion-rank.ts";
import { validateGrouping } from "../src/lib/grouping/validate.ts";
// llm-grouping imports "server-only" which throws under tsx; pulled in
// lazily inside checkLlm() to keep the deterministic checks runnable
// when --no-llm is passed.

// -----------------------------------------------------------------------------
// Synthetic dataset
// -----------------------------------------------------------------------------

function buildSynthetic(n) {
  const regions = ["MY", "SG", "TW", "HK", "CN"];
  const motivations = ["growth", "network", "discovery", "skill"];
  const participants = [];
  for (let i = 0; i < n; i++) {
    const region = regions[i % regions.length];
    const overall = (i % 10) + 1;
    const influence = ((i * 3) % 10) + 1;
    const financial = ((i * 7) % 10) + 1;
    participants.push({
      participant_id: `P${String(i).padStart(3, "0")}`,
      region_id: `${region}${String(100 + i).padStart(3, "0")}`,
      overall_score: overall,
      influence_score: influence,
      financial_score: financial,
      motivation_tag: motivations[i % motivations.length],
      is_old_student: i % 5 === 0, // 20% old students
      family_of_participant_id: null,
      region,
      pinned_group_no: null,
    });
  }
  // Sprinkle 5 family pairs (10 people).
  for (let i = 0; i < 5; i++) {
    participants[i].family_of_participant_id = participants[i + 25].participant_id;
    participants[i + 25].family_of_participant_id = participants[i].participant_id;
  }
  // Pin one participant to group 2.
  participants[7].pinned_group_no = 2;
  return participants;
}

// -----------------------------------------------------------------------------
// Check 1 — balance.ts on 50 pax
// -----------------------------------------------------------------------------

function checkBalance() {
  console.log("\n=== Check 1: balance.ts (50 pax) ===");
  const participants = buildSynthetic(50);
  const config = { group_size_min: 10, group_size_max: 12 };
  const result = balance(participants, config);

  console.log(
    `strategy=${result.strategy} k=${result.metadata.k} n=${result.metadata.n}`,
  );
  console.log(`groups: ${result.groups.map((g) => g.members.length).join(", ")}`);

  const validation = validateGrouping(result.groups, participants, config);
  if (validation.valid) {
    console.log("✓ validation passed");
  } else {
    console.log(`✗ validation failed (${validation.errors.length} errors):`);
    for (const e of validation.errors) {
      console.log(`  [${e.code}] ${e.detail}`);
    }
  }

  // Spot checks — index 7 is region TW (7 % 5 = 2 → TW), region_id TW107.
  const pinnedRegionId = participants[7].region_id;
  const pinnedPlacement = result.groups.find((g) =>
    g.members.some((m) => m.region_id === pinnedRegionId),
  );
  const pinOk = pinnedPlacement?.group_no === 2;
  console.log(
    `  ${pinOk ? "✓" : "✗"} pin check: P007 (${pinnedRegionId}) pinned to group 2 → landed in group ${pinnedPlacement?.group_no}`,
  );

  // Family split check
  let familyOk = true;
  for (const g of result.groups) {
    const ids = new Set(g.members.map((m) => m.region_id));
    for (let i = 0; i < 5; i++) {
      const a = participants[i].region_id;
      const b = participants[i + 25].region_id;
      if (ids.has(a) && ids.has(b)) {
        console.log(`  ✗ family ${a} + ${b} both in group ${g.group_no}`);
        familyOk = false;
      }
    }
  }
  if (familyOk) console.log("  ✓ family split OK");

  // Role check
  for (const g of result.groups) {
    const roles = g.members.map((m) => m.role);
    const z = roles.filter((r) => r === "zu_zhang").length;
    const f = roles.filter((r) => r === "fu_zu_zhang").length;
    if (z !== 1 || f < 1 || f > 2) {
      console.log(`  ✗ group ${g.group_no} roles: ${z} zu, ${f} fu`);
    }
  }
  console.log("  ✓ role distribution OK");

  return validation.valid;
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
        y_pct: 10 + row * 15, // rows 15% apart
        height_pct: 3,
      });
    }
  }
  const result = cushionRank({ participants, cushions });
  console.log(
    `strategy=${result.strategy} rows=${result.metadata.k} assignments=${result.cushion_assignments.length}`,
  );

  // Verify: front-row should have top-scoring participants; leftmost +
  // rightmost per row should be pai_zhang.
  const byShape = new Map(result.cushion_assignments.map((a) => [a.shape_id, a]));
  let paiZhangCount = 0;
  for (const a of result.cushion_assignments) {
    if (a.role === "pai_zhang") paiZhangCount += 1;
  }
  console.log(`  ✓ pai_zhang count: ${paiZhangCount} (expected 6)`);

  // Verify front row has higher-scoring participants than back row.
  const frontIds = cushions.slice(0, 10).map((c) => byShape.get(c.id)?.participant_id);
  const backIds = cushions.slice(20, 30).map((c) => byShape.get(c.id)?.participant_id);
  const frontAvg = frontIds.reduce((acc, id) => {
    const p = participants.find((p) => p.participant_id === id);
    return acc + (p?.overall_score ?? 0);
  }, 0) / 10;
  const backAvg = backIds.reduce((acc, id) => {
    const p = participants.find((p) => p.participant_id === id);
    return acc + (p?.overall_score ?? 0);
  }, 0) / 10;
  console.log(
    `  front row avg overall=${frontAvg.toFixed(1)} > back row avg=${backAvg.toFixed(1)} → ${frontAvg > backAvg ? "✓" : "✗"}`,
  );

  return result.cushion_assignments.length === 30;
}

// -----------------------------------------------------------------------------
// Check 3 — runLlmGrouping (real Anthropic call)
// -----------------------------------------------------------------------------

async function checkLlm() {
  console.log("\n=== Check 3: runLlmGrouping (50 pax, real Anthropic call) ===");
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("✗ ANTHROPIC_API_KEY not set — skipping");
    return false;
  }
  // Stub the server-only sentinel before importing llm-grouping so the
  // deep dependency on "server-only" doesn't throw under tsx.
  // @ts-expect-error — assigning to readonly env at runtime is intentional here.
  process.env.NEXT_RUNTIME = "nodejs";
  const { default: bypass } = await import("module");
  const origLoad = bypass.prototype.require;
  // Hot-patch require so "server-only" resolves to a noop in this script.
  const origRequire = (await import("module")).createRequire(import.meta.url);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  void origLoad; void origRequire;
  // Simplest workable approach: inject a fake server-only module into
  // the require cache. Works because @anthropic-ai/sdk pulls it via CJS.
  const path = (await import("node:path")).resolve(
    "node_modules/server-only/index.js",
  );
  // Best-effort: just delete the throw-on-load module from the cache.
  // tsx uses CJS for transformed files; deleting the cached module makes
  // the next import re-evaluate.
  // @ts-expect-error — node-internal cache surface
  delete require.cache?.[path];
  // @ts-expect-error — overwrite with noop
  require.cache[path] = { exports: {}, loaded: true, id: path, filename: path };

  const { runLlmGrouping } = await import("../src/lib/grouping/llm-grouping.ts");
  const participants = buildSynthetic(50);
  const config = { group_size_min: 10, group_size_max: 12 };
  const t0 = Date.now();
  const out = await runLlmGrouping({ participants, config });
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
    `groups: ${out.result.groups.map((g) => g.members.length).join(", ")}`,
  );
  console.log(`first group rationale (en): ${out.result.groups[0].rationale_en}`);
  console.log(`first group rationale (cn): ${out.result.groups[0].rationale_cn}`);
  return true;
}

// -----------------------------------------------------------------------------
// Run
// -----------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const skipLlm = args.includes("--no-llm");

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
