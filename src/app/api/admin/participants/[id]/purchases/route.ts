import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireFinanceAdmin } from "@/lib/finance/role-guard";
import { writeAuditLog } from "@/lib/audit";
import { createPurchase, setCurrentProgramme } from "@/lib/payments/ledger";
import { ScheduleSchema } from "@/lib/payments/schemas";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/admin/participants/[id]/purchases — record a programme purchase
// away from the counter (e.g. bought earlier, upgrade). Finance + Super Admin.
const Body = z.object({
  programme_id: z.string().uuid().nullable(),
  template_id: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1, "Give it a title").max(160),
  kind: z.enum(["new", "upgrade", "other"]),
  total_sgd: z.number().positive().max(1_000_000),
  registered_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  schedule: ScheduleSchema,
  note: z.string().trim().max(500).nullable().optional(),
  set_current: z.boolean().optional(),
});

export async function POST(req: Request, { params }: Ctx) {
  const guard = await requireFinanceAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid", detail: parsed.error.issues[0]?.message }, { status: 400 });
  const b = parsed.data;
  if (b.set_current && !b.programme_id) {
    return NextResponse.json({ error: "invalid", detail: "Pick a programme to set it as current." }, { status: 400 });
  }
  const service = createSupabaseServiceClient();
  const { data: p } = await service.from("participants").select("id").eq("id", id).maybeSingle();
  if (!p) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const schedule = b.schedule.map((r, i) => ({ label: r.label, due_on: r.due_on || null, amount_sgd: r.amount_sgd, sort: i }));
  const purchaseId = await createPurchase(service, {
    participant_id: id,
    programme_id: b.programme_id,
    template_id: b.template_id ?? null,
    title: b.title,
    kind: b.kind,
    total_sgd: b.total_sgd,
    registered_on: b.registered_on,
    schedule,
    event_id: null,
    note: b.note ?? null,
    created_by: guard.admin.id,
  });
  let validity = null;
  if (b.set_current && b.programme_id) validity = await setCurrentProgramme(service, id, b.programme_id, b.registered_on);
  await writeAuditLog({
    actor_id: guard.admin.id,
    action: "purchase.created",
    entity: "programme_purchases",
    entity_id: purchaseId,
    after: { title: b.title, total_sgd: b.total_sgd, registered_on: b.registered_on, schedule, set_current: !!b.set_current, validity },
    metadata: { via: "manual", participant_id: id },
  });
  return NextResponse.json({ ok: true, id: purchaseId });
}
