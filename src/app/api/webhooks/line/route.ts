import { NextResponse } from "next/server";
import { ingestWebhook } from "@/lib/inbox/ingest";
import { lineAdapter } from "@/lib/inbox/channels/line";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// LINE Messaging API webhook. LINE doesn't do a verify-challenge handshake —
// configuration is one-time in the Developer Console. Inbound events arrive
// as POST with X-Line-Signature (HMAC-SHA256 base64 over the raw body).

export async function POST(req: Request) {
  const rawBody = await req.text();

  const ok = await lineAdapter.verifyWebhook(req, rawBody);
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
    const summary = await ingestWebhook("line", body);
    if (summary.errors.length > 0) {
      console.warn("[webhooks.line] partial failure", summary);
    }
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error("[webhooks.line] ingest error", err);
    return NextResponse.json({ ok: true, ingest_error: true });
  }
}
