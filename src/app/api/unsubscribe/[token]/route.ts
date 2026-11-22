import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { setMarketingStatus } from "@/lib/whatsapp/consent";
import { verifyUnsubscribeToken } from "@/lib/tokens";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ token: string }> };

// POST /api/unsubscribe/:token
//
// POST only: mail scanners open links with GET, and that must never
// unsubscribe anyone. Serves both the button on /unsubscribe/:token and the
// one-click unsubscribe built into mail apps (RFC 8058).
export async function POST(req: Request, { params }: RouteCtx) {
  const { token } = await params;
  const verified = verifyUnsubscribeToken(token);
  if (!verified) return NextResponse.json({ error: "invalid_link" }, { status: 404 });

  try {
    await setMarketingStatus(createSupabaseServiceClient(), {
      participantId: verified.participantId,
      status: "unsubscribed",
      source: "email_link",
      actorId: null,
    });
  } catch (err) {
    console.error("[unsubscribe] failed: %s", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "unsubscribe_failed" }, { status: 500 });
  }

  const body = await req.text().catch(() => "");
  if (body.includes("List-Unsubscribe=One-Click")) {
    return NextResponse.json({ ok: true });
  }
  return NextResponse.redirect(new URL(`/unsubscribe/${token}?done=1`, req.url), 303);
}
