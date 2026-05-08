#!/usr/bin/env node
// Seed 300 test dummy participants for end-to-end M6.6 auto-place smoke.
//
// Wipes any existing M6_TEST_DUMMY participants for the target event, then
// inserts a fresh 300 with:
//   - top-heavy class distribution: strategic 100 / key 100 / growth 60 /
//     maintenance 40 (39 groups expected at group_size_max 10)
//   - 78 pre-flagged 组长 / 副组长 across the 4 zu_zhang tiers
//   - 30 family pairs (legacy single-edge column, both directions)
//   - 5 conflict pairs (participant_conflict_pairs table from migration 030)
//   - 5 random pinned enrollments (pinned_group_no 1..39)
//   - 300 enrollments at status='approved' linking each participant to the event
//
// Requires service-role access. Reads env from process.env or .env.local /
// .env (in that order). Region IDs are explicit MY9000+ / SG9000+ / etc. so
// they don't collide with the production sequence.
//
// Run:
//   cd gmc-crm
//   EVENT_ID=769eef6a-a099-4603-88e6-be33b580b6a2 npx tsx scripts/seed-test-dummies.ts
//
// Cleanup:
//   delete from participants where cs_notes = 'M6_TEST_DUMMY';

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";

// -----------------------------------------------------------------------------
// .env loader — same shape as scripts/seed-admin.mjs
// -----------------------------------------------------------------------------

function loadDotEnv() {
  for (const f of [".env.local", ".env"]) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      if (process.env[m[1]] !== undefined) continue;
      let v = m[2].trim();
      if (
        (v.startsWith('"') && v.endsWith('"'))
        || (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      process.env[m[1]] = v;
    }
  }
}

// -----------------------------------------------------------------------------
// Deterministic RNG so re-runs produce the same dataset.
// -----------------------------------------------------------------------------

const SEED = 42;
let rngState = SEED;
function rand(): number {
  // Simple LCG — fine for test data.
  rngState = (rngState * 1664525 + 1013904223) >>> 0;
  return rngState / 0x100000000;
}
function randInt(lo: number, hi: number): number {
  return Math.floor(rand() * (hi - lo + 1)) + lo;
}
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}
function pickN<T>(arr: readonly T[], n: number): T[] {
  const copy = arr.slice();
  const out: T[] = [];
  for (let i = 0; i < n && copy.length > 0; i += 1) {
    const idx = Math.floor(rand() * copy.length);
    out.push(copy[idx]);
    copy.splice(idx, 1);
  }
  return out;
}

// -----------------------------------------------------------------------------
// Constants — match the enums in src/lib/grouping/types.ts.
// -----------------------------------------------------------------------------

const REGIONS = ["MY", "SG", "TW", "HK", "CN"] as const;
type Region = (typeof REGIONS)[number];

const DIMENSIONS = [
  "financial",
  "relationship",
  "health",
  "inner_peace",
] as const;

const CORE_TRAITS = [
  "logical_thinking",
  "social_intelligence",
  "adaptability",
  "goal_orientation",
  "attention_to_detail",
] as const;

const PROGRAMME_TIERS = [
  "abundance",
  "glorious_family",
  "elite_cultural_heritage",
  "glorious_cultural_heritage",
] as const;

const ENERGY_PROFILES = ["high", "medium", "quiet"] as const;
const LANGUAGE_FLUENCIES = ["en", "cn", "both"] as const;
const MOTIVATIONS = [
  "clean",
  "insurance",
  "direct_sales",
  "spiritual",
  "other",
] as const;

type ZuZhangTier =
  | "key_recruitment"
  | "recruitment"
  | "maintenance"
  | "auxiliary";

