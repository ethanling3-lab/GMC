import { NextResponse } from "next/server";
import { requireParticipant } from "@/lib/participant-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { isEventFull } from "@/lib/event-capacity";
import { createPaymentAccessToken } from "@/lib/tokens";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ slug: string }> };

// POST /api/me/events/[slug]/register — logged-in participant confirms
// registration for an event. Skips all the public /register field
// collection since the profile is already on file.
//
// Behavior:
//   1. requireParticipant() — session must be linked to a participants row
//   2. Load event by slug; reject if not status=open
//   3. Capacity check via isEventFull
//   4. Insert enrollment (referrer = self for now; no separate referrer
//      tracking on quick re-registration; that's the recruit flow)
//   5. Mint payment token if there's a price
//   6. Return {payment_token, enrollment_id} so the client can redirect

export async function POST(_req: Request, { params }: RouteCtx) {
  const participant = await requireParticipant();
  const { slug } = await params;

  const service = createSupabaseServiceClient();
  const { data: event } = await service
    .from("events")
    .select("id, slug, status, capacity, requires_approval, price")
    .eq("slug", slug)
    .maybeSingle();
  if (!event) {
    return NextResponse.json({ error: "event_not_found" }, { status: 404 });
  }
  const ev = event as {
    id: string;
    status: string;
    capacity: number | null;
    requires_approval: boolean;
    price: number | string | null;
  };
  if (ev.status !== "open") {
    return NextResponse.json({ error: "event_not_open" }, { status: 409 });
  }

  // Capacity gate.
  if (ev.capacity && (await isEventFull(service, ev.id, ev.capacity))) {
    return NextResponse.json({ error: "event_full" }, { status: 409 });
  }

  // Duplicate guard — relies on the (participant_id, event_id) unique
  // constraint, but we check first so we can return a clean 409.
  const { data: existing } = await service
    .from("enrollments")
    .select("id")
    .eq("participant_id", participant.id)
    .eq("event_id", ev.id)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ error: "already_enrolled" }, { status: 409 });
  }

  const status = ev.requires_approval ? "pending_approval" : "approved";
  const { data: enrollment, error: insErr } = await service
    .from("enrollments")
    .insert({
      participant_id: participant.id,
      event_id: ev.id,
      status,
      payment_status: "none",
    })
    .select("id")
    .single();
  if (insErr || !enrollment) {
    return NextResponse.json(
      { error: "insert_failed", detail: insErr?.message ?? "unknown" },
      { status: 500 },
    );
  }

  // Mint payment token if there's a price.
  const paymentToken =
    ev.price && Number(ev.price) > 0
      ? createPaymentAccessToken(enrollment.id, 30 * 24 * 60 * 60 * 1000) // 30 days
      : null;

  return NextResponse.json(
    {
      ok: true,
      enrollment_id: enrollment.id,
      status,
      payment_token: paymentToken,
    },
    { status: 201 },
  );
}
