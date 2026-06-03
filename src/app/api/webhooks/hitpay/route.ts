import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase";
import {
  extractWebhookFields,
  verifyWebhookHmac,
} from "@/lib/hitpay";
import {
  fmtAmount,
  notifyPaymentReceived,
} from "@/lib/enrollment-notifications";
import { writeAuditLog } from "@/lib/audit";
import { enrollmentAmountDue } from "@/lib/pricing/tiers";
import { participantEmailLocale } from "@/lib/i18n";
import { buildCheckInUrl, ensureQrToken } from "@/lib/check-in/qr-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// HitPay webhook receiver. HitPay POSTs application/x-www-form-urlencoded with
// a `hmac` field that proves the sender knows our HITPAY_SALT. Workflow:
//
//   1. Parse the form body
//   2. Verify HMAC against the salt — reject 401 if invalid
//   3. Look up enrolment by payment_provider_id (= payment_request_id)
//   4. On status=completed: idempotently flip to paid + fire receipt notif
//   5. On status=failed: mark payment_status=failed (status stays approved)
//
// We always return 200 once verified so HitPay doesn't retry into the
// audit log for an enrolment we couldn't find — the audit row records the
// orphan event for triage.

export async function POST(req: Request) {
  let body: Record<string, string>;
  try {
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      // HitPay can be configured to send JSON; handle both shapes.
      const json = (await req.json()) as Record<string, unknown>;
      body = Object.fromEntries(
        Object.entries(json).map(([k, v]) => [k, typeof v === "string" ? v : String(v ?? "")]),
      );
    } else {
      const text = await req.text();
      const params = new URLSearchParams(text);
      body = Object.fromEntries(params.entries());
    }
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const fields = extractWebhookFields(body);
  if (!fields) {
    return NextResponse.json({ error: "incomplete_payload" }, { status: 400 });
  }

  if (!verifyWebhookHmac(body, fields.hmac)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  const service = createSupabaseServiceClient();

  // Find the enrolment we stamped in /api/pay/[token]/hitpay.
  const { data: row, error: loadErr } = await service
    .from("enrollments")
    .select(
      "id, event_id, status, payment_status, amount_paid, amount_due, payment_method, payment_provider_id, participant:participants(id, region_id, name_en, name_cn, email, phone, language_fluency), event:events(id, slug, title_en, title_cn, start_date, currency, price)",
    )
    .eq("payment_provider_id", fields.payment_request_id)
    .maybeSingle();
  if (loadErr) {
    // Audit even orphan webhooks so we don't lose them.
    await writeAuditLog({
      actor_id: null,
      action: "enrollment.webhook_failed",
      entity: "enrollments",
      entity_id: fields.payment_request_id,
      metadata: {
        provider: "hitpay",
        reason: "load_error",
        detail: loadErr.message,
        ...fields,
      },
    });
    return NextResponse.json({ ok: true });
  }
  if (!row) {
    await writeAuditLog({
      actor_id: null,
      action: "enrollment.webhook_failed",
      entity: "enrollments",
      entity_id: fields.payment_request_id,
      metadata: { provider: "hitpay", reason: "no_match", ...fields },
    });
    return NextResponse.json({ ok: true });
  }

  const status = fields.status.toLowerCase();
  const amountPaid = Number(fields.amount);
  const isCompleted = status === "completed" || status === "succeeded";
  const isFailed =
    status === "failed" || status === "expired" || status === "cancelled" || status === "canceled";
  const isRefunded = status === "refunded" || status === "partially_refunded";

  // Idempotency: a second "completed" webhook is a no-op.
  if (isCompleted && row.payment_status === "paid") {
    await writeAuditLog({
      actor_id: null,
      action: "enrollment.webhook_paid",
      entity: "enrollments",
      entity_id: row.id,
      metadata: {
        provider: "hitpay",
        replay: true,
        payment_id: fields.payment_id,
        amount: fields.amount,
      },
    });
    return NextResponse.json({ ok: true, replay: true });
  }

  if (isCompleted) {
    const now = new Date().toISOString();
    const update: Record<string, unknown> = {
      status: "paid",
      payment_status: "paid",
      payment_method: "hitpay",
      paid_at: now,
    };
    if (Number.isFinite(amountPaid)) update.amount_paid = amountPaid;

    const { error: updErr } = await service
      .from("enrollments")
      .update(update)
      .eq("id", row.id);
    if (updErr) {
      await writeAuditLog({
        actor_id: null,
        action: "enrollment.webhook_failed",
        entity: "enrollments",
        entity_id: row.id,
        metadata: {
          provider: "hitpay",
          reason: "update_error",
          detail: updErr.message,
          payment_id: fields.payment_id,
        },
      });
      return NextResponse.json({ ok: true });
    }

    await writeAuditLog({
      actor_id: null,
      action: "enrollment.webhook_paid",
      entity: "enrollments",
      entity_id: row.id,
      before: { status: row.status, payment_status: row.payment_status },
      after: { status: "paid", payment_status: "paid" },
      metadata: {
        provider: "hitpay",
        payment_id: fields.payment_id,
        payment_request_id: fields.payment_request_id,
        amount: fields.amount,
        currency: fields.currency,
      },
    });

    // Fire the bilingual receipt notification.
    type ParticipantShape = {
      id: string;
      region_id: string | null;
      name_en: string | null;
      name_cn: string | null;
      email: string | null;
      phone: string | null;
      language_fluency: string | null;
    } | null;
    type EventShape = {
      id: string;
      slug: string;
      title_en: string | null;
      title_cn: string | null;
      start_date: string | null;
      currency: string | null;
      price: number | string | null;
    } | null;
    const participant = (row as unknown as { participant: ParticipantShape }).participant;
    const event = (row as unknown as { event: EventShape }).event;
    if (participant && event) {
      const locale = participantEmailLocale(participant);
      try {
        const qrToken = await ensureQrToken(service, row.id);
        await notifyPaymentReceived({
          enrollment: {
            id: row.id,
            event_id: row.event_id,
            participant_id: participant.id,
            amount_paid: Number.isFinite(amountPaid) ? amountPaid : row.amount_paid,
            payment_method: "hitpay",
          },
          participant,
          event,
          amountLabel: fmtAmount(
            Number.isFinite(amountPaid)
              ? amountPaid
              : enrollmentAmountDue(
                  row as unknown as { amount_due?: number | string | null },
                  event,
                ),
            event.currency,
            locale,
          ),
          checkInUrl: qrToken ? buildCheckInUrl(qrToken) : null,
        });
      } catch (err) {
        console.warn("[webhooks.hitpay] notify failed", row.id, err);
      }
    }

    return NextResponse.json({ ok: true });
  }

  if (isRefunded) {
    // HitPay sends `refunded` for a full refund and `partially_refunded` when
    // only part of the original charge was returned. We track the running
    // refund_amount on the enrolment so admin can see the net paid.
    const priorRefund = 0; // No getter from the load query — we only know what HitPay tells us.
    void priorRefund;
    const priorPaid = row.amount_paid != null ? Number(row.amount_paid) : 0;
    const refundAmt = Number.isFinite(amountPaid) ? amountPaid : 0;
    const isFullRefund =
      status === "refunded" ||
      (Number.isFinite(refundAmt) && refundAmt >= priorPaid - 0.01);
    const now = new Date().toISOString();

    const update: Record<string, unknown> = {
      payment_status: isFullRefund ? "refunded" : "paid",
      refund_amount: refundAmt,
      refunded_at: now,
    };
    // A fully-refunded enrolment falls out of the "paid" bucket so admin
    // sees it in the refunded state, not still counted toward capacity.
    if (isFullRefund) update.status = "cancelled";

    let updRes = await service
      .from("enrollments")
      .update(update)
      .eq("id", row.id);
    if (updRes.error && (updRes.error as { code?: string }).code === "42703") {
      // Pre-013 schema without refund_amount / refunded_at.
      const { refund_amount, refunded_at, ...rest } = update;
      void refund_amount;
      void refunded_at;
      updRes = await service.from("enrollments").update(rest).eq("id", row.id);
    }
    if (updRes.error) {
      await writeAuditLog({
        actor_id: null,
        action: "enrollment.webhook_failed",
        entity: "enrollments",
        entity_id: row.id,
        metadata: {
          provider: "hitpay",
          reason: "refund_update_error",
          detail: updRes.error.message,
          status,
        },
      });
      return NextResponse.json({ ok: true });
    }

    await writeAuditLog({
      actor_id: null,
      action: "enrollment.webhook_refunded",
      entity: "enrollments",
      entity_id: row.id,
      before: { status: row.status, payment_status: row.payment_status },
      after: {
        status: isFullRefund ? "cancelled" : row.status,
        payment_status: isFullRefund ? "refunded" : "paid",
        refund_amount: refundAmt,
      },
      metadata: {
        provider: "hitpay",
        status,
        payment_id: fields.payment_id,
        full_refund: isFullRefund,
      },
    });
    return NextResponse.json({ ok: true });
  }

  if (isFailed) {
    const { error: updErr } = await service
      .from("enrollments")
      .update({ payment_status: "failed" })
      .eq("id", row.id);
    if (updErr) {
      await writeAuditLog({
        actor_id: null,
        action: "enrollment.webhook_failed",
        entity: "enrollments",
        entity_id: row.id,
        metadata: {
          provider: "hitpay",
          reason: "update_error",
          detail: updErr.message,
          status,
        },
      });
      return NextResponse.json({ ok: true });
    }
    await writeAuditLog({
      actor_id: null,
      action: "enrollment.webhook_failed",
      entity: "enrollments",
      entity_id: row.id,
      before: { payment_status: row.payment_status },
      after: { payment_status: "failed" },
      metadata: {
        provider: "hitpay",
        status,
        payment_id: fields.payment_id,
      },
    });
    return NextResponse.json({ ok: true });
  }

  // Pending / processing / unknown — record but don't mutate.
  await writeAuditLog({
    actor_id: null,
    action: "enrollment.webhook_failed",
    entity: "enrollments",
    entity_id: row.id,
    metadata: {
      provider: "hitpay",
      reason: "non_terminal_status",
      status,
      payment_id: fields.payment_id,
    },
  });
  return NextResponse.json({ ok: true });
}
