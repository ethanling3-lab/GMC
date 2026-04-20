import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import {
  upsertParticipant,
  type ParticipantInsertInput,
} from "@/lib/participants-write";
import { checkCapacity } from "@/lib/event-capacity";
import {
  buildPaymentUrl,
  fmtAmount,
  notifyApproved,
  notifyPaymentReceived,
} from "@/lib/enrollment-notifications";
import { createPaymentAccessToken } from "@/lib/tokens";
import { writeAuditLog } from "@/lib/audit";
import { ensureRegionId } from "@/lib/region-id";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PAYMENT_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const NewParticipant = z.object({
  name_en: z.string().trim().min(1).max(120),
  name_cn: z.string().trim().max(120).optional(),
  email: z.string().trim().email().max(160),
  phone: z.string().trim().min(4).max(40),
  region: z.string().trim().min(1).max(80),
  language: z.string().trim().max(40).optional(),
  gender: z.string().trim().max(40).optional(),
  birth_date: z.string().trim().max(40).optional(),
  occupation: z.string().trim().max(120).optional(),
  industry: z.string().trim().max(120).optional(),
  referrer_name: z.string().trim().max(120).optional(),
  referrer_contact: z.string().trim().max(120).optional(),
  is_old_student: z.boolean().optional(),
});

