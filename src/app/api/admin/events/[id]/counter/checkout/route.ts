import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireFinanceAdmin } from "@/lib/finance/role-guard";
import { writeAuditLogBatch } from "@/lib/audit";
import { insertCounterParticipant } from "@/lib/participants-write";
import { resolveEnrollmentPrice } from "@/lib/pricing/resolve-server";
import { sgDay } from "@/lib/pricing/tiers";
import { checkCapacity } from "@/lib/event-capacity";
import { ensureRegionId } from "@/lib/region-id";
import { participantEmailLocale } from "@/lib/i18n";
import { fmtAmount, notifyPaymentReceived } from "@/lib/enrollment-notifications";
import { buildCheckInUrl, ensureQrToken } from "@/lib/check-in/qr-token";
import { loadCounterEvent, phoneMatches } from "@/lib/payments/counter";
import {
  createPurchase,
  insertPayment,
  loadPurchase,
  loadTemplates,
  setCurrentProgramme,
  syncPurchaseStatus,
} from "@/lib/payments/ledger";
import { scheduleFromTemplate } from "@/lib/payments/standing";
import { enrollmentMethodFor, type ScheduleRow } from "@/lib/payments/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/admin/events/[id]/counter/checkout — Payment counter · 收款台.
// One person, one or more things paid with one card swipe (or cash…):
//   event fee for THIS event · a programme (定金 or 全款) · an instalment.
// Finance + Super Admin only. Everything is validated before the first write.

const money = z.number().positive().max(1_000_000);

const NewPerson = z
  .object({
    name_cn: z.string().trim().max(120).optional().nullable(),
    name_en: z.string().trim().max(120).optional().nullable(),
    phone: z.string().trim().min(6, "Phone is required").max(40),
    email: z.union([z.string().trim().toLowerCase().email("Email looks wrong"), z.literal("")]).optional().nullable(),
    gender: z.string().trim().max(40).optional().nullable(),
    region: z.enum(["MY", "SG", "TW", "HK", "CN"]),
    occupation: z.string().trim().max(120).optional().nullable(),
    industry: z.string().trim().max(120).optional().nullable(),
    referrer_id: z.string().uuid().optional().nullable(),
    referrer_name: z.string().trim().max(120).optional().nullable(),
    referrer_contact: z.string().trim().max(120).optional().nullable(),
  })
  .refine((p) => Boolean(p.name_cn?.trim() || p.name_en?.trim()), { message: "Enter a name (Chinese or English)" });

const Item = z.discriminatedUnion("type", [
  z.object({ type: z.literal("event"), amount: money }),
  z.object({
    type: z.literal("programme"),
    programme_id: z.string().uuid(),
    template_id: z.string().uuid().optional().nullable(),
    title: z.string().trim().min(1).max(160),
    kind: z.enum(["new", "upgrade", "other"]),
    total_sgd: money,
    mode: z.enum(["deposit", "full"]),
    amount: money,
    set_current: z.boolean(),
  }),
  z.object({ type: z.literal("instalment"), purchase_id: z.string().uuid(), amount: money }),
]);

const Body = z.object({
  participant: z.union([
    z.object({ existing_id: z.string().uuid() }),
    z.object({ new: NewPerson, confirm_new: z.boolean().optional() }),
  ]),
  items: z.array(Item).min(1, "Tick at least one thing to pay for").max(6),
  payment: z.object({
    method: z.enum(["card_pos", "cash", "paynow", "bank_transfer", "tt", "other"]),
    reference: z.string().trim().max(120).optional().nullable(),
    note: z.string().trim().max(500).optional().nullable(),
  }),
  force_capacity: z.boolean().optional(),
});

type Ctx = { params: Promise<{ id: string }> };

const bad = (error: string, detail: string, status = 400, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error, detail, ...extra }, { status });

