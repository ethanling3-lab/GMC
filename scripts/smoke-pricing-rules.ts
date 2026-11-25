#!/usr/bin/env node
// Rules matrix for the shared price rule (src/lib/pricing/tiers.ts
// resolvePrice). Pure — no database. Run before shipping any pricing change:
//   npx tsx scripts/smoke-pricing-rules.ts
// Every case states the expected rule, category and amount. A failure
// prints the full basis so the cause is obvious.

import { participantPriceCategory, resolvePrice, type ParticipantLike, type PriceTier } from "../src/lib/pricing/tiers.ts";

let failures = 0;
let passes = 0;

const COURSE = "11111111-1111-1111-1111-111111111111";
const tier = (key: string, amount: number, applies_to: string[]): PriceTier => ({
  key,
  label_en: key,
  label_cn: key,
  amount,
  applies_to,
});

// 会务费 300; 荣贵 course fee 500; 经典 800; 老学员 1000; 新人 1500; 其他 2000.
const TIERS = [
  tier("rg", 500, ["glorious_family"]),
  tier("classic", 800, ["classic_member"]),
  tier("old", 1000, ["returning_student"]),
  tier("new", 1500, ["new_student"]),
  tier("other", 2000, ["default"]),
];
const EVENT = { id: "e", misc_fee: 300, price_tiers: TIERS, course_id: COURSE, start_date: "2027-03-12", price: null };

const rg = (expires: string | null): ParticipantLike => ({
  programme_slug: "glorious_family",
  programme_expires_at: expires,
  is_old_student: false,
  has_attended: false,
});

function expect(
  name: string,
  event: Parameters<typeof resolvePrice>[0],
  p: ParticipantLike | null,
  want: { rule: string; category?: string; amount: number | null; tier_key?: string | null },
) {
  const r = resolvePrice(event, p);
  const ok =
    r.basis.rule === want.rule &&
    (want.category === undefined || r.basis.category === want.category) &&
    r.amount === want.amount &&
    (want.tier_key === undefined || r.tier_key === want.tier_key);
  if (ok) {
    passes += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${name}\n      want ${JSON.stringify(want)}\n      got  ${JSON.stringify(r.basis)}`);
  }
}

console.log("Programme members");
expect("valid 荣贵 → 荣贵 tier", EVENT, rg("2027-06-30"), {
  rule: "tier", category: "glorious_family", amount: 800, tier_key: "rg",
});
const zeroRg = { ...EVENT, price_tiers: [tier("rg0", 0, ["glorious_family"]), ...TIERS.filter((t) => t.key !== "rg")] };
expect("荣贵 tier set to 0 → 会务费 only", zeroRg, rg("2027-06-30"), { rule: "tier", amount: 300, tier_key: "rg0" });
expect("expires ON the start day → still valid", EVENT, rg("2027-03-12"), { rule: "tier", category: "glorious_family", amount: 800 });
expect("expires as a SGT-midnight timestamp on the start day → still valid", EVENT, rg("2027-03-11T16:00:00+00:00"), {
  rule: "tier", category: "glorious_family", amount: 800,
});
expect("expired the day before → 经典永流传 tier", EVENT, rg("2027-03-11"), {
  rule: "tier", category: "classic_member", amount: 1100, tier_key: "classic",
});
expect("no expiry (perpetual) → valid", EVENT, rg(null), { rule: "tier", category: "glorious_family", amount: 800 });
expect(
  "expired 精英文化财 → 经典永流传 too",
  EVENT,
  { programme_slug: "elite_cultural_heritage", programme_expires_at: "2026-01-01" },
  { rule: "tier", category: "classic_member", amount: 1100 },
);

console.log("Fallbacks");
const noClassic = { ...EVENT, price_tiers: TIERS.filter((t) => t.key !== "classic") };
expect("经典 with no 经典 tier → 老学员 tier", noClassic, rg("2026-01-01"), {
  rule: "classic_fallback", category: "classic_member", amount: 1300, tier_key: "old",
});
const onlyOther = { ...EVENT, price_tiers: [tier("other", 2000, ["default"])] };
expect("经典 with neither → 其他", onlyOther, rg("2026-01-01"), { rule: "default_tier", amount: 2300 });
expect("荣贵 with no 荣贵 tier → 其他", onlyOther, rg("2027-06-30"), {
  rule: "default_tier", amount: 2300,
});

console.log("Non-members");
expect("checked in before, no tick → 老学员", EVENT, { has_attended: true }, {
  rule: "tier", category: "returning_student", amount: 1300,
});
expect("ticked 'attended before CRM' → 老学员", EVENT, { is_old_student: true }, {
  rule: "tier", category: "returning_student", amount: 1300,
});
expect("brand new → 新人", EVENT, {}, { rule: "tier", category: "new_student", amount: 1800 });
expect("unknown guest (null) → 新人", EVENT, null, { rule: "tier", category: "new_student", amount: 1800 });

console.log("Event shapes");
expect("event with no course → still priced by tier", { ...EVENT, course_id: null }, rg("2027-06-30"), {
  rule: "tier", amount: 800,
});
expect("no tiers → misc + single price", { ...EVENT, price_tiers: [], price: 999 }, {}, {
  rule: "single_price", amount: 1299, tier_key: null,
});
expect("no tiers, 荣贵 member → misc + single price", { ...EVENT, price_tiers: [], price: 999 }, rg("2027-06-30"), {
  rule: "single_price", amount: 1299,
});
expect("nothing priced → none", { ...EVENT, price_tiers: [], price: null, course_id: null }, {}, {
  rule: "none", amount: null,
});

console.log("初训 / 复训");
const withRepeat = {
  ...EVENT,
  price_tiers: [{ ...tier("old", 7000, ["returning_student"]), repeat_amount: 3500 }, tier("other", 7000, ["default"])],
};
expect("老学员 who took the course before → 复训", withRepeat, { is_old_student: true, has_taken_course: true }, {
  rule: "tier", amount: 3800, tier_key: "old",
});
expect("老学员 first time → 初训", withRepeat, { is_old_student: true, has_taken_course: false }, {
  rule: "tier", amount: 7300,
});
expect("took it before but tier has no 复训 price → 初训", withRepeat, { has_taken_course: true }, {
  rule: "default_tier", amount: 7300, tier_key: "other",
});
expect("event with no course: 复训 never applies", { ...withRepeat, course_id: null }, { is_old_student: true, has_taken_course: false }, {
  rule: "tier", amount: 7300,
});
const rr = resolvePrice(withRepeat, { is_old_student: true, has_taken_course: true });
if (rr.basis.repeat === true) {
  passes += 1;
  console.log("  ✓ basis records repeat = true");
} else {
  failures += 1;
  console.log("  ✗ basis.repeat not recorded");
}

console.log("Determinism + category helper");
const a = JSON.stringify(resolvePrice(EVENT, rg("2027-06-30")));
const b = JSON.stringify(resolvePrice(EVENT, rg("2027-06-30")));
if (a === b) {
  passes += 1;
  console.log("  ✓ same input twice → identical output");
} else {
  failures += 1;
  console.log("  ✗ output differs between runs");
}
const cat = participantPriceCategory(rg("2027-03-11"), "2027-03-12");
if (cat === "classic_member") {
  passes += 1;
  console.log("  ✓ participantPriceCategory(day after expiry) = classic_member");
} else {
  failures += 1;
  console.log(`  ✗ participantPriceCategory gave ${cat}`);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
