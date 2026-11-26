import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireFinanceAdmin } from "@/lib/finance/role-guard";
import { writeAuditLog } from "@/lib/audit";
import { insertPayment, loadPurchase, syncPurchaseStatus, toSgd } from "@/lib/payments/ledger";
import { PaymentInSchema } from "@/lib/payments/schemas";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/admin/purchases/[id]/payments — record a payment away from the
// counter (bank transfer, MYR at a typed rate…). Finance + Super Admin.
export async function POST(req: Request, { params }: Ctx) {
  const guard = await requireFinanceAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const parsed = PaymentInSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid", detail: parsed.error.issues[0]?.message }, { status: 400 });
  const b = parsed.data;
  if (b.method === "card_pos" && !b.reference?.trim()) {
    return NextResponse.json({ error: "invalid", detail: "Type the approval code from the terminal receipt." }, { status: 400 });
  }
  const service = createSupabaseServiceClient();
  const purchase = await loadPurchase(service, id);
  if (!purchase) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (purchase.status === "cancelled") return NextResponse.json({ error: "invalid", detail: "This purchase is cancelled." }, { status: 400 });

  const fx = b.currency === "MYR" ? b.fx_rate ?? null : null;
  const payId = await insertPayment(service, {
    participant_id: purchase.participant_id,
    purchase_id: id,
    amount: b.amount,
    currency: b.currency,
    fx_rate: fx,
    method: b.method,
    paid_on: b.paid_on,
    reference: b.reference?.trim() || null,
    note: b.note?.trim() || null,
    recorded_by: guard.admin.id,
  });
  await syncPurchaseStatus(service, id);
  await writeAuditLog({
    actor_id: guard.admin.id, action: "payment.recorded", entity: "payments", entity_id: payId,
    after: { purchase_id: id, amount: b.amount, currency: b.currency, fx_rate: fx, amount_sgd: toSgd(b.amount, b.currency, fx), method: b.method, paid_on: b.paid_on, reference: b.reference ?? null },
    metadata: { via: "manual", participant_id: purchase.participant_id },
  });
  return NextResponse.json({ ok: true, id: payId, purchase: await loadPurchase(service, id) });
}