// Bilingual placeholder name pool — drawn round-robin so every dummy has
// a readable name (helps QA spot families, leaders, etc.).
const SURNAMES_CN = [
  "陈","林","王","张","李","刘","黄","吴","蔡","郑",
  "周","梁","朱","许","邱","谢","洪","曾","彭","萧",
  "卓","施","孙","马","江","郭","胡","沈","邓","阮",
];
const GIVENS_CN = [
  "明","志","伟","俊","建","国","俊杰","志强","佳琪",
  "美玲","秀英","丽华","淑芬","秀美","婷婷","嘉欣","雅琪",
  "晓东","建华","华明","春来","金宝","宝珠","金花","金兰",
];
const SURNAMES_EN = [
  "Tan","Lim","Wong","Cheong","Lee","Liu","Ng","Goh","Cheah","Teo",
  "Chong","Yap","Lau","Khoo","Heng","Ho","Phang","Toh","Chua","Sim",
];
const GIVENS_EN = [
  "Wei Ming","Jia Hao","Kai Xin","Mei Ling","Hui Min","Jun Yi","Wen Xin",
  "Pei Shan","Yu Xin","Zhi Yong","Yong Sheng","Si Han","Hao Ran",
  "Xiao Ling","Xin Yu","Le Yi","Zi Han","Zhi Hao","Yi Fan","Tian Hao",
];

function makeName(i: number): { name_en: string; name_cn: string } {
  const sCn = SURNAMES_CN[i % SURNAMES_CN.length];
  const gCn = GIVENS_CN[(i * 13) % GIVENS_CN.length];
  const sEn = SURNAMES_EN[(i * 7) % SURNAMES_EN.length];
  const gEn = GIVENS_EN[(i * 11) % GIVENS_EN.length];
  return { name_cn: `${sCn}${gCn}`, name_en: `${sEn} ${gEn}` };
}

// -----------------------------------------------------------------------------
// Distribution + leader plan — top-heavy 300-pax run.
// -----------------------------------------------------------------------------

type ClassKey = "strategic" | "key" | "growth" | "maintenance";

const CLASS_TARGETS: Record<ClassKey, number> = {
  strategic: 100,
  key: 100,
  growth: 60,
  maintenance: 40,
};

// Score that pushes each class via max(financial, influence) → label
// mapping in src/lib/grouping/types.ts:scoreToQualification.
function scoreForClass(cls: ClassKey, i: number): { fin: number; inf: number } {
  if (cls === "strategic") {
    // Mix of 4 (excellence) and 5 (strategic), slight edge on 5.
    const isStrategic = i % 3 === 0;
    return isStrategic
      ? { fin: 5, inf: randInt(3, 5) }
      : { fin: 4, inf: randInt(2, 4) };
  }
  if (cls === "key") return { fin: 3, inf: randInt(1, 3) };
  if (cls === "growth") return { fin: 2, inf: randInt(1, 2) };
  return { fin: 1, inf: 1 };
}

// Leader plan — counts per (class, tier). Sums to 78.
//
// Strategic groups (13): 13 key_recruitment main + 13 recruitment aux.
// Key groups (13):       13 recruitment main + 13 maintenance aux.
// Growth groups (8):      8 maintenance main +  8 auxiliary aux.
// Maintenance groups (5): 5 maintenance main +  5 auxiliary aux.
type LeaderSlot = { cls: ClassKey; tier: ZuZhangTier };
const LEADER_PLAN: LeaderSlot[] = [];
for (let i = 0; i < 13; i += 1) LEADER_PLAN.push({ cls: "strategic", tier: "key_recruitment" });
for (let i = 0; i < 13; i += 1) LEADER_PLAN.push({ cls: "strategic", tier: "recruitment" });
for (let i = 0; i < 13; i += 1) LEADER_PLAN.push({ cls: "key", tier: "recruitment" });
for (let i = 0; i < 13; i += 1) LEADER_PLAN.push({ cls: "key", tier: "maintenance" });
for (let i = 0; i < 8; i += 1) LEADER_PLAN.push({ cls: "growth", tier: "maintenance" });
for (let i = 0; i < 8; i += 1) LEADER_PLAN.push({ cls: "growth", tier: "auxiliary" });
for (let i = 0; i < 5; i += 1) LEADER_PLAN.push({ cls: "maintenance", tier: "maintenance" });
for (let i = 0; i < 5; i += 1) LEADER_PLAN.push({ cls: "maintenance", tier: "auxiliary" });

