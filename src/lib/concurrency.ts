// Bounded-concurrency map with a wall-clock deadline.
//
// WHY THIS EXISTS
//
// Several admin routes fan out over a list that is bounded by "how many rows
// an admin selected", not by anything technical — bulk enrolment actions
// accept up to 500 ids. Written as `await Promise.all(rows.map(...))` that
// opens 500 concurrent SMTP + Graph calls from a serverless function with a
// 26-second ceiling, and the route still reports success for every row.
//
// The deadline is the important half. A concurrency cap alone makes the
// failure tidier without making it less likely: 500 notifications at 6-wide
// and ~1.5s each is ~2 minutes, so the function is killed mid-flight either
// way. Callers need to KNOW they ran out of time so they can tell the admin
// which rows still need a resend, instead of silently claiming all 500 landed.
//
// This is a stopgap for routes that should eventually enqueue to a background
// function (see netlify/functions/broadcast-fanout-background.ts for the
// pattern). Use it where the work is usually small and occasionally isn't.

export type ConcurrentMapResult<R> = {
  /** Same order as `items`; `undefined` where the item never ran. */
  results: Array<R | undefined>;
  /** Items whose callback ran to completion (successfully or by throwing). */
  completed: number;
  /** Items never started because the deadline passed. */
  skipped: number;
  /** True when the deadline stopped the run early. */
  timedOut: boolean;
};

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  fn: (item: T, index: number) => Promise<R>,
  opts: {
    concurrency: number;
    /**
     * Stop STARTING new items after this many ms. In-flight work is allowed
     * to finish — cancelling a half-sent notification is worse than waiting
     * for it. Budget for that overrun when choosing the value.
     */
    deadlineMs?: number;
    /** Called when an item's callback throws. Defaults to swallowing. */
    onError?: (err: unknown, item: T, index: number) => void;
  },
): Promise<ConcurrentMapResult<R>> {
  const results: Array<R | undefined> = new Array(items.length).fill(undefined);
  if (items.length === 0) {
    return { results, completed: 0, skipped: 0, timedOut: false };
  }

  const startedAt = Date.now();
  const expired = () =>
    opts.deadlineMs !== undefined && Date.now() - startedAt >= opts.deadlineMs;

  let cursor = 0;
  let completed = 0;
  let timedOut = false;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      if (expired()) {
        timedOut = true;
        return;
      }
      const index = cursor++;
      try {
        results[index] = await fn(items[index], index);
      } catch (err) {
        opts.onError?.(err, items[index], index);
      }
      completed++;
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, opts.concurrency), items.length) }, () =>
      worker(),
    ),
  );

  return { results, completed, skipped: items.length - completed, timedOut };
}
