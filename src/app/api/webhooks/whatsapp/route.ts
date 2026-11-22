import { NextResponse } from "next/server";
import { after } from "next/server";
import { enqueueWebhook } from "@/lib/inbox/ingest";
import { kickIngestWorker } from "@/lib/inbox/kick-ingest";
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

  // ENQUEUE ONLY. The heavy work — media downloads and a Claude tool-use loop —
  // now happens in a worker.
  //
  // THIS ROUTE'S CONTRACT CHANGED, AND THE 500 IS THE POINT. It used to catch
  // everything and return `{ok:true}`, so Meta was told a message was handled
  // even when the pipeline had thrown and dropped it. Meta only retries on a
  // non-2xx, so that 200 was the difference between a recoverable failure and a
  // permanently lost message.
  //
  // Now the only thing that can fail here is writing a queue row. If that
  // fails, nothing is persisted and we WANT Meta's retry — that is exactly what
  // its 7-day redelivery is for. Anything after the enqueue is the worker's
  // problem and is retried from the queue, not from Meta.
  let summary;
  try {
    summary = await enqueueWebhook("whatsapp", body);
  } catch (err) {
    console.error("[webhooks.whatsapp] enqueue failed", err);
    return NextResponse.json({ error: "enqueue_failed" }, { status: 500 });
  }

  if (summary.errors.length > 0) {
    console.error("[webhooks.whatsapp] enqueue partial failure", summary);
    // Some events were not queued. Ask for the whole delivery again — a
    // duplicate is free (the unique index drops it), a lost message is not.
    return NextResponse.json({ error: "enqueue_partial" }, { status: 500 });
  }

  // Hand off to the worker. In production the background function takes it and
  // gets 15 minutes; where that is unreachable (localhost behind a tunnel, or a
  // failed kick) we drain inline via `after()` so the response is still sent
  // first. Either way this route does not wait for the AI.
  if (summary.inserted_messages > 0) {
    const kicked = await kickIngestWorker();
    if (!kicked.dispatched) {
      after(async () => {
        const { drainWebhookQueue } = await import("@/lib/inbox/ingest-worker");
        const drained = await drainWebhookQueue();
        if (drained.errors.length > 0) {
          console.warn("[webhooks.whatsapp] inline drain errors", drained.errors);
        }
      });
    }
  }

  return NextResponse.json({ ok: true, ...summary });
}
