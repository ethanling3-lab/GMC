import type { Config } from "@netlify/functions";

// 5-minute scheduled trigger. Pings the Next route which picks up due
// broadcasts (status='scheduled' AND scheduled_for <= now), materialises
// recipients, and kicks broadcast-fanout-background for each. 5 min is
// the granularity for "send at 9:00" — finer than the M7.2 reminders
// hourly cron because day-of broadcasts often want sub-hour precision
// (e.g. "send the venue change at 14:30").

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

  const res = await fetch(`${base.replace(/\/$/, "")}/api/cron/broadcasts-due`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
  });
  const body = await res.text();
  console.log(`[cron-broadcasts-due] ${res.status} ${body}`);
  return new Response(body, {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
  });
};

export const config: Config = {
  schedule: "*/5 * * * *",
};
