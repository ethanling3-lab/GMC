import { NextResponse } from "next/server";
import { runReminderCron } from "@/lib/reminders/cron-run";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Triggered hourly by netlify/functions/cron-reminders.mts (or any external
// scheduler). Pings runReminderCron(), which scans events whose
// start_date sits inside the 48-hour band (and 24-hour band when enabled)
// and emails paid participants a reminder with their check-in QR.
//
// Auth: `Authorization: Bearer ${CRON_SECRET}` header required. The header
// gate is the only auth layer — there's no user session — so the secret
// must be set in Netlify env.

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
  if (!secret) {
    // No secret configured → only allow in dev for local smoking.
    return process.env.NODE_ENV !== "production";
  }
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  return timingSafeEqual(match[1], secret);
}

async function handle(req: Request): Promise<Response> {
  if (!isAuthorised(req)) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  try {
    const result = await runReminderCron();
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[cron/reminders]", msg);
    return NextResponse.json(
      { error: "server_error", detail: msg },
      { status: 500 },
    );
  }
}

// GET so a browser / curl / Netlify scheduled function can fire it without
// needing to negotiate a request body. POST is accepted for parity.
export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
