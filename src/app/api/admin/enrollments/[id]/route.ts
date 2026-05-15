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
  isRejectReason,
  notifyApproved,
  notifyPaymentReceived,
  notifyRejected,
  type RejectReason,
} from "@/lib/enrollment-notifications";
import { createPaymentAccessToken } from "@/lib/tokens";
import { writeAuditLog, type AuditAction } from "@/lib/audit";
import { participantEmailLocale } from "@/lib/i18n";
import { ensureRegionId } from "@/lib/region-id";
import { buildCheckInUrl, ensureQrToken } from "@/lib/check-in/qr-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PAYMENT_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const ACTIONS = ["approve", "reject", "cancel", "mark_paid", "mark_unpaid"] as const;

// Four-mode PATCH:
//   { action: "...", amount_paid?, payment_method? } — state transition
//   { amount_paid: number }                           — bare amount edit
//   { pinned_group_no: number | null }                — group pinning
//   { serving_as_zu_zhang, zu_zhang_tier_for_event? } — curate 组长 toggle
// Bare paths skip the state machine. Used by inline edits on the
// enrolments console for quick corrections + by the GroupBuilder UI
// for pre-seeding + by the curate-组长 UI for per-event roster curation.
const PatchBody = z
  .object({
    action: z.enum(ACTIONS).optional(),
    amount_paid: z.number().min(0).max(1_000_000).optional(),
    payment_method: z
      .enum(["hitpay", "stripe", "bank_transfer", "tt"])
      .optional(),
    reject_reason: z
      .enum(["no_seats", "duplicate", "unsuitable", "other"])
      .optional(),
    reject_note: z.string().trim().max(500).optional(),
    pinned_group_no: z.number().int().min(1).max(999).nullable().optional(),
    serving_as_zu_zhang: z.boolean().optional(),
    zu_zhang_tier_for_event: z
      .enum(["key_recruitment", "recruitment", "maintenance", "auxiliary"])
      .nullable()
      .optional(),
    zu_zhang_grade_for_event: z
      .number()
      .int()
      .min(1)
      .max(5)
      .nullable()
      .optional(),
  })
  .refine(
    (b) =>
      b.action !== undefined
      || b.amount_paid !== undefined
      || b.pinned_group_no !== undefined
      || b.serving_as_zu_zhang !== undefined
      || b.zu_zhang_tier_for_event !== undefined
      || b.zu_zhang_grade_for_event !== undefined,
    {
      message:
        "Provide an action, amount_paid, pinned_group_no, or zu_zhang flags",
    },
  );

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
      "id, event_id, participant_id, status, payment_status, payment_method, amount_paid, confirmed_at, participant:participants(id, region_id, name_en, name_cn, email, phone, language_fluency), event:events(id, slug, title_en, title_cn, start_date, end_date, currency, price)",
    )
    .eq("id", enrollmentId)
    .maybeSingle();
  if (loadErr) {
    return NextResponse.json({ error: loadErr.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Amount-only edit path — no state transition, no notifications.
  if (body.action === undefined && body.amount_paid !== undefined) {
    const before = row.amount_paid;
    const { error: updErr } = await service
      .from("enrollments")
      .update({ amount_paid: body.amount_paid })
      .eq("id", enrollmentId);
    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }
    await writeAuditLog({
      actor_id: admin.id,
      action: "enrollment.update_amount",
      entity: "enrollments",
      entity_id: enrollmentId,
      before: { amount_paid: before },
      after: { amount_paid: body.amount_paid },
      metadata: { event_id: row.event_id, via: "inline_edit" },
    });
    return NextResponse.json({
      ok: true,
      id: enrollmentId,
      amount_paid: body.amount_paid,
    });
  }

  // Pin-only edit path — no state transition, no notifications.
  if (body.action === undefined && body.pinned_group_no !== undefined) {
    const { data: beforePin } = await service
      .from("enrollments")
      .select("pinned_group_no")
      .eq("id", enrollmentId)
      .maybeSingle();
    const { error: updErr } = await service
      .from("enrollments")
      .update({ pinned_group_no: body.pinned_group_no })
      .eq("id", enrollmentId);
    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }
    await writeAuditLog({
      actor_id: admin.id,
      action: "groups.member_moved",
      entity: "enrollments",
      entity_id: enrollmentId,
      before: { pinned_group_no: beforePin?.pinned_group_no ?? null },
      after: { pinned_group_no: body.pinned_group_no },
      metadata: { event_id: row.event_id, via: "pin_edit" },
    });
    return NextResponse.json({
      ok: true,
      id: enrollmentId,
      pinned_group_no: body.pinned_group_no,
    });
  }

  // 组长 curation bare-edit path — toggles serving_as_zu_zhang and/or
  // zu_zhang_tier_for_event. No state transition, no notifications.
  // Permission scope intentionally narrower than super_admin in the
  // upper guard — already enforced. (The curate-by-modal route has the
  // batch path; this is the per-row toggle that lives on the
  // EnrollmentsTable.)
  if (
    body.action === undefined
    && (body.serving_as_zu_zhang !== undefined
      || body.zu_zhang_tier_for_event !== undefined
      || body.zu_zhang_grade_for_event !== undefined)
  ) {
    const { data: beforeRow } = await service
      .from("enrollments")
      .select(
        "serving_as_zu_zhang, zu_zhang_tier_for_event, zu_zhang_grade_for_event",
      )
      .eq("id", enrollmentId)
      .maybeSingle();
    const update: Record<string, unknown> = {};
    if (body.serving_as_zu_zhang !== undefined) {
      update.serving_as_zu_zhang = body.serving_as_zu_zhang;
      // Off → clear the per-event tier + grade overrides too so a later
      // flip-on starts from the participant's global values.
      if (body.serving_as_zu_zhang === false) {
        update.zu_zhang_tier_for_event = null;
        update.zu_zhang_grade_for_event = null;
      }
    }
    if (body.zu_zhang_tier_for_event !== undefined) {
      update.zu_zhang_tier_for_event = body.zu_zhang_tier_for_event;
    }
    if (body.zu_zhang_grade_for_event !== undefined) {
      update.zu_zhang_grade_for_event = body.zu_zhang_grade_for_event;
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
      action: "enrollment.zu_zhang_curated",
      entity: "enrollments",
      entity_id: enrollmentId,
      before: {
        serving_as_zu_zhang: beforeRow?.serving_as_zu_zhang ?? false,
        zu_zhang_tier_for_event: beforeRow?.zu_zhang_tier_for_event ?? null,
        zu_zhang_grade_for_event:
          beforeRow?.zu_zhang_grade_for_event ?? null,
      },
      after: {
        serving_as_zu_zhang:
          body.serving_as_zu_zhang ?? beforeRow?.serving_as_zu_zhang ?? false,
        zu_zhang_tier_for_event:
          body.serving_as_zu_zhang === false
            ? null
            : (body.zu_zhang_tier_for_event
              ?? beforeRow?.zu_zhang_tier_for_event
              ?? null),
        zu_zhang_grade_for_event:
          body.serving_as_zu_zhang === false
            ? null
            : (body.zu_zhang_grade_for_event
              ?? beforeRow?.zu_zhang_grade_for_event
              ?? null),
      },
      metadata: {
        event_id: row.event_id,
        participant_id: row.participant_id,
        via: "per_row_chip",
      },
    });
    return NextResponse.json({ ok: true, id: enrollmentId });
  }

  // Beyond this point we MUST have an action — earlier branches handled
  // the bare paths, and the schema refines that at least one of
  // (action, amount_paid, pinned_group_no, zu_zhang_*) is set.
  if (body.action === undefined) {
    return NextResponse.json(
      {
        error: "no_action",
        detail:
          "Provide an action, amount_paid, pinned_group_no, or zu_zhang flags",
      },
      { status: 400 },
    );
  }
  const action = body.action;

  const current = row.status as EnrollmentStatus;
  const check = canTransition(current, action);
  if (!check.ok) {
    return NextResponse.json(
      { error: "transition_blocked", reason: check.reason, current },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  const nextStatus = ACTION_NEXT_STATUS[action];

  const update: Record<string, unknown> = { status: nextStatus };
  let resolvedRejectReason: RejectReason | null = null;
  let resolvedRejectNote: string | null = null;
  switch (action) {
    case "approve":
      update.approved_by = admin.id;
      update.approved_at = now;
      break;
    case "reject":
      update.approved_by = admin.id;
      update.approved_at = now;
      resolvedRejectReason = isRejectReason(body.reject_reason)
        ? body.reject_reason
        : "no_seats";
      resolvedRejectNote = body.reject_note?.trim() || null;
      update.reject_reason = resolvedRejectReason;
      update.reject_note = resolvedRejectNote;
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

  // Tolerate pre-011 schemas (no reject_reason / reject_note columns) by
  // dropping them and retrying once. Reject still completes; the audit row
  // captures the reason regardless.
  let updRes = await service
    .from("enrollments")
    .update(update)
    .eq("id", enrollmentId);
  if (updRes.error && (updRes.error as { code?: string }).code === "42703") {
    const { reject_reason, reject_note, ...rest } = update;
    void reject_reason;
    void reject_note;
    updRes = await service
      .from("enrollments")
      .update(rest)
      .eq("id", enrollmentId);
  }
  if (updRes.error) {
    return NextResponse.json({ error: updRes.error.message }, { status: 500 });
  }

  await writeAuditLog({
    actor_id: admin.id,
    action: PER_ROW_AUDIT_ACTION[action],
    entity: "enrollments",
    entity_id: enrollmentId,
    before: { status: current, payment_status: row.payment_status },
    after: { status: nextStatus, payment_status: update.payment_status ?? row.payment_status },
    metadata: {
      event_id: row.event_id,
      via: "per_row",
      ...(action === "reject"
        ? { reject_reason: resolvedRejectReason, reject_note: resolvedRejectNote }
        : {}),
    },
  });

  // Mint the student ID on approval (and on mark_paid for offline-paid rows
  // that never went through approve). Idempotent — returning students keep
  // their existing region_id.
  if (action === "approve" || action === "mark_paid") {
    await ensureRegionId(service, row.participant_id);
  }

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
      const locale = participantEmailLocale(participant);
      const amountLabel = fmtAmount(
        action === "mark_paid" ? enr.amount_paid ?? event.price : event.price,
        event.currency,
        locale,
      );
      if (action === "approve") {
        const token = createPaymentAccessToken(row.id, PAYMENT_TOKEN_TTL_MS);
        await notifyApproved({
          enrollment: enr,
          participant,
          event,
          paymentUrl: buildPaymentUrl(token),
          amountLabel,
        });
      } else if (action === "reject") {
        await notifyRejected({
          enrollment: enr,
          participant,
          event,
          reason: resolvedRejectReason,
          note: resolvedRejectNote,
        });
      } else if (action === "mark_paid") {
        const qrToken = await ensureQrToken(service, row.id);
        await notifyPaymentReceived({
          enrollment: enr,
          participant,
          event,
          amountLabel,
          checkInUrl: qrToken ? buildCheckInUrl(qrToken) : null,
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
  language_fluency: string | null;
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
