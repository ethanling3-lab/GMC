// Payment standing for one programme purchase — pure, client-safe.
//
// "Behind" is measured against the buyer's OWN schedule (Ethan, 2026-11-26):
// by each due date that has passed, total paid must be ≥ total due so far.
// A row due today is not late yet. Rows with no date never make anyone
// behind. Voided payments don't count.

import type { ScheduleRow, Standing } from "./types";

const cents = (n: number) => Math.round(n * 100) / 100;

/** Add whole months to a YYYY-MM-DD day, clamping to the month's last day. */
export function addMonthsDay(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const total = (m - 1) + months;
  const ny = y + Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  const nd = Math.min(d, last);
  return `${ny}-${String(nm + 1).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

/** Build a buyer's schedule from template items and their registration day. */
export function scheduleFromTemplate(
  items: ReadonlyArray<{ label: string; amount_sgd: number; due_after_months: number; sort?: number }>,
  registeredOn: string,
): ScheduleRow[] {
  return [...items]
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    .map((it, i) => ({
      label: it.label,
      amount_sgd: cents(Number(it.amount_sgd)),
      due_on: addMonthsDay(registeredOn, it.due_after_months),
      sort: i,
    }));
}

export function computeStanding(input: {
  total: number;
  schedule: ReadonlyArray<Pick<ScheduleRow, "label" | "due_on" | "amount_sgd" | "sort">>;
  payments: ReadonlyArray<{ amount_sgd: number; voided_at?: string | null }>;
  /** YYYY-MM-DD in SGT. */
  today: string;
  cancelled?: boolean;
}): Standing {
  const total = cents(Number(input.total) || 0);
  const paid = cents(
    input.payments.filter((p) => !p.voided_at).reduce((s, p) => s + Number(p.amount_sgd || 0), 0),
  );
  const balance = cents(Math.max(0, total - paid));
  const rows = [...input.schedule].sort((a, b) => a.sort - b.sort);

  const dueSoFar = cents(
    rows
      .filter((r) => r.due_on != null && r.due_on < input.today)
      .reduce((s, r) => s + Number(r.amount_sgd || 0), 0),
  );
  // Never more behind than what is still owed on the whole purchase.
  const behind = cents(Math.min(balance, Math.max(0, dueSoFar - paid)));

  // Next row not yet covered by what's been paid (walking the schedule in order).
  let next: Standing["next"] = null;
  if (balance > 0) {
    let cum = 0;
    for (const r of rows) {
      cum = cents(cum + Number(r.amount_sgd || 0));
      if (cum > paid) {
        next = {
          label: r.label,
          due_on: r.due_on,
          remaining: cents(Math.min(Number(r.amount_sgd || 0), cum - paid)),
        };
        break;
      }
    }
    // Schedule adds up to less than the total: the rest has no row.
    if (!next) next = { label: "Balance · 余款", due_on: null, remaining: balance };
  }

  let state: Standing["state"];
  if (input.cancelled) state = "cancelled";
  else if (paid >= total) state = "complete";
  else if (behind > 0) state = "behind";
  else if (paid > 0) state = "partial";
  else state = "unpaid";

  return { total, paid, balance, due_so_far: dueSoFar, behind, next, state };
}

export type RowStatus = {
  label: string;
  due_on: string | null;
  amount_sgd: number;
  /** How much of this row is still unpaid (payments fill rows in order). */
  left: number;
  state: "paid" | "part" | "due" | "overdue";
};

/**
 * Status of each schedule row for a member: payments fill the rows in
 * order. A row is overdue when its date has passed (strictly before today)
 * and it isn't fully paid.
 */
export function rowStatuses(
  schedule: ReadonlyArray<Pick<ScheduleRow, "label" | "due_on" | "amount_sgd" | "sort">>,
  paid: number,
  today: string,
): RowStatus[] {
  let remaining = cents(paid);
  return [...schedule]
    .sort((a, b) => a.sort - b.sort)
    .map((r) => {
      const amt = cents(Number(r.amount_sgd || 0));
      const covered = Math.min(amt, Math.max(0, remaining));
      remaining = cents(remaining - covered);
      const left = cents(amt - covered);
      const state: RowStatus["state"] =
        left <= 0 ? "paid" : r.due_on && r.due_on < today ? "overdue" : covered > 0 ? "part" : "due";
      return { label: r.label, due_on: r.due_on, amount_sgd: amt, left, state };
    });
}