// -----------------------------------------------------------------------------
// Build the 300 dummy participants in memory.
// -----------------------------------------------------------------------------

type DummyRow = {
  // Inputs to participants insert.
  name_en: string;
  name_cn: string;
  email: string;
  phone: string;
  region: Region;
  region_id: string;
  language: "en" | "cn";
  gender: "male" | "female";
  is_old_student: boolean;
  financial_score: number;
  influence_score: number;
  motivation_tag: (typeof MOTIVATIONS)[number];
  goal_dimensions: string[];
  programme_tier: (typeof PROGRAMME_TIERS)[number];
  energy_profile: (typeof ENERGY_PROFILES)[number];
  language_fluency: (typeof LANGUAGE_FLUENCIES)[number];
  has_special_contribution: boolean;
  times_led_groups: number;
  // Leader fields — all null for non-leaders.
  zu_zhang_tier: ZuZhangTier | null;
  zu_zhang_grade: number | null;
  zu_zhang_dimensions: string[];
  zu_zhang_core_traits: string[];
  // Computed metadata for the seeder itself.
  cls: ClassKey;
  is_leader: boolean;
  cs_notes: string;
};

function buildDummies(): DummyRow[] {
  // Plan the leader distribution per class first so we know which indexes
  // within each class get a tier flag.
  const leaderByClass: Record<ClassKey, LeaderSlot[]> = {
    strategic: [],
    key: [],
    growth: [],
    maintenance: [],
  };
  for (const slot of LEADER_PLAN) leaderByClass[slot.cls].push(slot);

  // Region rotation — even split across 5 regions, monotonic per-region
  // 4-digit suffix starting at 9000 to dodge the production sequence.
  const regionSeq: Record<Region, number> = { MY: 9000, SG: 9000, TW: 9000, HK: 9000, CN: 9000 };

  const dummies: DummyRow[] = [];
  let globalIdx = 0;
  for (const cls of ["strategic", "key", "growth", "maintenance"] as ClassKey[]) {
    const target = CLASS_TARGETS[cls];
    const leaders = leaderByClass[cls];
    for (let inClass = 0; inClass < target; inClass += 1) {
      const region = REGIONS[globalIdx % REGIONS.length];
      const seq = regionSeq[region];
      regionSeq[region] = seq + 1;
      const regionId = `${region}${seq}`;
      const { fin, inf } = scoreForClass(cls, inClass);
      const { name_en, name_cn } = makeName(globalIdx);
      const isLeader = inClass < leaders.length;
      const slot = isLeader ? leaders[inClass] : null;
      const tier = slot?.tier ?? null;
      // Leader grade biased toward higher tiers — key_recruitment skews 4-5,
      // auxiliary skews 1-3. Non-leaders get null grade.
      let grade: number | null = null;
      let timesLed = 0;
      if (tier === "key_recruitment") {
        grade = randInt(4, 5);
        timesLed = randInt(20, 35);
      } else if (tier === "recruitment") {
        grade = randInt(3, 5);
        timesLed = randInt(10, 19);
      } else if (tier === "maintenance") {
        grade = randInt(2, 4);
        timesLed = randInt(5, 9);
      } else if (tier === "auxiliary") {
        grade = randInt(1, 3);
        timesLed = randInt(0, 4);
      }
      dummies.push({
        name_en,
        name_cn,
        email: `m6test+${regionId.toLowerCase()}@gmcdummy.local`,
        phone: `+0099${String(globalIdx).padStart(7, "0")}`,
        region,
        region_id: regionId,
        language: rand() < 0.6 ? "cn" : "en",
        gender: rand() < 0.5 ? "male" : "female",
        is_old_student: rand() < 0.3,
        financial_score: fin,
        influence_score: inf,
        motivation_tag: pick(MOTIVATIONS),
        goal_dimensions: pickN(DIMENSIONS, randInt(1, 3)),
        programme_tier: pick(PROGRAMME_TIERS),
        energy_profile: pick(ENERGY_PROFILES),
        language_fluency: pick(LANGUAGE_FLUENCIES),
        has_special_contribution:
          tier === "key_recruitment" ? true : rand() < 0.05,
        times_led_groups: timesLed,
        zu_zhang_tier: tier,
        zu_zhang_grade: grade,
        zu_zhang_dimensions: tier ? pickN(DIMENSIONS, randInt(1, 2)) : [],
        zu_zhang_core_traits: tier ? pickN(CORE_TRAITS, randInt(1, 2)) : [],
        cls,
        is_leader: isLeader,
        cs_notes: "M6_TEST_DUMMY",
      });
      globalIdx += 1;
    }
  }
  return dummies;
}

