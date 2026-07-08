#!/usr/bin/env node
// Smoke test for Migration 042 tiered pricing (commit da98b06).
//
// Runs the REAL resolver (src/lib/pricing/tiers.ts — client-safe, no
// `server-only` guard so it imports directly) against live staging data.
// Verifies the resolution matrix the checkout paths depend on:
//   - participantPriceCategory() maps a participant record to a category
//   - resolvePriceTier() picks the right tier (or null → caller falls back)
//   - enrollmentAmountDue() returns the persisted/derived amount
//   - findTierByKey() (the admin per-enrollment override path)
//
// This does NOT exercise the browser register flow or actually insert
// enrollments — it proves the pure resolution logic against real tiers +
// the real participant population, and surfaces any category that resolves
// to no price (no matching tier AND no `default` AND null event.price).
//
// Run with: npx tsx scripts/smoke-pricing.ts
// Env needed: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "@supabase/supabase-js";
import {
  participantPriceCategory,
  resolvePriceTier,
  enrollmentAmountDue,
  findTierByKey,
  hasPriceTiers,
  type PriceTier,
  type ParticipantPriceCategory,
} from "../src/lib/pricing/tiers.ts";

const EVENT_ID =
  process.env.GMC_EVENT_ID ?? "769eef6a-a099-4603-88e6-be33b580b6a2"; // the-golden-principles

let failures = 0;
function pass(label: string, info?: string) {
  console.log(`  ✓ ${label}${info ? ` · ${info}` : ""}`);
}
function check(label: string, ok: boolean, info?: string) {
  if (ok) pass(label, info);
  else {
    failures++;
    console.error(`  ✗ ${label}${info ? ` · ${info}` : ""}`);
  }
}
function fatal(label: string, err: unknown): never {
  console.error(`  ✗ ${label}`);
  console.error(err);
  process.exit(1);
}

type EventRow = {
  id: string;
  slug: string;
  title_en: string | null;
  price: number | string | null;
  price_tiers: PriceTier[] | null;
};

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    fatal("env check", new Error("NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required"));
  const db = createClient(url, key, { auth: { persistSession: false } });

  // ── 1. Load the event under test ───────────────────────────────────
  const { data: ev, error: evErr } = await db
    .from("events")
    .select("id, slug, title_en, price, price_tiers")
    .eq("id", EVENT_ID)
    .maybeSingle<EventRow>();
  if (evErr) fatal("load event", evErr);
  if (!ev) fatal("load event", new Error(`event ${EVENT_ID} not found`));

  console.log(`\nEvent: ${ev.title_en} (${ev.slug})`);
  console.log(`  event.price = ${ev.price === null ? "null" : ev.price}`);
  console.log(`  tiered = ${hasPriceTiers(ev)}`);
  for (const t of ev.price_tiers ?? [])
    console.log(`    [${t.applies_to.join(", ")}] -> ${t.amount}  (${t.label_en} / ${t.label_cn})`);

  check("event has tiers configured", hasPriceTiers(ev));

  // ── 2. Expected matrix per category (against this event's tiers) ────
  // glorious_family -> 865, abundance -> 1999, new_student -> 2500.
  // Categories with no tier and no `default` and null price -> no price.
  console.log("\nResolution matrix (resolvePriceTier per category):");
  const ALL: ParticipantPriceCategory[] = [
    "glorious_family",
    "abundance",
    "elite_cultural_heritage",
    "glorious_cultural_heritage",
    "returning_student",
    "new_student",
  ];
  const expected: Partial<Record<ParticipantPriceCategory, number>> = {
    glorious_family: 865,
    abundance: 1999,
    new_student: 2500,
  };
  const uncovered: ParticipantPriceCategory[] = [];

  for (const cat of ALL) {
    // Build a synthetic participant record that resolves to this category.
    const p =
      cat === "returning_student"
        ? { programme_slug: null, is_old_student: true }
        : cat === "new_student"
          ? { programme_slug: null, is_old_student: false }
          : { programme_slug: cat as string, is_old_student: false };

    const derivedCat = participantPriceCategory(p);
    const tier = resolvePriceTier(ev, p);
    const due = enrollmentAmountDue({ amount_due: tier?.amount ?? null }, ev);

    const expAmt = expected[cat];
    if (expAmt !== undefined) {
      check(
        `${cat} resolves to ${expAmt}`,
        derivedCat === cat && tier?.amount === expAmt && due === expAmt,
        `tier=${tier?.tier_key ?? "none"} due=${due}`,
      );
    } else {
      // No explicit tier expected: confirm it falls through to no price.
      const noPrice = tier === null && due === 0;
      if (noPrice) uncovered.push(cat);
      console.log(
        `  ${noPrice ? "⚠" : "?"} ${cat} -> ${tier ? `${tier.amount} (${tier.tier_key})` : "NO TIER"}; amount_due falls back to ${due}`,
      );
    }
  }

  // ── 3. Admin override path (findTierByKey) ──────────────────────────
  console.log("\nAdmin override (findTierByKey by tier_key):");
  for (const t of ev.price_tiers ?? []) {
    const found = findTierByKey(ev, t.key);
    check(`override to ${t.key}`, found?.amount === t.amount, `amount=${found?.amount}`);
  }
  check("override to bogus key returns null", findTierByKey(ev, "tier-does-not-exist") === null);
  check("override clear (null key) returns null", findTierByKey(ev, null) === null);

  // ── 4. Population impact: who lands at no-price on this event ────────
  const { data: pop, error: popErr } = await db
    .from("participants")
    .select("programme_tier, is_old_student");
  if (popErr) fatal("load population", popErr);
  const counts = new Map<ParticipantPriceCategory, number>();
  for (const row of pop ?? []) {
    const cat = participantPriceCategory(row as { programme_tier?: string | null; is_old_student?: boolean | null });
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }
  console.log("\nPopulation by resolved category (all participants):");
  let atRisk = 0;
  for (const [cat, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    const tier = resolvePriceTier(ev, catToParticipant(cat));
    const flag = tier === null ? "  ⚠ NO PRICE on this event" : "";
    if (tier === null) atRisk += n;
    console.log(`  ${cat}: ${n}${flag}`);
  }

  // ── Summary ─────────────────────────────────────────────────────────
  console.log("\n" + "─".repeat(60));
  if (uncovered.length)
    console.log(
      `⚠  ${uncovered.length} categor${uncovered.length === 1 ? "y" : "ies"} have NO tier + no \`default\` + null price: ${uncovered.join(", ")}`,
    );
  if (atRisk)
    console.log(`⚠  ${atRisk} live participants would resolve to amount_due 0 on this event.`);
  if (failures) {
    console.error(`\n✗ ${failures} assertion(s) FAILED`);
    process.exit(1);
  }
  console.log("\n✓ All resolver assertions passed.");
}

function catToParticipant(cat: ParticipantPriceCategory) {
  if (cat === "returning_student") return { programme_tier: null, is_old_student: true };
  if (cat === "new_student") return { programme_tier: null, is_old_student: false };
  if (cat === "default") return { programme_tier: null, is_old_student: false };
  return { programme_tier: cat, is_old_student: false } as {
    programme_tier: string;
    is_old_student: boolean;
  };
}

main().catch((e) => fatal("uncaught", e));
