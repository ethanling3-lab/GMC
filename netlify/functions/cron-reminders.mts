import type { Config } from "@netlify/functions";

// M7.2 — hourly scheduled function. Calls the Next API route that runs
// the reminder cron. Kept as a thin proxy so all the actual logic lives
// inside Next (single source of truth for env, Supabase client, mailer).
//
// The route is gated by Bearer CRON_SECRET — set this env var to the same
// value here and in the Netlify project's environment variables. Without
// a secret the route refuses in production so a misconfigured deploy
// fails loudly rather than silently sending zero reminders.

export default async (_req: Request) => {
  const base = process.env.URL ?? process.env.NEXT_PUBLIC_SITE_URL;
  if (!base) {
    return new Response(
      JSON.stringify({ error: "no_base_url" }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return new Response(
      JSON.stringify({ error: "missing_CRON_SECRET" }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }

  const res = await fetch(`${base.replace(/\/$/, "")}/api/cron/reminders`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
  });
  const body = await res.text();
  console.log(`[cron-reminders] ${res.status} ${body}`);
  return new Response(body, {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
  });
};

export const config: Config = {
  schedule: "@hourly",
};
