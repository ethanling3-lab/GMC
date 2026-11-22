import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { drainWebhookQueue } from "@/lib/inbox/ingest-worker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Triggered every 5 min by netlify/functions/cron-webhook-sweep.mts.
//
// Recovery only — the webhook's kick is the main path. Two steps:
//   1. reap rows abandoned in 'processing' by a crashed or timed-out worker
//   2. drain whatever is pending, including rows the reap just released and
//      retries whose backoff has elapsed
//
// Auth mirrors the broadcasts cron: Bearer CRON_SECRET, and without the env
// var production refuses while dev allows unsigned requests for local smoking.

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function isAuthorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  return timingSafeEqual(match[1], secret);
}

async function handle(req: Request): Promise<Response> {
  if (!isAuthorised(req)) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  const service = createSupabaseServiceClient();

  // 10 minutes is comfortably longer than any healthy pass (the whole point of
  // the background function is that a slow Claude loop is normal), so this can
  // only catch a worker that is genuinely gone.
  const { data: reaped, error: reapErr } = await service.rpc(
    "reap_stale_webhook_events",
    { p_older_than: "10 minutes" },
  );
  if (reapErr) {
    console.error("[cron.webhook-sweep] reap failed:", reapErr.message);
  }

  const summary = await drainWebhookQueue();

  const payload = { reaped: reaped ?? 0, ...summary };
  if ((reaped ?? 0) > 0 || summary.claimed > 0 || summary.errors.length > 0) {
    console.log("[cron.webhook-sweep]", JSON.stringify(payload));
  }
  return NextResponse.json({ ok: true, ...payload });
}

export async function POST(req: Request) {
  return handle(req);
}