// -----------------------------------------------------------------------------
// Insert / wipe.
// -----------------------------------------------------------------------------

async function wipeExisting(client: SupabaseClient, eventId: string): Promise<number> {
  // Cascading delete: enrollments + event_seat_assignments + family/conflict
  // links go via FK-on-delete-cascade. cs_notes is the wipe key.
  const { data: existing, error: selErr } = await client
    .from("participants")
    .select("id")
    .eq("cs_notes", "M6_TEST_DUMMY");
  if (selErr) throw new Error(`wipe-select failed: ${selErr.message}`);
  const ids = (existing ?? []).map((r) => r.id);
  if (ids.length === 0) return 0;
  const { error: delErr } = await client
    .from("participants")
    .delete()
    .in("id", ids);
  if (delErr) throw new Error(`wipe-delete failed: ${delErr.message}`);
  void eventId; // event-scoped wipe is implicit via FK cascade on enrollments
  return ids.length;
}

async function insertParticipants(
  client: SupabaseClient,
  dummies: DummyRow[],
): Promise<Map<string, string>> {
  // Insert in batches of 100 to keep payloads manageable. Returns a map of
  // region_id → participant_id (uuid) for the enrollment + family + conflict
  // passes that follow.
  const idByRegion = new Map<string, string>();
  const BATCH = 100;
  for (let i = 0; i < dummies.length; i += BATCH) {
    const slice = dummies.slice(i, i + BATCH);
    const rows = slice.map((d) => ({
      name_en: d.name_en,
      name_cn: d.name_cn,
      email: d.email,
      phone: d.phone,
      region: d.region,
      region_id: d.region_id,
      language: d.language,
      gender: d.gender,
      is_old_student: d.is_old_student,
      financial_score: d.financial_score,
      influence_score: d.influence_score,
      motivation_tag: d.motivation_tag,
      goal_dimensions: d.goal_dimensions,
      programme_tier: d.programme_tier,
      energy_profile: d.energy_profile,
      language_fluency: d.language_fluency,
      has_special_contribution: d.has_special_contribution,
      times_led_groups: d.times_led_groups,
      zu_zhang_tier: d.zu_zhang_tier,
      zu_zhang_grade: d.zu_zhang_grade,
      zu_zhang_dimensions: d.zu_zhang_dimensions,
      zu_zhang_core_traits: d.zu_zhang_core_traits,
      cs_notes: d.cs_notes,
      status: "active",
    }));
    const { data, error } = await client
      .from("participants")
      .insert(rows)
      .select("id, region_id");
    if (error) throw new Error(`participant insert batch ${i} failed: ${error.message}`);
    for (const r of data ?? []) {
      if (r.region_id) idByRegion.set(r.region_id, r.id);
    }
  }
  if (idByRegion.size !== dummies.length) {
    throw new Error(
      `expected ${dummies.length} participants, got ${idByRegion.size} after insert`,
    );
  }
  return idByRegion;
}

