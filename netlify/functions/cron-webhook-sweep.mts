import type { Config } from "@netlify/functions";

// 5-minute scheduled trigger for the inbound queue. Two jobs, both recovery:
//
//   1. reap rows stuck in 'processing' by a worker that crashed or timed out
//   2. drain anything still pending — a kick that never landed, a retry whose
//      backoff has elapsed, or rows the sweeper itself just reclaimed
//
// Without this, a single crashed worker parks a conversation indefinitely and
// nothing ever notices. 5 minutes matches cron-broadcasts-due; inbound is
// latency-sensitive, but this is the safety net, not the main path — the
// webhook kick is.

export default async (_req: Request) => {
  const base = process.env.URL ?? process.env.NEXT_PUBLIC_SITE_URL;
  if (!base) {
    return new Response(JSON.stringify({ error: "no_base_url" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return new Response(JSON.stringify({ error: "missing_CRON_SECRET" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  const res = await fetch(`${base.replace(/\/$/, "")}/api/cron/webhook-sweep`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
  });
  const body = await res.text();
  console.log(`[cron-webhook-sweep] ${res.status} ${body}`);
  return new Response(body, {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
  });
};

export const config: Config = {
  schedule: "*/5 * * * *",
};
