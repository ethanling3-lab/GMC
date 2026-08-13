/**
 * Regression harness for the unresolved-placeholder guard.
 *
 *   npm run check:tokens
 *
 * The bug this protects against was not a wrong regex — it was a guard that
 * existed, read plausibly, and was never called. A dead check and a passing
 * check look identical in review, so the cases below assert BOTH halves:
 * detection (does it see the token) and, just as importantly, restraint (does
 * it leave ordinary prose alone). A detector that fires on normal text gets
 * switched off within a week, which is how you end up back where we started.
 *
 * Run order matters to nobody; failures print and exit 1.
 */
import assert from "node:assert/strict";
import {
  findUnresolvedTokens,
  assertNoUnresolvedTokens,
  UnresolvedTokenError,
} from "../src/lib/outbound-tokens";

type Case = { input: string; expect: string[]; why: string };

const CASES: Case[] = [
  // --- must be caught -------------------------------------------------------
  {
    input: "Hi {name}, thanks for reaching out about {event}",
    expect: ["{name}", "{event}"],
    why: "[live] the exact text that shipped to two real numbers",
  },
  {
    input: "Hi ${name}, your balance is ${amount_due}",
    expect: ["${name}", "${amount_due}"],
    why: "documented ${...} syntax, the only form the old regex caught",
  },
  {
    input: "See you at ${event.title} on ${event.start_date}",
    expect: ["${event.title}", "${event.start_date}"],
    why: "dotted paths are single tokens, not two",
  },
  {
    input: "{name} and {name} again",
    expect: ["{name}", "{name}"],
    why: "duplicates returned as found; dedupe happens at the error message",
  },
  {
    input: "Mixed {name} and ${region_id} in one line",
    expect: ["{name}", "${region_id}"],
    why: "both styles coexist in the snippet library",
  },
  {
    input: "{payment_link}",
    expect: ["{payment_link}"],
    why: "token alone, no surrounding prose",
  },

  // --- must NOT be caught ---------------------------------------------------
  {
    input: "Please bring your ID (passport or NRIC) to the 8am briefing.",
    expect: [],
    why: "ordinary message — the common case, must never be blocked",
  },
  {
    input: "报名成功！请于 8 月 12 日到会场报到。",
    expect: [],
    why: "Chinese prose — no braces, no false positive",
  },
  {
    input: "Use the {} placeholder syntax in your editor",
    expect: [],
    why: "empty braces are not a token",
  },
  {
    input: "Send { a: 1 } as the payload",
    expect: [],
    why: "spaces inside braces disqualify — this is prose/code, not a token",
  },
  {
    input: "Row {1} of the sheet",
    expect: ["{1}"],
    why: "digits are valid token chars; flagging is the safe side of the line",
  },
  {
    input: "Cost is $500 {approx}",
    expect: ["{approx}"],
    why: "a bare $ nearby must not confuse the optional-$ prefix",
  },
];

let failures = 0;

for (const c of CASES) {
  const got = findUnresolvedTokens(c.input);
  try {
    assert.deepEqual(got, c.expect);
    console.log(`  ok  ${JSON.stringify(c.input.slice(0, 46))} — ${c.why}`);
  } catch {
    failures++;
    console.error(
      `  FAIL ${JSON.stringify(c.input)}\n       expected ${JSON.stringify(c.expect)}\n       got      ${JSON.stringify(got)}\n       (${c.why})`,
    );
  }
}

// Null-ish inputs: an optional media caption is legitimately absent.
for (const empty of [null, undefined, ""]) {
  try {
    assert.deepEqual(findUnresolvedTokens(empty), []);
    console.log(`  ok  ${JSON.stringify(empty)} — absent caption is not a violation`);
  } catch {
    failures++;
    console.error(`  FAIL ${JSON.stringify(empty)} should yield []`);
  }
}

// The assert wrapper must throw, and must name the tokens.
try {
  assertNoUnresolvedTokens("Hi {name}", null, "and ${event.venue}");
  failures++;
  console.error("  FAIL assertNoUnresolvedTokens did not throw on a tokenful string");
} catch (err) {
  if (err instanceof UnresolvedTokenError) {
    assert.deepEqual(err.tokens, ["{name}", "${event.venue}"]);
    assert.ok(err.message.includes("{name}"), "message must name the token");
    console.log("  ok  assertNoUnresolvedTokens throws UnresolvedTokenError naming both tokens");
  } else {
    failures++;
    console.error(`  FAIL threw the wrong error type: ${String(err)}`);
  }
}

// ...and must stay silent on clean input, including absent parts.
try {
  assertNoUnresolvedTokens("A perfectly normal message.", undefined, null);
  console.log("  ok  assertNoUnresolvedTokens passes clean input through");
} catch (err) {
  failures++;
  console.error(`  FAIL clean input was blocked: ${String(err)}`);
}

const total = CASES.length + 3 + 2;
if (failures > 0) {
  console.error(`\n${failures} failing case${failures === 1 ? "" : "s"} of ${total}`);
  process.exit(1);
}
console.log(`\n${total}/${total} passed`);
