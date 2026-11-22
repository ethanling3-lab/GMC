import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runPaymentFollowups } from "@/lib/whatsapp/followups";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Triggered hourly by netlify/functions/cron-whatsapp-followups.mts.
// POST only, with the shared CRON_SECRET. Unlike the older cron routes this
// has no unsigned dev mode: it messages real people, and localhost shares the
// live database.

function isAuthorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const match = (req.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const a = Buffer.from(match[1]);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!isAuthorised(req)) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  try {
    return NextResponse.json(await runPaymentFollowups());
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[cron/whatsapp-followups]", msg);
    return NextResponse.json({ error: "server_error", detail: msg }, { status: 500 });
  }
}
