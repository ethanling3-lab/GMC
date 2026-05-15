import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import {
  ACTION_NEXT_STATUS,
  canTransition,
  type EnrollmentAction,
} from "@/lib/enrollment-transitions";
import type { EnrollmentStatus } from "@/lib/enrollments-shared";
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
import { writeAuditLogBatch, type AuditAction } from "@/lib/audit";
import { ensureRegionId } from "@/lib/region-id";
import { participantEmailLocale } from "@/lib/i18n";
import { buildCheckInUrl, ensureQrToken } from "@/lib/check-in/qr-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 26;

const BULK_ACTIONS = [
  "approve",
  "reject",
  "cancel",
  "mark_paid",
  "mark_unpaid",
] as const;

const BulkBody = z.object({
  action: z.enum(BULK_ACTIONS),
  ids: z.array(z.string().uuid()).min(1).max(500),
  reject_reason: z
    .enum(["no_seats", "duplicate", "unsuitable", "other"])
    .optional(),
  reject_note: z.string().trim().max(500).optional(),
});

type RouteCtx = { params: Promise<{ id: string }> };

const PAYMENT_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const BULK_AUDIT_ACTION: Record<EnrollmentAction, AuditAction> = {
  approve: "enrollment.bulk_approve",
  reject: "enrollment.bulk_reject",
  cancel: "enrollment.bulk_cancel",
  mark_paid: "enrollment.bulk_mark_paid",
  mark_unpaid: "enrollment.mark_unpaid",
};

