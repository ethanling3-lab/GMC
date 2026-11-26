import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireFinanceAdmin } from "@/lib/finance/role-guard";
import { writeAuditLog } from "@/lib/audit";
import { syncPurchaseStatus } from "@/lib/payments/ledger";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/admin/payments/[id] { action: "void", reason } — Finance + Super
// Admin. A voided payment stays on record (crossed out) and stops counting.
// For an event fee, the registration's paid amount goes back down too.
const Body = z.object({ action: z.literal("void"), reason: z.string().trim().min(2, "Say why").max(300) });

export async function PATCH(req: Request, { params }: Ctx) {
  const guard = await requireFinanceAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid", detail: parsed.error.issues[0]?.message }, { status: 400 });
  const service = createSupabaseServiceClient();
  const { data: pay } = await service
    .from("payments")
    .select("id, participant_id, purchase_id, enrollment_id, amount_sgd, voided_at")
    .eq("id", id)
    .maybeSingle();
  if (!pay) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (pay.voided_at) return NextResponse.json({ error: "invalid", detail: "Already voided." }, { status: 400 });

  const now = new Date().toISOString();
  const up = await service
    .from("payments")
    .update({ voided_at: now, voided_by: guard.admin.id, void_reason: parsed.data.reason })
    .eq("id", id)
    .is("voided_at", null);
  if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });

  let enrollmentAfter: Record<string, unknown> | null = null;
  if (pay.purchase_id) await syncPurchaseStatus(service, pay.purchase_id);
  if (pay.enrollment_id) {
    const { data: e } = await service.from("enrollments").select("status, amount_due, amount_paid").eq("id", pay.enrollment_id).maybeSingle();
    if (e) {
      const paid = Math.max(0, Math.round((Number(e.amount_paid ?? 0) - Number(pay.amount_sgd)) * 100) / 100);
      const due = e.amount_due == null ? null : Number(e.amount_due);
      const patch: Record<string, unknown> = { amount_paid: paid };
      if (e.status === "paid" && (due == null || paid < due)) {
        patch.status = "approved";
        patch.payment_status = paid > 0 ? "pending" : "none";
        patch.paid_at = null;
      }
      await service.from("enrollments").update(patch).eq("id", pay.enrollment_id);
      enrollmentAfter = patch;
    }
  }
  await writeAuditLog({
    actor_id: guard.admin.id, action: "payment.voided", entity: "payments", entity_id: id,
    after: { voided: true, enrollment: enrollmentAfter },
    metadata: { reason: parsed.data.reason, participant_id: pay.participant_id, amount_sgd: Number(pay.amount_sgd) },
  });
  return NextResponse.json({ ok: true });
}