export async function POST(req: Request, { params }: Ctx) {
  const guard = await requireFinanceAdmin();
  if (!guard.ok) return guard.response;
  const admin = guard.admin;
  const { id: eventId } = await params;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return bad("invalid", parsed.error.issues[0]?.message ?? "Invalid");
  const body = parsed.data;
  const { payment } = body;
  if (payment.method === "card_pos" && !payment.reference?.trim()) {
    return bad("reference_required", "Type the approval code from the terminal receipt.");
  }

  const service = createSupabaseServiceClient();
  const event = await loadCounterEvent(service, eventId);
  if (!event) return bad("event_not_found", "Event not found", 404);

  // ---- Validate items (no writes yet) ----------------------------------
  const eventItems = body.items.filter((i) => i.type === "event");
  if (eventItems.length > 1) return bad("invalid", "The event fee can only be ticked once.");
  const progItems = body.items.filter((i): i is Extract<typeof i, { type: "programme" }> => i.type === "programme");
  const instItems = body.items.filter((i): i is Extract<typeof i, { type: "instalment" }> => i.type === "instalment");

  for (const p of progItems) {
    if (p.amount > p.total_sgd) return bad("invalid", `${p.title}: paying more than the programme total.`);
    if (p.mode === "full" && p.amount !== p.total_sgd) return bad("invalid", `${p.title}: full payment must equal the total.`);
  }
  const templates = progItems.some((p) => p.template_id) ? await loadTemplates(service) : [];
  for (const p of progItems) {
    if (p.template_id && !templates.find((t) => t.id === p.template_id)) return bad("invalid", "Payment template not found.");
    const { data: prog } = await service.from("programmes").select("id").eq("id", p.programme_id).is("deleted_at", null).maybeSingle();
    if (!prog) return bad("invalid", "Programme not found.");
  }

  if (instItems.length && !("existing_id" in body.participant)) {
    return bad("invalid", "A new person has no instalments to pay yet.");
  }

  // ---- Who -------------------------------------------------------------
  let participantId: string;
  let created = false;
  if ("existing_id" in body.participant) {
    const { data } = await service.from("participants").select("id").eq("id", body.participant.existing_id).maybeSingle();
    if (!data) return bad("participant_not_found", "Person not found", 404);
    participantId = data.id;
  } else {
    const np = body.participant.new;
    if (!body.participant.confirm_new) {
      const matches = await phoneMatches(service, np.phone, np.region);
      if (matches.length) {
        return bad("phone_match", "Someone with this phone is already in the CRM.", 409, { matches });
      }
    }
    if (np.email) {
      const { data: e } = await service.from("participants").select("id, name_cn, name_en, region_id").ilike("email", np.email).limit(1);
      if (e?.length) {
        const who = e[0].name_cn || e[0].name_en || "someone";
        return bad("email_taken", `${np.email} already belongs to ${who}${e[0].region_id ? ` (${e[0].region_id})` : ""}. Search for them instead.`, 409);
      }
    }
    // Brought by an existing participant → their CS looks after this person too.
    let assignedCs: string | null = null;
    let referrerName = np.referrer_name ?? null;
    if (np.referrer_id) {
      const { data: r } = await service.from("participants").select("assigned_cs_id, name_cn, name_en, phone").eq("id", np.referrer_id).maybeSingle();
      if (!r) return bad("invalid", "The person who brought them was not found.");
      assignedCs = (r.assigned_cs_id as string | null) ?? null;
      referrerName = referrerName || r.name_cn || r.name_en || null;
    }
    try {
      const res = await insertCounterParticipant(
        service,
        {
          name_cn: np.name_cn || null,
          name_en: np.name_en || null,
          phone: np.phone,
          email: np.email || null,
          region: np.region,
          gender: np.gender || null,
          occupation: np.occupation || null,
          industry: np.industry || null,
          referrer_name: referrerName,
          referrer_contact: np.referrer_contact || null,
        },
        { referrer_id: np.referrer_id ?? null, assigned_cs_id: assignedCs },
      );
      participantId = res.id;
      created = true;
    } catch (err) {
      return bad("participant_insert_failed", err instanceof Error ? err.message : "Could not save the person", 500);
    }
  }

  // Instalments must belong to this person and still be open.
  const instPurchases = new Map<string, { title: string; balance: number }>();
  for (const it of instItems) {
    const v = await loadPurchase(service, it.purchase_id);
    if (!v || v.participant_id !== participantId) return bad("invalid", "That programme purchase isn't this person's.");
    if (v.status === "cancelled") return bad("invalid", `${v.title} is cancelled.`);
    instPurchases.set(v.id, { title: v.title, balance: v.standing.balance });
  }
  for (const it of instItems) {
    const v = instPurchases.get(it.purchase_id)!;
    if (it.amount > v.balance + 0.005) return bad("invalid", `${v.title}: only SGD ${v.balance} is left to pay.`);
  }

  // Event enrolment: existing row, or a new one priced now.
  type Enr = { id: string; status: string; amount_due: number | null; amount_paid: number; approved_at: string | null };
  let enr: Enr | null = null;
  let enrCreated = false;
  let capOverride = false;
  if (eventItems.length) {
    const { data: e } = await service
      .from("enrollments")
      .select("id, status, amount_due, amount_paid, approved_at")
      .eq("event_id", event.id)
      .eq("participant_id", participantId)
      .maybeSingle();
    if (e) {
      if (e.status === "rejected" || e.status === "cancelled") {
        return bad("enrollment_closed", `Their registration for this event is ${e.status}. Reopen it on the Enrolments page first.`, 409);
      }
      enr = { id: e.id, status: e.status, amount_due: e.amount_due == null ? null : Number(e.amount_due), amount_paid: Number(e.amount_paid ?? 0), approved_at: e.approved_at };
      if (enr.status === "paid" && enr.amount_due != null && enr.amount_paid >= enr.amount_due) {
        return bad("already_paid", "Their event fee is already paid in full.", 409);
      }
    } else {
      const cap = await checkCapacity(service, event.id, event.capacity);
      if (cap.full && !body.force_capacity) {
        return bad("no_seats", `This event is full (${cap.current}/${cap.capacity}).`, 409, { capacity: cap.capacity, current: cap.current });
      }
      capOverride = cap.full;
      const pricing = await resolveEnrollmentPrice(event, participantId, service);
      const now = new Date().toISOString();
      const { data: ins, error } = await service
        .from("enrollments")
        .insert({
          participant_id: participantId,
          event_id: event.id,
          price_tier_key: pricing.price_tier_key,
          amount_due: pricing.amount_due,
          price_basis: pricing.price_basis,
          status: "approved",
          approved_by: admin.id,
          approved_at: now,
          amount_paid: 0,
        })
        .select("id, status, amount_due, amount_paid, approved_at")
        .single();
      if (error || !ins) return bad("enroll_failed", error?.message ?? "Could not register them for the event", 500);
      enr = { id: ins.id, status: ins.status, amount_due: ins.amount_due == null ? null : Number(ins.amount_due), amount_paid: 0, approved_at: ins.approved_at };
      enrCreated = true;
    }
  }

  // ---- Write payments ----------------------------------------------------
  const batch = randomUUID();
  const today = sgDay();
  const base = {
    participant_id: participantId,
    currency: "SGD" as const,
    fx_rate: null,
    method: payment.method,
    paid_on: today,
    reference: payment.reference?.trim() || null,
    counter_batch: batch,
    event_id: event.id,
    note: payment.note?.trim() || null,
    recorded_by: admin.id,
  };
  const audits: Parameters<typeof writeAuditLogBatch>[0] = [];
  const result: { enrollment?: { id: string; paid_in_full: boolean }; purchases: string[] } = { purchases: [] };
  let turnedPaid = false;

  try {
    if (enr && eventItems[0]) {
      const amount = eventItems[0].amount;
      const payId = await insertPayment(service, { ...base, enrollment_id: enr.id, amount });
      const newPaid = Math.round((enr.amount_paid + amount) * 100) / 100;
      const due = enr.amount_due ?? newPaid;
      const now = new Date().toISOString();
      const patch: Record<string, unknown> = { amount_paid: newPaid, payment_method: enrollmentMethodFor(payment.method) };
      if (!enr.approved_at) {
        patch.approved_by = admin.id;
        patch.approved_at = now;
      }
      if (newPaid >= due) {
        patch.status = "paid";
        patch.payment_status = "paid";
        patch.paid_at = now;
        turnedPaid = enr.status !== "paid";
      } else {
        patch.status = "approved";
        patch.payment_status = "pending";
      }
      const up = await service.from("enrollments").update(patch).eq("id", enr.id);
      if (up.error) throw new Error(up.error.message);
      result.enrollment = { id: enr.id, paid_in_full: newPaid >= due };
      audits.push({
        actor_id: admin.id, action: "payment.recorded", entity: "payments", entity_id: payId,
        after: { enrollment_id: enr.id, amount_sgd: amount, method: payment.method, reference: base.reference },
        metadata: { via: "counter", event_id: event.id, batch },
      });
      audits.push({
        actor_id: admin.id, action: enrCreated ? "enrollment.created_from_admin" : "enrollment.mark_paid", entity: "enrollments", entity_id: enr.id,
        before: { status: enr.status, amount_paid: enr.amount_paid }, after: { status: patch.status, amount_paid: newPaid },
        metadata: { via: "counter", event_id: event.id, batch, capacity_override: capOverride },
      });
    }

    for (const p of progItems) {
      const tpl = p.template_id ? templates.find((t) => t.id === p.template_id) ?? null : null;
      let schedule: ScheduleRow[];
      if (p.mode === "full") {
        schedule = [{ label: "全款", due_on: today, amount_sgd: p.total_sgd, sort: 0 }];
      } else if (tpl && tpl.items.length) {
        schedule = scheduleFromTemplate(tpl.items, today);
      } else {
        schedule = [{ label: "定金", due_on: today, amount_sgd: p.amount, sort: 0 }];
      }
      const purchaseId = await createPurchase(service, {
        participant_id: participantId,
        programme_id: p.programme_id,
        template_id: tpl?.id ?? null,
        title: p.title,
        kind: p.kind,
        total_sgd: p.total_sgd,
        registered_on: today,
        schedule,
        event_id: event.id,
        note: null,
        created_by: admin.id,
      });
      const payId = await insertPayment(service, { ...base, purchase_id: purchaseId, amount: p.amount });
      await syncPurchaseStatus(service, purchaseId);
      let validity: { started: string; lastDay: string | null } | null = null;
      if (p.set_current) validity = await setCurrentProgramme(service, participantId, p.programme_id, today);
      result.purchases.push(purchaseId);
      audits.push({
        actor_id: admin.id, action: "purchase.created", entity: "programme_purchases", entity_id: purchaseId,
        after: { title: p.title, total_sgd: p.total_sgd, mode: p.mode, schedule, set_current: p.set_current, validity },
        metadata: { via: "counter", event_id: event.id, participant_id: participantId },
      });
      audits.push({
        actor_id: admin.id, action: "payment.recorded", entity: "payments", entity_id: payId,
        after: { purchase_id: purchaseId, amount_sgd: p.amount, method: payment.method, reference: base.reference },
        metadata: { via: "counter", event_id: event.id, batch },
      });
    }

    for (const it of instItems) {
      const payId = await insertPayment(service, { ...base, purchase_id: it.purchase_id, amount: it.amount });
      await syncPurchaseStatus(service, it.purchase_id);
      audits.push({
        actor_id: admin.id, action: "payment.recorded", entity: "payments", entity_id: payId,
        after: { purchase_id: it.purchase_id, amount_sgd: it.amount, method: payment.method, reference: base.reference },
        metadata: { via: "counter", event_id: event.id, batch },
      });
    }
  } catch (err) {
    await writeAuditLogBatch(audits);
    return bad("write_failed", `Stopped part-way: ${err instanceof Error ? err.message : "unknown error"}. Check the person's payments before retrying.`, 500, { batch, participant_id: participantId });
  }

  const total = body.items.reduce((s, i) => s + i.amount, 0);
  audits.push({
    actor_id: admin.id, action: "counter.checkout", entity: "participants", entity_id: participantId,
    after: { total_sgd: Math.round(total * 100) / 100, items: body.items.map((i) => i.type), method: payment.method, reference: base.reference },
    metadata: { event_id: event.id, batch, participant_created: created },
  });
  await writeAuditLogBatch(audits);

  // Student ID on approval/payment, and the receipt once the fee is fully paid.
  if (enr) await ensureRegionId(service, participantId);
  if (enr && turnedPaid) {
    try {
      const { data: pRow } = await service
        .from("participants")
        .select("id, region_id, name_en, name_cn, email, phone, region, language_fluency")
        .eq("id", participantId)
        .maybeSingle();
      if (pRow) {
        const locale = participantEmailLocale(pRow);
        const qrToken = await ensureQrToken(service, enr.id);
        await notifyPaymentReceived({
          enrollment: { id: enr.id, event_id: event.id, participant_id: participantId, amount_paid: null, payment_method: enrollmentMethodFor(payment.method) },
          participant: pRow,
          event,
          amountLabel: fmtAmount(eventItems[0]!.amount + enr.amount_paid, event.currency, locale),
          checkInUrl: qrToken ? buildCheckInUrl(qrToken) : null,
        });
      }
    } catch (err) {
      console.warn("[counter] receipt failed", enr.id, err);
    }
  }

  return NextResponse.json({ ok: true, participant_id: participantId, participant_created: created, batch, total_sgd: total, ...result });
}