export async function POST(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  const { id: eventId } = await params;

  if (admin.role !== "super_admin") {
    return NextResponse.json(
      { error: "Only super admins can act on enrollments in bulk" },
      { status: 403 },
    );
  }

  let body: z.infer<typeof BulkBody>;
  try {
    body = BulkBody.parse(await req.json());
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid payload";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const service = createSupabaseServiceClient();

  // Pull current state of each selected row + the joined participant +
  // event (for notifications + derived URL). Scope to eventId defensively.
  const { data: rows, error: loadErr } = await service
    .from("enrollments")
    .select(
      "id, event_id, participant_id, status, payment_status, payment_method, amount_paid, confirmed_at, participant:participants(id, region_id, name_en, name_cn, email, phone, language_fluency), event:events(id, slug, title_en, title_cn, start_date, end_date, currency, price)",
    )
    .eq("event_id", eventId)
    .in("id", body.ids);
  if (loadErr) {
    return NextResponse.json({ error: loadErr.message }, { status: 500 });
  }

  const found = (rows ?? []) as unknown as EnrichedRow[];
  const foundIds = new Set(found.map((r) => r.id));
  const skippedIds = body.ids.filter((id) => !foundIds.has(id));

  // Validate each row against the state machine. All-or-nothing: if any row
  // would illegally transition, reject the whole batch with per-row reasons
  // so the UI can surface them inline.
  const per: {
    id: string;
    ok: boolean;
    reason?: string;
  }[] = [];
  for (const row of found) {
    const check = canTransition(row.status as EnrollmentStatus, body.action);
    per.push({
      id: row.id,
      ok: check.ok,
      reason: check.ok ? undefined : check.reason,
    });
  }
  const illegal = per.filter((p) => !p.ok);
  if (illegal.length > 0) {
    return NextResponse.json(
      {
        error: "transition_blocked",
        action: body.action,
        results: per,
        skipped: skippedIds,
      },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  const nextStatus = ACTION_NEXT_STATUS[body.action];

  // Apply the status mutation. Extra per-action columns (approved_at,
  // paid_at, payment_status) are layered on top.
  const baseUpdate: Record<string, unknown> = { status: nextStatus };
  let resolvedRejectReason: RejectReason | null = null;
  let resolvedRejectNote: string | null = null;
  switch (body.action) {
    case "approve":
      baseUpdate.approved_by = admin.id;
      baseUpdate.approved_at = now;
      break;
    case "reject":
      baseUpdate.approved_by = admin.id;
      baseUpdate.approved_at = now;
      resolvedRejectReason = isRejectReason(body.reject_reason)
        ? body.reject_reason
        : "no_seats";
      resolvedRejectNote = body.reject_note?.trim() || null;
      baseUpdate.reject_reason = resolvedRejectReason;
      baseUpdate.reject_note = resolvedRejectNote;
      break;
    case "mark_paid":
      baseUpdate.payment_status = "paid";
      baseUpdate.paid_at = now;
      break;
    case "mark_unpaid":
      baseUpdate.payment_status = "none";
      baseUpdate.paid_at = null;
      break;
    case "cancel":
      // Nothing extra.
      break;
  }

  // Tolerate pre-011 schemas (no reject_reason / reject_note) by retrying
  // without those columns once. Audit metadata still captures the reason.
  let updRes = await service
    .from("enrollments")
    .update(baseUpdate)
    .in(
      "id",
      found.map((r) => r.id),
    );
  if (updRes.error && (updRes.error as { code?: string }).code === "42703") {
    const { reject_reason, reject_note, ...rest } = baseUpdate;
    void reject_reason;
    void reject_note;
    updRes = await service
      .from("enrollments")
      .update(rest)
      .in(
        "id",
        found.map((r) => r.id),
      );
  }
  if (updRes.error) {
    return NextResponse.json({ error: updRes.error.message }, { status: 500 });
  }

  // Fan out notifications + audit rows in parallel. Notification failures are
  // swallowed (already logged to console inside the dispatcher) so a bad SMTP
  // run never rolls back the DB change.
  const auditRows = found.map((r) => ({
    actor_id: admin.id,
    action: BULK_AUDIT_ACTION[body.action],
    entity: "enrollments",
    entity_id: r.id,
    before: { status: r.status, payment_status: r.payment_status },
    after: { status: nextStatus, payment_status: baseUpdate.payment_status ?? r.payment_status },
    metadata: {
      event_id: eventId,
      via: "bulk",
      ...(body.action === "reject"
        ? { reject_reason: resolvedRejectReason, reject_note: resolvedRejectNote }
        : {}),
    },
  }));
  await writeAuditLogBatch(auditRows);

  // Mint student IDs for approve / mark_paid bulk actions. Idempotent +
  // serialized per-country inside the SQL function, so 200 SG approvals
  // serialize among themselves but run in parallel with MY approvals.
  if (body.action === "approve" || body.action === "mark_paid") {
    await Promise.all(
      found.map((r) => ensureRegionId(service, r.participant_id)),
    );
  }

  const notifyTasks = found.map(async (r) => {
    if (!r.participant || !r.event) return;
    const event = r.event;
    const p = r.participant;
    const enr = {
      id: r.id,
      event_id: r.event_id,
      participant_id: r.participant_id,
      amount_paid: r.amount_paid,
      payment_method: r.payment_method,
    };
    const currency = event.currency ?? "SGD";
    const amountLabel = fmtAmount(
      body.action === "mark_paid" ? r.amount_paid ?? event.price : event.price,
      currency,
      participantEmailLocale(p),
    );
    try {
      if (body.action === "approve") {
        const token = createPaymentAccessToken(r.id, PAYMENT_TOKEN_TTL_MS);
        await notifyApproved({
          enrollment: enr,
          participant: p,
          event,
          paymentUrl: buildPaymentUrl(token),
          amountLabel,
        });
      } else if (body.action === "reject") {
        await notifyRejected({
          enrollment: enr,
          participant: p,
          event,
          reason: resolvedRejectReason,
          note: resolvedRejectNote,
        });
      } else if (body.action === "mark_paid") {
        const qrToken = await ensureQrToken(service, r.id);
        await notifyPaymentReceived({
          enrollment: enr,
          participant: p,
          event,
          amountLabel,
          checkInUrl: qrToken ? buildCheckInUrl(qrToken) : null,
        });
      }
      // cancel + mark_unpaid are silent by design.
    } catch (err) {
      console.warn("[enrollments.bulk] notify failed for", r.id, err);
    }
  });
  await Promise.all(notifyTasks);

  return NextResponse.json({
    action: body.action,
    affected: found.length,
    skipped: skippedIds.length,
  });
}

// --- Internal row shape returned by the select join ------------------------

type EnrichedRow = {
  id: string;
  event_id: string;
  participant_id: string;
  status: string;
  payment_status: string;
  payment_method: string | null;
  amount_paid: number | string | null;
  confirmed_at: string | null;
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
