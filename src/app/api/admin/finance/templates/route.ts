import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireFinanceAdmin } from "@/lib/finance/role-guard";
import { writeAuditLog } from "@/lib/audit";
import { loadTemplates } from "@/lib/payments/ledger";
import { TemplateSchema } from "@/lib/payments/schemas";

export const dynamic = "force-dynamic";

// GET  /api/admin/finance/templates — all payment templates.
// POST /api/admin/finance/templates — create one. Finance + Super Admin.
export async function GET() {
  const guard = await requireFinanceAdmin();
  if (!guard.ok) return guard.response;
  return NextResponse.json({ templates: await loadTemplates(createSupabaseServiceClient()) });
}

export async function POST(req: Request) {
  const guard = await requireFinanceAdmin();
  if (!guard.ok) return guard.response;
  const parsed = TemplateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid", detail: parsed.error.issues[0]?.message }, { status: 400 });
  const b = parsed.data;
  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from("payment_templates")
    .insert({ name: b.name, programme_id: b.programme_id ?? null, kind: b.kind, total_sgd: b.total_sgd, note: b.note ?? null, active: b.active ?? true, created_by: guard.admin.id })
    .select("id")
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "insert_failed" }, { status: 500 });
  const items = await service
    .from("payment_template_items")
    .insert(b.items.map((it, i) => ({ template_id: data.id, label: it.label, amount_sgd: it.amount_sgd, due_after_months: it.due_after_months, sort: i })));
  if (items.error) return NextResponse.json({ error: items.error.message }, { status: 500 });
  await writeAuditLog({ actor_id: guard.admin.id, action: "payment_template.created", entity: "payment_templates", entity_id: data.id, after: b });
  return NextResponse.json({ ok: true, id: data.id });
}
