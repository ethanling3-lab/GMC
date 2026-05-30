import "server-only";

// Fire-and-forget call to the Netlify background function that processes
// pending broadcast_recipients. The /-background suffix gives 15-min
// timeout and returns 202 immediately, so this fetch returns near
// instantly — the caller doesn't need to await the actual send work.
//
// In dev (no NEXT_PUBLIC_SITE_URL pointed at a running Netlify deploy)
// the function won't be reachable; we surface that via the returned
// `mocked` flag so smoke scripts can branch.

const FUNCTION_PATH = "/.netlify/functions/broadcast-fanout-background";

export async function kickBroadcastFanout(broadcastId: string): Promise<{
  mocked: boolean;
  status: number | null;
  error?: string;
}> {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.URL;
  if (!base) {
    console.warn(
      `[broadcast.kick] no NEXT_PUBLIC_SITE_URL — broadcast ${broadcastId} won't fan out in this environment`,
    );
    return { mocked: true, status: null };
  }
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}${FUNCTION_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ broadcast_id: broadcastId }),
    });
    return { mocked: false, status: res.status };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "kick failed";
    console.error(`[broadcast.kick] ${msg}`);
    return { mocked: false, status: null, error: msg };
  }
}