const Body = z
  .object({
    participant: z.union([
      z.object({ existing_id: z.string().uuid() }),
      z.object({ new: NewParticipant }),
    ]),
    initial_state: z.enum(["pending", "approved", "paid"]),
    amount_paid: z.number().min(0).max(1_000_000).optional(),
    payment_method: z
      .enum(["hitpay", "stripe", "bank_transfer", "tt"])
      .optional(),
    form_answers: z.record(z.string(), z.unknown()).optional(),
    cs_notes: z.string().trim().max(2000).optional(),
    force_capacity: z.boolean().optional(),
  })
  .refine(
    (b) =>
      b.initial_state !== "paid" ||
      (typeof b.amount_paid === "number" && !!b.payment_method),
    { message: "amount_paid + payment_method required when initial_state=paid" },
  );

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin") {
    return NextResponse.json(
      { error: "Only super admins can create enrolments from admin" },
      { status: 403 },
    );
  }

  const { id: eventId } = await params;

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid payload";
    return NextResponse.json({ error: "validation_error", detail: msg }, { status: 400 });
  }

  const service = createSupabaseServiceClient();

  // Load the event for capacity + notification context.
  const { data: event, error: eventErr } = await service
    .from("events")
    .select(
      "id, slug, status, requires_approval, capacity, currency, price, title_en, title_cn, start_date, end_date",
    )
    .eq("id", eventId)
    .maybeSingle();
  if (eventErr) {
    return NextResponse.json({ error: eventErr.message }, { status: 500 });
  }
  if (!event) {
    return NextResponse.json({ error: "event_not_found" }, { status: 404 });
  }

  // Capacity gate. Force_capacity bypasses; logged separately as
  // enrollment.capacity_override so the audit trail makes the decision visible.
  const cap = await checkCapacity(service, event.id, event.capacity);
  if (cap.full && !body.force_capacity) {
    return NextResponse.json(
      { error: "no_seats", capacity: cap.capacity, current: cap.current },
      { status: 409 },
    );
  }

  // Resolve participant: existing-by-id or upsert-by-email-phone.
  let participantId: string;
  let participantCreated = false;
  if ("existing_id" in body.participant) {
    const { data: existing, error: pErr } = await service
      .from("participants")
      .select("id")
      .eq("id", body.participant.existing_id)
      .maybeSingle();
    if (pErr) {
      return NextResponse.json({ error: pErr.message }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json({ error: "participant_not_found" }, { status: 404 });
    }
    participantId = existing.id;
  } else {
    const input: ParticipantInsertInput = {
      name_en: body.participant.new.name_en,
      name_cn: body.participant.new.name_cn ?? null,
      email: body.participant.new.email,
      phone: body.participant.new.phone,
      region: body.participant.new.region,
      language: body.participant.new.language ?? null,
      gender: body.participant.new.gender ?? null,
      birth_date: body.participant.new.birth_date ?? null,
      occupation: body.participant.new.occupation ?? null,
      industry: body.participant.new.industry ?? null,
      status: "info_verified",
      referrer_name: body.participant.new.referrer_name ?? null,
      referrer_contact: body.participant.new.referrer_contact ?? null,
      is_old_student: body.participant.new.is_old_student ?? false,
    };
    try {
      const upserted = await upsertParticipant(service, input);
      participantId = upserted.id;
      participantCreated = upserted.created;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "participant_insert_failed";
      return NextResponse.json({ error: "participant_insert_failed", detail: msg }, { status: 500 });
    }
  }

  // Reject duplicate enrolment for the same (participant, event).
  const { data: dup } = await service
    .from("enrollments")
    .select("id, status")
    .eq("participant_id", participantId)
    .eq("event_id", event.id)
    .maybeSingle();
  if (dup) {
    return NextResponse.json(
      { error: "already_enrolled", id: dup.id, status: dup.status },
      { status: 409 },
    );
  }

  // Build the insert payload from the chosen initial state. Mirrors the
  // PATCH route's per-action mutation logic so a manually-created "approved"
  // row carries the same audit timestamps as one transitioned via the table.
  const now = new Date().toISOString();
  const enrollPayload: Record<string, unknown> = {
    participant_id: participantId,
    event_id: event.id,
  };

  if (body.initial_state === "pending") {
    enrollPayload.status = "pending_approval";
  } else if (body.initial_state === "approved") {
    enrollPayload.status = "approved";
    enrollPayload.approved_by = admin.id;
    enrollPayload.approved_at = now;
  } else {
    enrollPayload.status = "paid";
    enrollPayload.approved_by = admin.id;
    enrollPayload.approved_at = now;
    enrollPayload.payment_status = "paid";
    enrollPayload.paid_at = now;
    enrollPayload.payment_method = body.payment_method;
    enrollPayload.amount_paid = body.amount_paid;
  }

  if (body.form_answers) enrollPayload.form_answers = body.form_answers;
  if (body.cs_notes && body.cs_notes.trim()) {
    enrollPayload.cs_followup_notes = body.cs_notes.trim();
  }

  // Insert with a fallback when migration 008 (form_answers) hasn't shipped.
  let insRes = await service
    .from("enrollments")
    .insert(enrollPayload)
    .select("id, status")
    .single();
  if (insRes.error && (insRes.error as { code?: string }).code === "42703") {
    const { form_answers, ...rest } = enrollPayload;
    void form_answers;
    insRes = await service
      .from("enrollments")
      .insert(rest)
      .select("id, status")
      .single();
  }
  if (insRes.error || !insRes.data) {
    return NextResponse.json(
      { error: "enroll_failed", detail: insRes.error?.message },
      { status: 500 },
    );
  }
  const enrollment = insRes.data;

  await writeAuditLog({
    actor_id: admin.id,
    action: "enrollment.created_from_admin",
    entity: "enrollments",
    entity_id: enrollment.id,
    after: { status: enrollment.status },
    metadata: {
      event_id: event.id,
      via: "admin_manual",
      initial_state: body.initial_state,
      participant_created: participantCreated,
    },
  });

  if (cap.full && body.force_capacity) {
    await writeAuditLog({
      actor_id: admin.id,
      action: "enrollment.capacity_override",
      entity: "enrollments",
      entity_id: enrollment.id,
      metadata: {
        event_id: event.id,
        capacity: cap.capacity,
        current_count: cap.current,
      },
    });
  }

  // Mint the student ID when admin lands the row already approved or paid.
  // Pending lands without one — the ID gets minted on later approval.
  if (body.initial_state === "approved" || body.initial_state === "paid") {
    await ensureRegionId(service, participantId);
  }

  // Fetch the participant for notification dispatch.
  const { data: pRow } = await service
    .from("participants")
    .select("id, region_id, name_en, name_cn, email, phone, language")
    .eq("id", participantId)
    .maybeSingle();

  if (pRow) {
    const locale = (pRow.language === "zh" ? "zh" : "en") as "zh" | "en";
    const enr = {
      id: enrollment.id,
      event_id: event.id,
      participant_id: participantId,
      amount_paid: body.amount_paid ?? null,
      payment_method: body.payment_method ?? null,
    };

    try {
      if (body.initial_state === "approved") {
        const token = createPaymentAccessToken(enrollment.id, PAYMENT_TOKEN_TTL_MS);
        const amountLabel = fmtAmount(event.price, event.currency, locale);
        await notifyApproved({
          enrollment: enr,
          participant: pRow,
          event,
          paymentUrl: buildPaymentUrl(token),
          amountLabel,
        });
      } else if (body.initial_state === "paid") {
        const amountLabel = fmtAmount(
          body.amount_paid ?? event.price,
          event.currency,
          locale,
        );
        await notifyPaymentReceived({
          enrollment: enr,
          participant: pRow,
          event,
          amountLabel,
        });
      }
      // pending → no notification by design.
    } catch (err) {
      console.warn("[enrollments.create] notify failed", enrollment.id, err);
    }
  }

  return NextResponse.json({
    ok: true,
    id: enrollment.id,
    status: enrollment.status,
    participant_id: participantId,
    participant_created: participantCreated,
  });
}
