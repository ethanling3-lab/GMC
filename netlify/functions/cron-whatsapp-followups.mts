import type { Config } from "@netlify/functions";

// Hourly trigger for the WhatsApp payment follow-up. All logic lives in the
// Next route, which does nothing unless an admin has turned follow-ups on.

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

  const res = await fetch(`${base.replace(/\/$/, "")}/api/cron/whatsapp-followups`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
  });
  const body = await res.text();
  console.log(`[cron-whatsapp-followups] ${res.status} ${body}`);
  return new Response(body, {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
  });
};

export const config: Config = {
  schedule: "@hourly",
};
