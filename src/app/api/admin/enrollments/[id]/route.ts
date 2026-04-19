import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import {
  ACTION_NEXT_STATUS,
  canTransition,
} from "@/lib/enrollment-transitions";
import type { EnrollmentStatus, PaymentMethod } from "@/lib/enrollments-shared";
import {
  buildPaymentUrl,
  fmtAmount,
  notifyApproved,
  notifyPaymentReceived,
  notifyRejected,
} from "@/lib/enrollment-notifications";
import { createPaymentAccessToken } from "@/lib/tokens";
import { writeAuditLog, type AuditAction } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PAYMENT_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const ACTIONS = ["approve", "reject", "cancel", "mark_paid", "mark_unpaid"] as const;

const PatchBody = z.object({
  action: z.enum(ACTIONS),
  amount_paid: z.number().min(0).max(1_000_000).optional(),
  payment_method: z
    .enum(["hitpay", "stripe", "bank_transfer", "tt"])
    .optional(),
});

const PER_ROW_AUDIT_ACTION: Record<(typeof ACTIONS)[number], AuditAction> = {
  approve: "enrollment.approve",
  reject: "enrollment.reject",
  cancel: "enrollment.cancel",
  mark_paid: "enrollment.mark_paid",
  mark_unpaid: "enrollment.mark_unpaid",
};

type RouteCtx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin") {
    return NextResponse.json(
      { error: "Only super admins can update enrolments" },
      { status: 403 },
    );
  }

  const { id: enrollmentId } = await params;

  let body: z.infer<typeof PatchBody>;
  try {
    body = PatchBody.parse(await req.json());
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid payload";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const service = createSupabaseServiceClient();

  // Load the row + joined participant + event for notifications + audit.
  const { data: row, error: loadErr } = await service
    .from("enrollments")
    .select(
      "id, event_id, participant_id, status, payment_status, payment_method, amount_paid, confirmed_at, participant:participants(id, region_id, name_en, name_cn, email, phone, language), event:events(id, slug, title_en, title_cn, start_date, end_date, currency, price)",
    )
    .eq("id", enrollmentId)
    .maybeSingle();
  if (loadErr) {
    return NextResponse.json({ error: loadErr.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const current = row.status as EnrollmentStatus;
  const check = canTransition(current, body.action);
  if (!check.ok) {
    return NextResponse.json(
      { error: "transition_blocked", reason: check.reason, current },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  const nextStatus = ACTION_NEXT_STATUS[body.action];

  const update: Record<string, unknown> = { status: nextStatus };
  switch (body.action) {
    case "approve":
    case "reject":
      update.approved_by = admin.id;
      update.approved_at = now;
      break;
    case "mark_paid":
      update.payment_status = "paid";
      update.paid_at = now;
      if (body.amount_paid !== undefined) update.amount_paid = body.amount_paid;
      if (body.payment_method !== undefined)
        update.payment_method = body.payment_method as PaymentMethod;
      break;
    case "mark_unpaid":
      update.payment_status = "none";
      update.paid_at = null;
      break;
    case "cancel":
      break;
  }

  const { error: updErr } = await service
    .from("enrollments")
    .update(update)
    .eq("id", enrollmentId);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  await writeAuditLog({
    actor_id: admin.id,
    action: PER_ROW_AUDIT_ACTION[body.action],
    entity: "enrollments",
    entity_id: enrollmentId,
    before: { status: current, payment_status: row.payment_status },
    after: { status: nextStatus, payment_status: update.payment_status ?? row.payment_status },
    metadata: { event_id: row.event_id, via: "per_row" },
  });

  // Dispatch the participant-facing notification for action types that warrant it.
  try {
    const participant = (row as unknown as { participant: ParticipantShape | null })
      .participant;
    const event = (row as unknown as { event: EventShape | null }).event;
    if (participant && event) {
      const enr = {
        id: row.id,
        event_id: row.event_id,
        participant_id: row.participant_id,
        amount_paid: update.amount_paid ?? row.amount_paid,
        payment_method: (update.payment_method as string) ?? row.payment_method,
      };
      const locale = (participant.language === "zh" ? "zh" : "en") as
        | "zh"
        | "en";
      const amountLabel = fmtAmount(
        body.action === "mark_paid" ? enr.amount_paid ?? event.price : event.price,
        event.currency,
        locale,
      );
      if (body.action === "approve") {
        const token = createPaymentAccessToken(row.id, PAYMENT_TOKEN_TTL_MS);
        await notifyApproved({
          enrollment: enr,
          participant,
          event,
          paymentUrl: buildPaymentUrl(token),
          amountLabel,
        });
      } else if (body.action === "reject") {
        await notifyRejected({ enrollment: enr, participant, event });
      } else if (body.action === "mark_paid") {
        await notifyPaymentReceived({
          enrollment: enr,
          participant,
          event,
          amountLabel,
        });
      }
    }
  } catch (err) {
    console.warn("[enrollments.row] notify failed", enrollmentId, err);
  }

  return NextResponse.json({
    ok: true,
    id: enrollmentId,
    status: nextStatus,
    payment_status: (update.payment_status as string) ?? row.payment_status,
  });
}

type ParticipantShape = {
  id: string;
  region_id: string | null;
  name_en: string | null;
  name_cn: string | null;
  email: string | null;
  phone: string | null;
  language: string | null;
};

type EventShape = {
  id: string;
  slug: string;
  title_en: string | null;
  title_cn: string | null;
  start_date: string | null;
  end_date: string | null;
  currency: string | null;
  price: number | string | null;
};
