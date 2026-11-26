#!/usr/bin/env node
// Pure rules matrix for src/lib/payments/standing.ts (Phase 2, 2026-11-26).
// No database. Run: npx tsx scripts/smoke-payments-standing.ts

import { addMonthsDay, computeStanding, scheduleFromTemplate } from "../src/lib/payments/standing";

let fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : `\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`}`);
}

// Dates
eq("addMonths 0", addMonthsDay("2026-11-26", 0), "2026-11-26");
eq("addMonths 3", addMonthsDay("2026-11-26", 3), "2027-02-26");
eq("addMonths clamps 31 Jan +1", addMonthsDay("2027-01-31", 1), "2027-02-28");
eq("addMonths year roll", addMonthsDay("2026-12-15", 13), "2028-01-15");

const tpl = [
  { label: "定金", amount_sgd: 3000, due_after_months: 0, sort: 0 },
  { label: "第1期", amount_sgd: 2000, due_after_months: 1, sort: 1 },
  { label: "第2期", amount_sgd: 2000, due_after_months: 2, sort: 2 },
];
const sched = scheduleFromTemplate(tpl, "2026-11-26");
eq("schedule dates", sched.map((r) => r.due_on), ["2026-11-26", "2026-12-26", "2027-01-26"]);

const base = { total: 7000, schedule: sched };

// Counter sale, deposit paid today
let s = computeStanding({ ...base, payments: [{ amount_sgd: 3000 }], today: "2026-11-26" });
eq("deposit paid → 分期中", s.state, "partial");
eq("deposit paid → next 第1期 2000", s.next, { label: "第1期", due_on: "2026-12-26", remaining: 2000 });

// Nothing paid, deposit due today → not behind yet
s = computeStanding({ ...base, payments: [], today: "2026-11-26" });
eq("due today not late", [s.state, s.behind], ["unpaid", 0]);

// Day after: behind by deposit
s = computeStanding({ ...base, payments: [], today: "2026-11-27" });
eq("deposit missed → behind 3000", [s.state, s.behind], ["behind", 3000]);

// Paid 4000 by 27 Dec → behind 1000
s = computeStanding({ ...base, payments: [{ amount_sgd: 3000 }, { amount_sgd: 1000 }], today: "2026-12-27" });
eq("short on 第1期 → behind 1000", [s.state, s.behind, s.next?.label, s.next?.remaining], ["behind", 1000, "第1期", 1000]);

// Voided payment doesn't count
s = computeStanding({ ...base, payments: [{ amount_sgd: 3000 }, { amount_sgd: 2000, voided_at: "x" }], today: "2026-12-27" });
eq("void ignored", [s.paid, s.behind], [3000, 2000]);

// Paid ahead of schedule (rescheduled / early) → not behind
s = computeStanding({ ...base, payments: [{ amount_sgd: 6000 }], today: "2026-12-27" });
eq("paid ahead", [s.state, s.behind, s.next?.label, s.next?.remaining], ["partial", 0, "第2期", 1000]);

// Full payment
s = computeStanding({ ...base, payments: [{ amount_sgd: 7000 }], today: "2027-06-01" });
eq("完款", [s.state, s.balance, s.next], ["complete", 0, null]);

// Overpay
s = computeStanding({ ...base, payments: [{ amount_sgd: 7500 }], today: "2027-06-01" });
eq("overpay complete, balance 0", [s.state, s.balance], ["complete", 0]);

// No due dates → never behind
s = computeStanding({
  total: 5000,
  schedule: [{ label: "全款", due_on: null, amount_sgd: 5000, sort: 0 }],
  payments: [],
  today: "2030-01-01",
});
eq("no dates never behind", [s.state, s.behind], ["unpaid", 0]);

// Schedule shorter than total → balance row
s = computeStanding({
  total: 8000,
  schedule: [{ label: "定金", due_on: "2026-11-26", amount_sgd: 3000, sort: 0 }],
  payments: [{ amount_sgd: 3000 }],
  today: "2026-12-01",
});
eq("uncovered balance", s.next, { label: "Balance · 余款", due_on: null, remaining: 5000 });

// Behind capped at balance
s = computeStanding({
  total: 1000,
  schedule: [{ label: "x", due_on: "2026-01-01", amount_sgd: 5000, sort: 0 }],
  payments: [{ amount_sgd: 500 }],
  today: "2026-12-01",
});
eq("behind ≤ balance", s.behind, 500);

// Cancelled
s = computeStanding({ ...base, payments: [], today: "2027-06-01", cancelled: true });
eq("cancelled", s.state, "cancelled");

// Decimals
s = computeStanding({ total: 100.1, schedule: [], payments: [{ amount_sgd: 50.05 }, { amount_sgd: 50.05 }], today: "2026-12-01" });
eq("decimal sums", [s.paid, s.state], [100.1, "complete"]);

console.log(fail ? `\n${fail} FAILED` : "\nAll passed");
process.exit(fail ? 1 : 0);
