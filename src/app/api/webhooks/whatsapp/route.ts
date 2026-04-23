import { NextResponse } from "next/server";
import { ingestWebhook } from "@/lib/inbox/ingest";
import {
  handleVerifyChallenge,
  whatsappAdapter,
} from "@/lib/inbox/channels/whatsapp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// WhatsApp Cloud API webhook.
//
// GET: subscribe handshake — Meta calls with hub.mode=subscribe + hub.verify_token
// + hub.challenge. Reply with the challenge body if token matches ours.
//
// POST: inbound events. Verify X-Hub-Signature-256 against the raw body,
// then hand off to the channel-agnostic ingest pipeline.

export async function GET(req: Request) {
  const res = handleVerifyChallenge(req);
  return res ?? NextResponse.json({ error: "no_challenge" }, { status: 400 });
}

export async function POST(req: Request) {
  const rawBody = await req.text();

  const ok = await whatsappAdapter.verifyWebhook(req, rawBody);
  if (!ok) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  try {
    const summary = await ingestWebhook("whatsapp", body);
    if (summary.errors.length > 0) {
      console.warn("[webhooks.whatsapp] partial failure", summary);
    }
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error("[webhooks.whatsapp] ingest error", err);
    // Return 200 anyway so Meta doesn't retry into a failure loop — the
    // webhook_events table is our source of truth and we've already logged.
    return NextResponse.json({ ok: true, ingest_error: true });
  }
}
