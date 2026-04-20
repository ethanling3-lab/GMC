import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { verifyPaymentAccessToken } from "@/lib/tokens";
import { createPaymentRequest } from "@/lib/hitpay";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ token: string }> };

function paymentReference(enrollmentId: string, regionId: string | null): string {
  const tail = enrollmentId.replace(/-/g, "").slice(-4).toUpperCase();
  return `${regionId ?? "GMC"}-${tail}`;
}

function baseUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
}

export async function POST(_req: Request, { params }: RouteCtx) {
  const { token } = await params;
  const verified = verifyPaymentAccessToken(token);
  if (!verified) {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  }
  const enrollmentId = verified.enrollmentId;

  const service = createSupabaseServiceClient();
  const { data: row, error } = await service
    .from("enrollments")
    .select(
      "id, event_id, status, payment_status, payment_method, amount_paid, payment_provider_id, participant:participants(id, region_id, name_en, name_cn, email, phone), event:events(id, slug, title_en, title_cn, price, currency, payment_methods)",
    )
    .eq("id", enrollmentId)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  type ParticipantShape = {
    id: string;
    region_id: string | null;
    name_en: string | null;
    name_cn: string | null;
    email: string | null;
    phone: string | null;
  } | null;
  type EventShape = {
    id: string;
    slug: string;
    title_en: string | null;
    title_cn: string | null;
    price: number | string | null;
    currency: string | null;
    payment_methods: string[] | null;
  } | null;
  const participant = (row as unknown as { participant: ParticipantShape }).participant;
  const event = (row as unknown as { event: EventShape }).event;
  if (!participant || !event) {
    return NextResponse.json({ error: "missing_relation" }, { status: 422 });
  }

  if (row.status === "paid" || row.payment_status === "paid") {
    return NextResponse.json({ error: "already_paid" }, { status: 409 });
  }
  if (!event.payment_methods?.includes("hitpay")) {
    return NextResponse.json({ error: "method_not_enabled" }, { status: 409 });
  }

  const amount =
    typeof event.price === "number"
      ? event.price
      : Number(event.price ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "invalid_amount" }, { status: 422 });
  }

  const reference = paymentReference(row.id, participant.region_id);
  const titleForReceipt =
    event.title_en || event.title_cn || `GMC · ${event.slug}`;
  const fullName =
    [participant.name_en, participant.name_cn].filter(Boolean).join(" / ") || undefined;

  // The redirect lands the participant back on /pay/<token>?paid=1 so the
  // page renders a friendly "we're confirming your payment" state. The
  // webhook is the source of truth — we don't flip the row to paid here.
  const redirect = `${baseUrl()}/pay/${encodeURIComponent(token)}?paid=1`;
  const webhook = `${baseUrl()}/api/webhooks/hitpay`;

  let created;
  try {
    created = await createPaymentRequest({
      amount,
      currency: event.currency ?? "SGD",
      reference_number: reference,
      redirect_url: redirect,
      webhook,
      email: participant.email ?? undefined,
      phone: participant.phone ?? undefined,
      name: fullName,
      purpose: titleForReceipt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "hitpay_create_failed";
    return NextResponse.json({ error: "hitpay_create_failed", detail: msg }, { status: 502 });
  }

  // Stamp the enrolment so the webhook can locate the row by payment_request_id
  // and so admin sees the in-flight intent. Set payment_status='pending' so
  // the journey chip reads "awaiting payment". `payment_method='hitpay'` so
  // the receipt notif (when it eventually fires) carries the right method.
  const { error: updErr } = await service
    .from("enrollments")
    .update({
      payment_provider_id: created.id,
      payment_status: "pending",
      payment_method: "hitpay",
    })
    .eq("id", row.id);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  await writeAuditLog({
    actor_id: null,
    action: "enrollment.checkout_started",
    entity: "enrollments",
    entity_id: row.id,
    metadata: {
      event_id: row.event_id,
      provider: "hitpay",
      payment_request_id: created.id,
      mocked: created.mocked,
      amount,
      currency: event.currency ?? "SGD",
    },
  });

  return NextResponse.json({
    ok: true,
    url: created.url,
    payment_request_id: created.id,
    mocked: created.mocked,
  });
}
