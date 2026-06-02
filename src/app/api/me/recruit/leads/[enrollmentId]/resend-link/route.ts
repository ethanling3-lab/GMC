import { NextResponse } from "next/server";
import { requireParticipant } from "@/lib/participant-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { createPaymentAccessToken } from "@/lib/tokens";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ enrollmentId: string }> };

// POST /api/me/recruit/leads/[enrollmentId]/resend-link — re-emits a
// fresh payment link for a lead the volunteer recruited earlier. Used
// by the "Resend payment link" action in the recent recruits list.
// Returns the URL + WhatsApp deeplink so the client can re-open the
// share sheet.

const PAYMENT_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function POST(_req: Request, { params }: RouteCtx) {
  const volunteer = await requireParticipant();
  const { enrollmentId } = await params;

  const service = createSupabaseServiceClient();
  const { data: enrollment } = await service
    .from("enrollments")
    .select(
      "id, participant_id, status, payment_status, recruited_via_portal, participant:participants(id, name_cn, name_en, phone, referrer_id)",
    )
    .eq("id", enrollmentId)
    .maybeSingle();
  if (!enrollment) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const row = enrollment as unknown as {
    id: string;
    participant_id: string;
    status: string;
    payment_status: string;
    recruited_via_portal: boolean;
    participant: {
      id: string;
      name_cn: string | null;
      name_en: string | null;
      phone: string | null;
      referrer_id: string | null;
    } | null;
  };

  // Authorise: only the original recruiter can resend.
  if (!row.participant || row.participant.referrer_id !== volunteer.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  // Already paid? Nothing to do.
  if (row.payment_status === "paid" || row.status === "paid") {
    return NextResponse.json({ error: "already_paid" }, { status: 409 });
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const payToken = createPaymentAccessToken(row.id, PAYMENT_TOKEN_TTL_MS);
  const paymentUrl = `${siteUrl.replace(/\/$/, "")}/pay/${payToken}`;

  const leadName = row.participant.name_cn ?? row.participant.name_en ?? "您好";
  const waMessage = `你好 ${leadName}，请点击下方链接完成报名付款：\n${paymentUrl}`;
  const phone = row.participant.phone ?? "";
  const waE164 = phone.replace(/[\s\-().]/g, "");
  const waDeepLink = waE164
    ? `https://wa.me/${encodeURIComponent(waE164.replace(/^\+/, ""))}?text=${encodeURIComponent(waMessage)}`
    : null;

  return NextResponse.json({
    ok: true,
    payment_url: paymentUrl,
    wa_deeplink: waDeepLink,
    pay_token: payToken,
  });
}
