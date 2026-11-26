import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireFinanceAdmin } from "@/lib/finance/role-guard";
import { writeAuditLog } from "@/lib/audit";
import { loadTemplates } from "@/lib/payments/ledger";
import { TemplateSchema } from "@/lib/payments/schemas";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/admin/finance/templates/[id] — replace a template (rows included).
// Purchases already made keep their own copied schedule, so this never
// changes what an existing buyer owes. Finance + Super Admin.
export async function PATCH(req: Request, { params }: Ctx) {
  const guard = await requireFinanceAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const parsed = TemplateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid", detail: parsed.error.issues[0]?.message }, { status: 400 });
  const b = parsed.data;
  const service = createSupabaseServiceClient();
  const before = (await loadTemplates(service)).find((t) => t.id === id);
  if (!before) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const up = await service
    .from("payment_templates")
    .update({ name: b.name, programme_id: b.programme_id ?? null, kind: b.kind, total_sgd: b.total_sgd, note: b.note ?? null, active: b.active ?? true, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });
  const del = await service.from("payment_template_items").delete().eq("template_id", id);
  if (del.error) return NextResponse.json({ error: del.error.message }, { status: 500 });
  const ins = await service
    .from("payment_template_items")
    .insert(b.items.map((it, i) => ({ template_id: id, label: it.label, amount_sgd: it.amount_sgd, due_after_months: it.due_after_months, sort: i })));
  if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });
  await writeAuditLog({ actor_id: guard.admin.id, action: "payment_template.updated", entity: "payment_templates", entity_id: id, before, after: b });
  return NextResponse.json({ ok: true });
}
