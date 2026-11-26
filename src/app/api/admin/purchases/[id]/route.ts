import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireFinanceAdmin } from "@/lib/finance/role-guard";
import { writeAuditLog } from "@/lib/audit";
import { loadPurchase, replaceSchedule, syncPurchaseStatus } from "@/lib/payments/ledger";
import { ScheduleSchema } from "@/lib/payments/schemas";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/admin/purchases/[id] — Finance + Super Admin.
//   { action: "schedule", rows, reason }   change this buyer's own schedule
//   { action: "edit", title, total_sgd, note }
//   { action: "cancel", reason } / { action: "reopen" }
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("schedule"), rows: ScheduleSchema, reason: z.string().trim().min(2, "Say why the schedule changed").max(300) }),
  z.object({
    action: z.literal("edit"),
    title: z.string().trim().min(1).max(160),
    total_sgd: z.number().positive().max(1_000_000),
    note: z.string().trim().max(500).nullable().optional(),
  }),
  z.object({ action: z.literal("cancel"), reason: z.string().trim().min(2, "Say why it is cancelled").max(300) }),
  z.object({ action: z.literal("reopen") }),
]);

export async function PATCH(req: Request, { params }: Ctx) {
  const guard = await requireFinanceAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid", detail: parsed.error.issues[0]?.message }, { status: 400 });
  const b = parsed.data;
  const service = createSupabaseServiceClient();
  const before = await loadPurchase(service, id);
  if (!before) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const now = new Date().toISOString();

  if (b.action === "schedule") {
    const rows = b.rows.map((r, i) => ({ label: r.label, due_on: r.due_on || null, amount_sgd: r.amount_sgd, sort: i }));
    await replaceSchedule(service, id, rows);
    await service.from("programme_purchases").update({ updated_at: now }).eq("id", id);
    await writeAuditLog({
      actor_id: guard.admin.id, action: "purchase.schedule_changed", entity: "programme_purchases", entity_id: id,
      before: { schedule: before.schedule.map(({ label, due_on, amount_sgd }) => ({ label, due_on, amount_sgd })) },
      after: { schedule: rows.map(({ label, due_on, amount_sgd }) => ({ label, due_on, amount_sgd })) },
      metadata: { reason: b.reason, participant_id: before.participant_id },
    });
  } else if (b.action === "edit") {
    await service.from("programme_purchases").update({ title: b.title, total_sgd: b.total_sgd, note: b.note ?? null, updated_at: now }).eq("id", id);
    await syncPurchaseStatus(service, id);
    await writeAuditLog({
      actor_id: guard.admin.id, action: "purchase.updated", entity: "programme_purchases", entity_id: id,
      before: { title: before.title, total_sgd: before.total_sgd, note: before.note },
      after: { title: b.title, total_sgd: b.total_sgd, note: b.note ?? null },
      metadata: { participant_id: before.participant_id },
    });
  } else if (b.action === "cancel") {
    await service.from("programme_purchases").update({ status: "cancelled", cancelled_at: now, cancel_reason: b.reason, updated_at: now }).eq("id", id);
    await writeAuditLog({
      actor_id: guard.admin.id, action: "purchase.cancelled", entity: "programme_purchases", entity_id: id,
      before: { status: before.status }, after: { status: "cancelled" },
      metadata: { reason: b.reason, participant_id: before.participant_id, paid_sgd: before.standing.paid },
    });
  } else {
    await service.from("programme_purchases").update({ status: "active", cancelled_at: null, cancel_reason: null, updated_at: now }).eq("id", id);
    await syncPurchaseStatus(service, id);
    await writeAuditLog({
      actor_id: guard.admin.id, action: "purchase.updated", entity: "programme_purchases", entity_id: id,
      before: { status: before.status }, after: { status: "active" }, metadata: { reopened: true, participant_id: before.participant_id },
    });
  }
  return NextResponse.json({ ok: true, purchase: await loadPurchase(service, id) });
}
