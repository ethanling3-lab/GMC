import { NextResponse } from "next/server";
import { z } from "zod";
import { requireParticipant } from "@/lib/participant-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { isEventFull } from "@/lib/event-capacity";
import { upsertParticipant } from "@/lib/participants-write";
import { createPaymentAccessToken } from "@/lib/tokens";
import { writeAuditLog } from "@/lib/audit";
import { isEligibleVolunteer } from "@/lib/participant-recruit";
import { resolvePriceTier, type PriceTier } from "@/lib/pricing/tiers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/me/recruit/leads — the volunteer's primary action. Creates
// a participant + enrollment + payment token for a lead they just
// closed at a gathering. Three payment paths:
//   - 'now': returns payment_url; client redirects to HitPay
//   - 'whatsapp_link': returns payment_url + wa_deeplink so the client
//     opens whatsapp://send pre-filled
//   - 'email_link': fires the existing payment-link email side-effect
//
// All three create the same DB rows; only the post-create handoff differs.
//
// Eligibility: caller must have at least one past-paid enrollment.

const bodySchema = z
  .object({
    event_slug: z.string().min(1).max(120),
    name_cn: z.string().trim().max(80).optional(),
    name_en: z.string().trim().max(80).optional(),
    phone: z.string().trim().min(5).max(40),
    email: z.string().trim().toLowerCase().email().optional().or(z.literal("")),
    payment_plan: z.enum(["now", "whatsapp_link", "email_link"]),
  })
  .refine((v) => (v.name_cn ?? "").length > 0 || (v.name_en ?? "").length > 0, {
    message: "name_cn or name_en is required",
  });

const PAYMENT_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function POST(req: Request) {
  const volunteer = await requireParticipant();

  if (!(await isEligibleVolunteer(volunteer.id))) {
    return NextResponse.json(
      { error: "not_eligible", detail: "You need a past completed event to use recruit." },
      { status: 403 },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", detail: parsed.error.message },
      { status: 400 },
    );
  }
  const body = parsed.data;

  const service = createSupabaseServiceClient();

  // Load event.
  const { data: event } = await service
    .from("events")
    .select("id, slug, status, capacity, requires_approval, price, misc_fee, price_tiers")
    .eq("slug", body.event_slug)
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
  };
  if (ev.status !== "open") {
    return NextResponse.json({ error: "event_not_open" }, { status: 409 });
  }
  if (ev.capacity && (await isEventFull(service, ev.id, ev.capacity))) {
    return NextResponse.json({ error: "event_full" }, { status: 409 });
  }

  // Upsert the lead. Email is optional on recruit (volunteers often capture
  // phone only and chase email later) — but upsertParticipant requires it.
  // For email-less leads we synthesise a placeholder of the form
  // `<phone-digits>@no-email.gmc` so the (email, phone) unique constraint
  // doesn't collide AND admins can spot synthetic placeholders. The lead
  // can fix it later via /me/profile.
  const phoneDigits = body.phone.replace(/\D/g, "");
  const leadEmail = body.email && body.email.length > 0 ? body.email : `${phoneDigits}@no-email.gmc`;

  const upsert = await upsertParticipant(service, {
    name_en: body.name_en ?? "",
    name_cn: body.name_cn ?? null,
    email: leadEmail,
    phone: body.phone,
    region: volunteer.region_id?.slice(0, 2) ?? "SG", // best-guess region from volunteer's region_id prefix
    status: "new",
  });

  // Set referrer_id on the lead's participant row (one-time-only — don't
  // overwrite if already set).
  await service
    .from("participants")
    .update({ referrer_id: volunteer.id })
    .eq("id", upsert.id)
    .is("referrer_id", null);

  // Check duplicate enrollment.
  const { data: existingEnrollment } = await service
    .from("enrollments")
    .select("id")
    .eq("participant_id", upsert.id)
    .eq("event_id", ev.id)
    .maybeSingle();
  if (existingEnrollment) {
    return NextResponse.json({ error: "already_enrolled" }, { status: 409 });
  }

  // Resolve pricing for the new lead. A freshly-recruited lead has no
  // programme, so this resolves to the new-student / default tier (parity
  // with the public + logged-in register flows).
  const tier = resolvePriceTier(ev, null);
  const amountDue = tier
    ? tier.amount
    : ev.price != null && Number.isFinite(Number(ev.price))
      ? Number(ev.price)
      : null;

  const status = ev.requires_approval ? "pending_approval" : "approved";
  const { data: enrollment, error: insErr } = await service
    .from("enrollments")
    .insert({
      participant_id: upsert.id,
      event_id: ev.id,
      status,
      payment_status: "none",
      recruited_via_portal: true,
      price_tier_key: tier?.tier_key ?? null,
      amount_due: amountDue,
      cs_followup_notes: `recruited via portal by ${volunteer.region_id ?? volunteer.id.slice(0, 8)}`,
    })
    .select("id")
    .single();
  if (insErr || !enrollment) {
    return NextResponse.json(
      { error: "insert_failed", detail: insErr?.message ?? "unknown" },
      { status: 500 },
    );
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const payToken = createPaymentAccessToken(enrollment.id, PAYMENT_TOKEN_TTL_MS);
  const paymentUrl = `${siteUrl.replace(/\/$/, "")}/pay/${payToken}`;

  // WhatsApp deep-link payload (used by client when plan='whatsapp_link')
  // We deliberately use a free-form message via the volunteer's own WA
  // client — bypasses the 24h-window template requirement.
  const leadName = body.name_cn ?? body.name_en ?? "您好";
  const waMessage = `你好 ${leadName}，请点击下方链接完成报名付款：\n${paymentUrl}`;
  const waE164 = body.phone.replace(/[\s\-().]/g, "");
  const waDeepLink = `https://wa.me/${encodeURIComponent(waE164.replace(/^\+/, ""))}?text=${encodeURIComponent(waMessage)}`;

  await writeAuditLog({
    actor_id: volunteer.id,
    action: "recruit.lead_added",
    entity: "enrollments",
    entity_id: enrollment.id,
    metadata: {
      payment_plan: body.payment_plan,
      lead_participant_id: upsert.id,
      lead_created: upsert.created,
      event_id: ev.id,
      event_slug: body.event_slug,
    },
  });

  return NextResponse.json(
    {
      ok: true,
      enrollment_id: enrollment.id,
      lead_participant_id: upsert.id,
      lead_created: upsert.created,
      payment_url: paymentUrl,
      wa_deeplink: waDeepLink,
      pay_token: payToken,
    },
    { status: 201 },
  );
}
