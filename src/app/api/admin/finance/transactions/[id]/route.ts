import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireFinanceAdmin } from "@/lib/finance/role-guard";
import {
  fmtAmount,
  notifyPaymentReceived,
} from "@/lib/enrollment-notifications";
import { writeAuditLog, type AuditAction } from "@/lib/audit";
import { ensureRegionId } from "@/lib/region-id";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// PATCH /api/admin/finance/transactions/[id]
//
// Three actions drive reconciliation:
//
//   { action: "confirm", enrollment_id? }
//     Finalize a match. If enrollment_id is provided, retarget first. Flips
//     the enrolment to paid (mirrors mark_paid in the enrolment route) and
//     stamps the bank_transaction as confirmed. Fires the bilingual receipt.
//
//   { action: "ignore", note? }
//     Mark the txn as ignored (refunds, non-participant transfers, fees).
//     Leaves enrolments untouched.
//
//   { action: "unmatch" }
//     Clears the matched_enrollment_id. Used to walk back a wrong suggestion
//     before confirming a different one.

const PatchBody = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("confirm"),
    enrollment_id: z.string().uuid().optional(),
  }),
  z.object({
    action: z.literal("ignore"),
    note: z.string().trim().max(300).optional(),
  }),
  z.object({
    action: z.literal("unmatch"),
  }),
]);

const ACTION_AUDIT: Record<"confirm" | "ignore" | "unmatch", AuditAction> = {
  confirm: "finance.bank_txn_confirmed",
  ignore: "finance.bank_txn_ignored",
  unmatch: "finance.bank_txn_rematched",
};

