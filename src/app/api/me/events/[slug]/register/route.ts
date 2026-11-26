import { NextResponse } from "next/server";
import { requireParticipant } from "@/lib/participant-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { isEventFull } from "@/lib/event-capacity";
import { createPaymentAccessToken } from "@/lib/tokens";
import type { PriceTier } from "@/lib/pricing/tiers";
import { resolveEnrollmentPrice } from "@/lib/pricing/resolve-server";
import { registrationBlock } from "@/lib/event-registration-window";
import { childrenOf } from "@/lib/participants/children";
import { z } from "zod";
import { buildAnswersSchema, normalizeFormSchema } from "@/lib/event-form-schema";
import { missingProfileFields, REQUIRED_PROFILE_COLUMNS, type RequiredProfile } from "@/lib/participants/required-profile";

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
//   4. Insert enrollment with the event's question answers (Phase 5:
//      profile must have the six required details, answers must pass the
//      event's form schema)
//   5. Mint payment token if there's a price
//   6. Return {payment_token, enrollment_id} so the client can redirect

export async function POST(req: Request, { params }: RouteCtx) {
  const participant = await requireParticipant();
  const { slug } = await params;

  // Who is attending: the logged-in person and/or their children
  // (migration 084). No body = just themselves, as before.
  const body = (await req.json().catch(() => ({}))) as { participant_ids?: unknown; answers?: unknown };
  const requested = Array.isArray(body.participant_ids)
    ? [...new Set(body.participant_ids.filter((x): x is string => typeof x === "string"))]
    : [participant.id];
  if (requested.length === 0 || requested.length > 12) {
    return NextResponse.json({ error: "pick_attendees", detail: "Pick who is attending." }, { status: 400 });
  }

  const service = createSupabaseServiceClient();

  // Phase 5: the account holder's six required details must be on file.
  const { data: me } = await service.from("participants").select(REQUIRED_PROFILE_COLUMNS).eq("id", participant.id).maybeSingle();
  const missing = me ? missingProfileFields(me as unknown as RequiredProfile) : ["name" as const];
  if (missing.length) {
    return NextResponse.json(
      { error: "profile_incomplete", missing, detail: "Please complete your profile first. 请先完善个人资料。" },
      { status: 400 },
    );
  }

  const childIds = new Set((await childrenOf(participant.id, service)).map((c) => c.id));
  for (const id of requested) {
    if (id !== participant.id && !childIds.has(id)) {
      return NextResponse.json({ error: "not_your_family", detail: "You can only register yourself and your children." }, { status: 403 });
    }
  }

  const { data: event } = await service
    .from("events")
    .select("id, slug, status, capacity, requires_approval, price, misc_fee, price_tiers, course_id, start_date, enrollment_opens_at, enrollment_closes_at, form_schema")
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
    misc_fee: number | string | null;
    price_tiers: PriceTier[] | null;
    course_id: string | null;
    start_date: string | null;
    enrollment_opens_at: string | null;
    enrollment_closes_at: string | null;
  };
  if (ev.status !== "open" || registrationBlock(ev)) {
    return NextResponse.json({ error: "event_not_open" }, { status: 409 });
  }

  // The event's own questions (asked here now that everyone signs in).
  const answersParsed = buildAnswersSchema(normalizeFormSchema((event as { form_schema?: unknown }).form_schema)).safeParse(body.answers ?? {});
  if (!answersParsed.success) {
    return NextResponse.json(
      { error: "answers_invalid", detail: "Please answer the event's questions. 请回答活动问题。", issues: z.treeifyError(answersParsed.error) },
      { status: 400 },
    );
  }

  // Capacity gate.
  if (await isEventFull(service, ev.id, ev.capacity)) {
    return NextResponse.json({ error: "event_full" }, { status: 409 });
  }

  // Skip anyone already registered (the (participant_id, event_id) unique
  // constraint is the backstop).
  const { data: existingRows } = await service
    .from("enrollments")
    .select("participant_id")
    .eq("event_id", ev.id)
    .in("participant_id", requested);
  const already = new Set((existingRows ?? []).map((r) => (r as { participant_id: string }).participant_id));
  const toEnrol = requested.filter((id) => !already.has(id));
  if (toEnrol.length === 0) {
    return NextResponse.json({ error: "already_enrolled" }, { status: 409 });
  }

  const status = ev.requires_approval ? "pending_approval" : "approved";
  const created: Array<{ participant_id: string; enrollment_id: string; amount_due: number | null; payment_token: string | null }> = [];
  for (const pid of toEnrol) {
    // Each person priced on their own record (src/lib/pricing/resolve-server.ts).
    const pricing = await resolveEnrollmentPrice(ev, pid, service);
    const { data: enrollment, error: insErr } = await service
      .from("enrollments")
      .insert({
        participant_id: pid,
        event_id: ev.id,
        status,
        payment_status: "none",
        price_tier_key: pricing.price_tier_key,
        amount_due: pricing.amount_due,
        price_basis: pricing.price_basis,
        form_answers: answersParsed.data,
      })
      .select("id")
      .single();
    if (insErr || !enrollment) {
      return NextResponse.json(
        { error: "insert_failed", detail: insErr?.message ?? "unknown", created },
        { status: 500 },
      );
    }
    const due = pricing.amount_due;
    created.push({
      participant_id: pid,
      enrollment_id: enrollment.id,
      amount_due: due,
      payment_token: due && due > 0 ? createPaymentAccessToken(enrollment.id, 30 * 24 * 60 * 60 * 1000) : null,
    });
  }

  // One person → keep the old single-enrollment shape so the client can
  // go straight to payment.
  const first = created[0];
  return NextResponse.json(
    {
      ok: true,
      status,
      enrollment_id: first.enrollment_id,
      payment_token: created.length === 1 ? first.payment_token : null,
      created,
      skipped_already_enrolled: [...already],
    },
    { status: 201 },
  );
}
