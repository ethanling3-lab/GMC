// Parallel fan-out runner for bulk inbox operations. Caps in-flight
// requests at `concurrency` (default 4) so we don't slam the Supabase /
// Meta pipeline with N parallel writes on a 50-row selection.
//
// Returns a summary of {ok, failed} ids so the toolbar can render an
// inline error count without a hard surface — most bulk failures are
// recoverable retries (network blip, transient 5xx).

export type BulkOpResult = {
  ok: string[];
  failed: Array<{ id: string; error: string }>;
};

export async function runBulk<T>(
  ids: string[],
  worker: (id: string) => Promise<T>,
  opts: { concurrency?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<BulkOpResult> {
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const ok: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];

  let cursor = 0;
  let done = 0;
  const total = ids.length;

  async function take(): Promise<void> {
    while (cursor < total) {
      const i = cursor++;
      const id = ids[i];
      try {
        await worker(id);
        ok.push(id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        failed.push({ id, error: msg });
      } finally {
        done += 1;
        opts.onProgress?.(done, total);
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, total) }, () => take());
  await Promise.all(workers);
  return { ok, failed };
}