async function linkFamilies(
  client: SupabaseClient,
  dummies: DummyRow[],
  idByRegion: Map<string, string>,
): Promise<number> {
  // 30 family pairs across the 4 classes — pair indexes (0,1), (2,3), ...
  // sourced from non-leader dummies so the algorithm has clean swap fodder.
  const nonLeaders = dummies.filter((d) => !d.is_leader);
  const updates: Array<{ id: string; family_of_participant_id: string }> = [];
  let pairs = 0;
  for (let i = 0; i + 1 < nonLeaders.length && pairs < 30; i += 2) {
    const a = nonLeaders[i];
    const b = nonLeaders[i + 1];
    const aId = idByRegion.get(a.region_id);
    const bId = idByRegion.get(b.region_id);
    if (!aId || !bId) continue;
    updates.push({ id: aId, family_of_participant_id: bId });
    updates.push({ id: bId, family_of_participant_id: aId });
    pairs += 1;
  }
  // Postgrest doesn't have batch update by id — fan out via Promise.all.
  const results = await Promise.all(
    updates.map((u) =>
      client
        .from("participants")
        .update({ family_of_participant_id: u.family_of_participant_id })
        .eq("id", u.id),
    ),
  );
  for (const r of results) {
    if (r.error) throw new Error(`family link failed: ${r.error.message}`);
  }
  return pairs;
}

async function insertConflictPairs(
  client: SupabaseClient,
  dummies: DummyRow[],
  idByRegion: Map<string, string>,
): Promise<number> {
  // 5 conflict pairs from non-leader, non-family dummies. Spread across
  // classes so the conflict-split repair has variety.
  const eligible = dummies.filter((d, idx) => !d.is_leader && idx >= 60); // skip the family pool
  const rows: Array<{ a_id: string; b_id: string }> = [];
  for (let i = 0; i + 1 < eligible.length && rows.length < 5; i += 2) {
    const a = eligible[i];
    const b = eligible[i + 1];
    const aId = idByRegion.get(a.region_id);
    const bId = idByRegion.get(b.region_id);
    if (!aId || !bId) continue;
    // a_id < b_id by uuid string compare so the unique constraint (a, b)
    // doesn't get violated when the algorithm re-reads.
    if (aId < bId) rows.push({ a_id: aId, b_id: bId });
    else rows.push({ a_id: bId, b_id: aId });
  }
  if (rows.length === 0) return 0;
  const { error } = await client
    .from("participant_conflict_pairs")
    .insert(rows);
  if (error) throw new Error(`conflict pair insert failed: ${error.message}`);
  return rows.length;
}

async function insertEnrollments(
  client: SupabaseClient,
  eventId: string,
  dummies: DummyRow[],
  idByRegion: Map<string, string>,
): Promise<{ pinned: number }> {
  // 5 random pin slots (group_no 1..39) — assign to non-leader dummies so
  // they don't clash with leader seeding.
  const pinPool = dummies
    .filter((d) => !d.is_leader)
    .slice()
    .sort(() => rand() - 0.5)
    .slice(0, 5);
  const pinSet = new Set(pinPool.map((d) => d.region_id));

  const rows = dummies.map((d) => {
    const pid = idByRegion.get(d.region_id);
    if (!pid) throw new Error(`no participant id for ${d.region_id}`);
    const isPinned = pinSet.has(d.region_id);
    return {
      participant_id: pid,
      event_id: eventId,
      status: "approved",
      payment_status: "none",
      // Leader plumbing lives on the enrollment row so a participant's
      // tier/grade can vary per event.
      serving_as_zu_zhang: d.zu_zhang_tier !== null,
      zu_zhang_tier_for_event: d.zu_zhang_tier,
      zu_zhang_grade_for_event: d.zu_zhang_grade,
      pinned_group_no: isPinned ? randInt(1, 39) : null,
    };
  });

  const BATCH = 100;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const { error } = await client.from("enrollments").insert(slice);
    if (error) throw new Error(`enrollment insert batch ${i} failed: ${error.message}`);
  }
  return { pinned: pinSet.size };
}