type RouteCtx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: RouteCtx) {
  const auth = await requireFinanceAdmin();
  if (!auth.ok) return auth.response;
  const { admin } = auth;

  const { id: txnId } = await params;

  let body: z.infer<typeof PatchBody>;
  try {
    body = PatchBody.parse(await req.json());
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid payload";
    return NextResponse.json({ error: "validation_error", detail: msg }, { status: 400 });
  }

  const service = createSupabaseServiceClient();

  // Load the txn. We need amount + currently-matched enrolment to decide
  // what to do next.
  const { data: txn, error: loadErr } = await service
    .from("bank_transactions")
    .select(
      "id, import_id, status, amount, currency, raw_name, raw_reference, matched_enrollment_id, match_confidence, match_basis, txn_date",
    )
    .eq("id", txnId)
    .maybeSingle();
  if (loadErr) {
    return NextResponse.json({ error: loadErr.message }, { status: 500 });
  }
  if (!txn) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (body.action === "unmatch") {
    const { error: updErr } = await service
      .from("bank_transactions")
      .update({
        status: "unmatched",
        matched_enrollment_id: null,
        match_confidence: null,
        match_basis: null,
        matched_by: admin.id,
        matched_at: new Date().toISOString(),
      })
      .eq("id", txnId);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    await writeAuditLog({
      actor_id: admin.id,
      action: ACTION_AUDIT.unmatch,
      entity: "bank_transactions",
      entity_id: txnId,
      before: {
        status: txn.status,
        matched_enrollment_id: txn.matched_enrollment_id,
      },
      after: { status: "unmatched", matched_enrollment_id: null },
      metadata: { import_id: txn.import_id },
    });
    await refreshImportCounters(service, txn.import_id);
    return NextResponse.json({ ok: true, status: "unmatched" });
  }

  if (body.action === "ignore") {
    const { error: updErr } = await service
      .from("bank_transactions")
      .update({
        status: "ignored",
        note: body.note ?? null,
        matched_by: admin.id,
        matched_at: new Date().toISOString(),
      })
      .eq("id", txnId);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    await writeAuditLog({
      actor_id: admin.id,
      action: ACTION_AUDIT.ignore,
      entity: "bank_transactions",
      entity_id: txnId,
      before: { status: txn.status },
      after: { status: "ignored" },
      metadata: { import_id: txn.import_id, note: body.note ?? null },
    });
    await refreshImportCounters(service, txn.import_id);
    return NextResponse.json({ ok: true, status: "ignored" });
  }

  // --- action === "confirm" ---

  // Already confirmed → no-op (idempotent).
  if (txn.status === "confirmed") {
    return NextResponse.json({ ok: true, replay: true, status: "confirmed" });
  }

  // Resolve which enrolment this txn is finalizing.
  const enrollmentId = body.enrollment_id ?? txn.matched_enrollment_id;
  if (!enrollmentId) {
    return NextResponse.json(
      { error: "no_target", detail: "Pick an enrolment before confirming" },
      { status: 400 },
    );
  }

  // Load the enrolment + join participant + event for the mark_paid mutation
  // and the outbound receipt.
  const { data: row, error: enrollErr } = await service
    .from("enrollments")
    .select(
      "id, event_id, participant_id, status, payment_status, payment_method, amount_paid, participant:participants(id, region_id, name_en, name_cn, email, phone, language), event:events(id, slug, title_en, title_cn, start_date, currency, price)",
    )
    .eq("id", enrollmentId)
    .maybeSingle();
  if (enrollErr) {
    return NextResponse.json({ error: enrollErr.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "enrollment_not_found" }, { status: 404 });
  }

  const now = new Date().toISOString();

  // If the enrolment isn't already paid, flip it. If it is already paid and
  // the admin is confirming a separate inbound transfer, treat this as a
  // partial/top-up payment — we only update amount_paid.
  const wasPaid = row.status === "paid" || row.payment_status === "paid";
  const amountNumber = Number(txn.amount);

  const enrolUpdate: Record<string, unknown> = {
    bank_transaction_id: txnId,
  };
  if (!wasPaid) {
    enrolUpdate.status = "paid";
    enrolUpdate.payment_status = "paid";
    enrolUpdate.payment_method = "bank_transfer";
    enrolUpdate.paid_at = now;
    enrolUpdate.amount_paid = amountNumber;
  } else {
    // Top-up: sum the existing amount_paid with the new inflow.
    const prior = row.amount_paid != null ? Number(row.amount_paid) : 0;
    enrolUpdate.amount_paid = prior + amountNumber;
  }

  const { error: updErr } = await service
    .from("enrollments")
    .update(enrolUpdate)
    .eq("id", row.id);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  // Stamp the txn as confirmed.
  const { error: txnUpdErr } = await service
    .from("bank_transactions")
    .update({
      status: "confirmed",
      matched_enrollment_id: row.id,
      matched_by: admin.id,
      matched_at: now,
      note: null,
    })
    .eq("id", txnId);
  if (txnUpdErr) {
    return NextResponse.json({ error: txnUpdErr.message }, { status: 500 });
  }

  await writeAuditLog({
    actor_id: admin.id,
    action: ACTION_AUDIT.confirm,
    entity: "bank_transactions",
    entity_id: txnId,
    before: { status: txn.status, matched_enrollment_id: txn.matched_enrollment_id },
    after: { status: "confirmed", matched_enrollment_id: row.id },
    metadata: {
      import_id: txn.import_id,
      enrollment_id: row.id,
      amount: amountNumber,
      was_already_paid: wasPaid,
    },
  });

  // Mint the student ID if this is the first confirmed payment.
  if (!wasPaid) {
    await ensureRegionId(service, row.participant_id);
  }

  // Fire the bilingual receipt. Skip on top-ups — we only email once.
  if (!wasPaid) {
    try {
      const participant = (row as unknown as {
        participant: {
          id: string;
          region_id: string | null;
          name_en: string | null;
          name_cn: string | null;
          email: string | null;
          phone: string | null;
          language: string | null;
        } | null;
      }).participant;
      const event = (row as unknown as {
        event: {
          id: string;
          slug: string;
          title_en: string | null;
          title_cn: string | null;
          start_date: string | null;
          currency: string | null;
          price: number | string | null;
        } | null;
      }).event;
      if (participant && event) {
        const locale = (participant.language === "zh" ? "zh" : "en") as "zh" | "en";
        await notifyPaymentReceived({
          enrollment: {
            id: row.id,
            event_id: row.event_id,
            participant_id: participant.id,
            amount_paid: amountNumber,
            payment_method: "bank_transfer",
          },
          participant,
          event,
          amountLabel: fmtAmount(amountNumber, event.currency, locale),
        });
      }
    } catch (err) {
      console.warn("[finance.confirm] notify failed", row.id, err);
    }
  }

  await refreshImportCounters(service, txn.import_id);

  return NextResponse.json({
    ok: true,
    status: "confirmed",
    enrollment_id: row.id,
    was_already_paid: wasPaid,
  });
}

// Recompute the per-status counters on the parent import row. Called after
// every status-changing action so the dashboard chips never drift.
async function refreshImportCounters(
  service: ReturnType<typeof createSupabaseServiceClient>,
  importId: string,
): Promise<void> {
  const { data, error } = await service
    .from("bank_transactions")
    .select("status")
    .eq("import_id", importId);
  if (error) return;
  const rows = (data ?? []) as { status: string }[];
  let auto = 0;
  let sug = 0;
  let un = 0;
  let conf = 0;
  for (const r of rows) {
    if (r.status === "auto_matched") auto++;
    else if (r.status === "suggested") sug++;
    else if (r.status === "unmatched") un++;
    else if (r.status === "confirmed") conf++;
  }
  await service
    .from("bank_imports")
    .update({
      auto_matched_count: auto,
      suggested_count: sug,
      unmatched_count: un,
      confirmed_count: conf,
    })
    .eq("id", importId);
}
