import "server-only";

// Fire-and-forget trigger for the inbound queue worker, mirroring
// broadcasts/kick-fanout.ts. The `-background` suffix is what buys the
// 15-minute timeout; the fetch returns as soon as Netlify accepts it.
//
// Returns `dispatched:false` rather than throwing when the worker cannot be
// reached, because the caller has a real fallback (drain inline via `after()`).
// A kick that quietly fails would leave enqueued messages sitting forever —
// the failure mode this whole phase exists to remove — so "did it dispatch" has
// to be an answer, not an assumption.

const FUNCTION_PATH = "/.netlify/functions/whatsapp-ingest-background";

export async function kickIngestWorker(): Promise<{
  dispatched: boolean;
  status: number | null;
  reason?: string;
}> {
  const base = process.env.URL ?? process.env.NEXT_PUBLIC_SITE_URL;

  // localhost has no Netlify functions runtime. Don't waste a fetch on a URL
  // that is guaranteed to 404 — say so and let the caller drain inline.
  if (!base || base.includes("localhost") || base.includes("127.0.0.1")) {
    return { dispatched: false, status: null, reason: "no_functions_runtime" };
  }

  try {
    const res = await fetch(`${base.replace(/\/$/, "")}${FUNCTION_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "webhook" }),
    });
    // Netlify answers a background function with 202. Anything else means it
    // did not take the job.
    if (res.status !== 202) {
      return { dispatched: false, status: res.status, reason: "unexpected_status" };
    }
    return { dispatched: true, status: res.status };
  } catch (err) {
    return {
      dispatched: false,
      status: null,
      reason: err instanceof Error ? err.message : "kick_failed",
    };
  }
}
