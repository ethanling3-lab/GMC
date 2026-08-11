// Unit checks for src/lib/whatsapp/phone.ts.
//
// The repo has no test runner (only tsx), so this is a plain assert script:
//   npm run check:phone
//
// Every case marked [db] is a real shape found in the participants table by
// the 2026-08-09 census, so this doubles as a regression net for the backfill
// in migration 052.

import assert from "node:assert/strict";
import { normalizePhone } from "../src/lib/whatsapp/phone";

type Case = {
  raw: string;
  region?: string | null;
  expect: string | { reason: string };
  note?: string;
};

const CASES: Case[] = [
  // --- the bug that started Phase 1 -----------------------------------------
  { raw: "012-345 6789", region: "MY", expect: "+60123456789", note: "trunk 0 dropped, separators stripped" },
  { raw: "012-345 6789", region: "SG", expect: { reason: "invalid_for_country" }, note: "same digits are not an SG number" },

  // --- already clean (400 of 409 rows) --------------------------------------
  { raw: "+6591234567", region: "SG", expect: "+6591234567" },
  { raw: "+60123456789", region: "MY", expect: "+60123456789" },
  { raw: "+85261234567", region: "HK", expect: "+85261234567" },
  { raw: "+886912345678", region: "TW", expect: "+886912345678" },
  { raw: "+8613800138000", region: "CN", expect: "+8613800138000" },

  // --- [db] the 9 rows that need work ---------------------------------------
  { raw: "+65 86111315", region: "MY", expect: "+6586111315", note: "[db] space after cc; typed cc wins over region" },
  { raw: "+65 86131555", region: "SG", expect: "+6586131555", note: "[db]" },
  { raw: "+60 0127701231", region: "MY", expect: "+60127701231", note: "[db] cc AND trunk zero both present" },
  { raw: "+60 128070550", region: "MY", expect: "+60128070550", note: "[db]" },
  { raw: "86111315", region: "SG", expect: "+6586111315", note: "[db] bare local number, region supplies cc" },
  {
    raw: "+65 0127701231",
    region: "MY",
    expect: { reason: "invalid_for_country" },
    note: "[db] wrong cc + trunk zero — refuse to guess, a wrong guess messages a stranger",
  },

  // --- country-code-without-plus --------------------------------------------
  { raw: "6586111315", region: "SG", expect: "+6586111315" },
  { raw: "60123456789", region: "MY", expect: "+60123456789" },
  { raw: "0065 9123 4567", region: "SG", expect: "+6591234567", note: "00 international prefix" },

  // --- the leading-digit trap ------------------------------------------------
  {
    raw: "60123456",
    region: "HK",
    expect: "+85260123456",
    note: "a real HK number starting 60 must not lose digits to the MY country code",
  },
  {
    raw: "60123456",
    region: "MY",
    expect: { reason: "invalid_for_country" },
    note: "8 digits is not a valid MY number either way",
  },

  // --- no-trunk plans reject a leading zero ---------------------------------
  { raw: "086111315", region: "SG", expect: { reason: "invalid_for_country" } },
  { raw: "061234567", region: "HK", expect: { reason: "invalid_for_country" } },

  // --- trunk plans accept one ------------------------------------------------
  { raw: "0912345678", region: "TW", expect: "+886912345678" },
  { raw: "013800138000", region: "CN", expect: "+8613800138000" },

  // --- unknown country passes through ----------------------------------------
  { raw: "+6281234567890", region: "SG", expect: "+6281234567890", note: "Indonesia — no rules, but already international" },

  // --- rejects ---------------------------------------------------------------
  { raw: "", region: "SG", expect: { reason: "empty" } },
  { raw: "   ", region: "SG", expect: { reason: "empty" } },
  { raw: "abc", region: "SG", expect: { reason: "empty" } },
  { raw: "12345", region: "SG", expect: { reason: "too_short" } },
  { raw: "86111315", region: null, expect: { reason: "unknown_country" } },
  { raw: "86111315", region: "JP", expect: { reason: "unknown_country" }, note: "region we have no rules for" },

  // --- full-width digits (CN/TW IME) ------------------------------------------
  { raw: "＋６５ ８６１１１３１５", region: "SG", expect: "+6586111315" },

  // --- malformed international prefix ------------------------------------------
  // The seeded M6 dummies use '+0099…'. A country code never starts with 0, so
  // these must be rejected rather than passed through — migration 052's format
  // check caught 300 of them on the first backfill run.
  { raw: "+00990000134", region: "CN", expect: { reason: "invalid_for_country" } },
  { raw: "+0065 9123 4567", region: "SG", expect: { reason: "invalid_for_country" }, note: "international prefix typed twice" },
  { raw: "+0123456789", region: "MY", expect: { reason: "invalid_for_country" }, note: "trunk zero kept after the +" },
];

// Migration 052's CHECK constraint. Every success MUST satisfy it, or the
// backfill fails mid-run against the database — which is exactly how the
// '+0099…' gap above was found.
const DB_CONSTRAINT = /^\+[1-9][0-9]{6,14}$/;

let failed = 0;
for (const c of CASES) {
  const got = normalizePhone(c.raw, c.region);
  const label = `${JSON.stringify(c.raw)} (${c.region ?? "no region"})${c.note ? ` — ${c.note}` : ""}`;
  try {
    if (typeof c.expect === "string") {
      assert.equal(got.ok, true, `expected ok, got ${got.ok ? "" : `${got.reason}: ${got.detail}`}`);
      assert.equal(got.ok && got.e164, c.expect);
      assert.match(
        c.expect,
        DB_CONSTRAINT,
        `expected value would be rejected by participants_phone_e164_format_ck`,
      );
    } else {
      assert.equal(got.ok, false, `expected rejection ${c.expect.reason}, got ${got.ok ? got.e164 : ""}`);
      assert.equal(!got.ok && got.reason, c.expect.reason);
    }
    console.log(`  ok  ${label}`);
  } catch (err) {
    failed++;
    console.error(`FAIL  ${label}\n      ${(err as Error).message}`);
  }
}

console.log(`\n${CASES.length - failed}/${CASES.length} passed`);
if (failed > 0) process.exit(1);
