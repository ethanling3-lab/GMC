import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import {
  buildPaymentUrl,
  fmtAmount,
  isRejectReason,
  notifyApproved,
  notifyPaymentReceived,
  notifyRejected,
  type RejectReason,
} from "@/lib/enrollment-notifications";
import { createPaymentAccessToken } from "@/lib/tokens";
import { writeAuditLog } from "@/lib/audit";
import { participantEmailLocale } from "@/lib/i18n";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PAYMENT_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type RouteCtx = { params: Promise<{ id: string }> };

type EnrichedRow = {
  id: string;
  event_id: string;
  participant_id: string;
  status: string;
  payment_status: string;
  payment_method: string | null;
  amount_paid: number | string | null;
  reject_reason?: string | null;
  reject_note?: string | null;
  participant: {
    id: string;
    region_id: string | null;
    name_en: string | null;
    name_cn: string | null;
    email: string | null;
    phone: string | null;
    language_fluency: string | null;
  } | null;
  event: {
    id: string;
    slug: string;
    title_en: string | null;
    title_cn: string | null;
    start_date: string | null;
    end_date: string | null;
    currency: string | null;
    price: number | string | null;
  } | null;
};

export async function POST(_req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin") {
    return NextResponse.json(
      { error: "Only super admins can re-send notifications" },
      { status: 403 },
    );
  }

  const { id: enrollmentId } = await params;
  const service = createSupabaseServiceClient();

  // Pull enrolment + participant + event. Fall back when migration 011
  // isn't applied yet (no reject_reason / reject_note columns).
  const baseSelect =
    "id, event_id, participant_id, status, payment_status, payment_method, amount_paid, participant:participants(id, region_id, name_en, name_cn, email, phone, language_fluency), event:events(id, slug, title_en, title_cn, start_date, end_date, currency, price)";
  const fullSelect = `${baseSelect}, reject_reason, reject_note`;

  let res = await service
    .from("enrollments")
    .select(fullSelect)
    .eq("id", enrollmentId)
    .maybeSingle();
  if (res.error && (res.error as { code?: string }).code === "42703") {
    res = await service
      .from("enrollments")
      .select(baseSelect)
      .eq("id", enrollmentId)
      .maybeSingle();
  }
  if (res.error) {
    return NextResponse.json({ error: res.error.message }, { status: 500 });
  }
  const row = res.data as unknown as EnrichedRow | null;
  if (!row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!row.participant || !row.event) {
    return NextResponse.json({ error: "missing_relation" }, { status: 422 });
  }

  // Pick the dispatcher matching the current status. Anything else (pending,
  // cancelled) has no template to re-send.
  const enr = {
    id: row.id,
    event_id: row.event_id,
    participant_id: row.participant_id,
    amount_paid: row.amount_paid,
    payment_method: row.payment_method,
  };
  const locale = participantEmailLocale(row.participant);

  let template: string;
  try {
    if (row.status === "approved") {
      const token = createPaymentAccessToken(row.id, PAYMENT_TOKEN_TTL_MS);
      const amountLabel = fmtAmount(row.event.price, row.event.currency, locale);
      await notifyApproved({
        enrollment: enr,
        participant: row.participant,
        event: row.event,
        paymentUrl: buildPaymentUrl(token),
        amountLabel,
      });
      template = "enrollment_approved";
    } else if (row.status === "paid") {
      const amountLabel = fmtAmount(
        row.amount_paid ?? row.event.price,
        row.event.currency,
        locale,
      );
      await notifyPaymentReceived({
        enrollment: enr,
        participant: row.participant,
        event: row.event,
        amountLabel,
      });
      template = "payment_received";
    } else if (row.status === "rejected") {
      const reason: RejectReason = isRejectReason(row.reject_reason)
        ? row.reject_reason
        : "no_seats";
      await notifyRejected({
        enrollment: enr,
        participant: row.participant,
        event: row.event,
        reason,
        note: row.reject_note ?? null,
      });
      template = `enrollment_rejected_${reason}`;
    } else {
      return NextResponse.json(
        { error: "no_template_for_status", status: row.status },
        { status: 409 },
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "resend_failed";
    return NextResponse.json({ error: "resend_failed", detail: msg }, { status: 500 });
  }

  await writeAuditLog({
    actor_id: admin.id,
    action: "enrollment.notification_resent",
    entity: "enrollments",
    entity_id: row.id,
    metadata: {
      event_id: row.event_id,
      status: row.status,
      template,
      channels: ["email", "whatsapp"],
    },
  });

  return NextResponse.json({ ok: true, id: row.id, template });
}