// -----------------------------------------------------------------------------
// Main.
// -----------------------------------------------------------------------------

async function main() {
  loadDotEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const eventId = process.env.EVENT_ID;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL env var is required");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY env var is required");
  if (!eventId) {
    throw new Error(
      "EVENT_ID env var is required (e.g. 769eef6a-a099-4603-88e6-be33b580b6a2)",
    );
  }

  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Verify the event exists + is in tables mode.
  const { data: ev, error: evErr } = await client
    .from("events")
    .select("id, slug, seating_mode, group_size_min, group_size_max")
    .eq("id", eventId)
    .maybeSingle();
  if (evErr) throw new Error(`event lookup failed: ${evErr.message}`);
  if (!ev) throw new Error(`event ${eventId} not found`);
  if (ev.seating_mode !== "tables") {
    throw new Error(
      `event ${ev.slug} is in ${ev.seating_mode} mode; this seeder targets table-mode events only`,
    );
  }

  console.log(
    `\n🎯 Target event: ${ev.slug} (group_size ${ev.group_size_min}-${ev.group_size_max})`,
  );

  // 1. Wipe.
  console.log("\n🧹 Wiping any existing M6_TEST_DUMMY participants…");
  const wiped = await wipeExisting(client, eventId);
  console.log(`   removed ${wiped} prior dummy${wiped === 1 ? "" : "s"}`);

  // 2. Build.
  const dummies = buildDummies();
  const byClass: Record<ClassKey, number> = {
    strategic: 0, key: 0, growth: 0, maintenance: 0,
  };
  const byTier: Record<ZuZhangTier, number> = {
    key_recruitment: 0, recruitment: 0, maintenance: 0, auxiliary: 0,
  };
  for (const d of dummies) {
    byClass[d.cls] += 1;
    if (d.zu_zhang_tier) byTier[d.zu_zhang_tier] += 1;
  }
  console.log(
    `\n📊 Generated ${dummies.length} dummies — class split: strategic ${byClass.strategic}, key ${byClass.key}, growth ${byClass.growth}, maintenance ${byClass.maintenance}`,
  );
  console.log(
    `   leaders by tier: key_recruitment ${byTier.key_recruitment}, recruitment ${byTier.recruitment}, maintenance ${byTier.maintenance}, auxiliary ${byTier.auxiliary} (total ${byTier.key_recruitment + byTier.recruitment + byTier.maintenance + byTier.auxiliary})`,
  );

  // 3. Insert participants.
  console.log("\n👥 Inserting participants…");
  const idByRegion = await insertParticipants(client, dummies);
  console.log(`   inserted ${idByRegion.size} rows`);

  // 4. Family links.
  console.log("\n💑 Linking family pairs…");
  const familyPairs = await linkFamilies(client, dummies, idByRegion);
  console.log(`   linked ${familyPairs} pairs (${familyPairs * 2} edges)`);

  // 5. Conflict pairs.
  console.log("\n⚔️  Inserting conflict pairs…");
  const conflictPairs = await insertConflictPairs(client, dummies, idByRegion);
  console.log(`   inserted ${conflictPairs} pairs`);

  // 6. Enrollments.
  console.log("\n📨 Inserting enrollments + leader flags…");
  const { pinned } = await insertEnrollments(client, eventId, dummies, idByRegion);
  console.log(
    `   inserted ${dummies.length} enrollments (${pinned} pinned, ${byTier.key_recruitment + byTier.recruitment + byTier.maintenance + byTier.auxiliary} flagged as zu_zhang)`,
  );

  console.log(
    `\n✅ Seed complete. Open /admin/events/${eventId}/groups → Generate, then /admin/events/${eventId}/layout → Auto-place.`,
  );
}

main().catch((err) => {
  console.error("\n❌ Seed failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
