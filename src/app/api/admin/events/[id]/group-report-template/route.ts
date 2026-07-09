import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

// PATCH /api/admin/events/[id]/group-report-template — set (or clear) the
// active group-report template for the event. Kept separate from the main
// event PATCH (which is super_admin-only via a field whitelist) so regional
// leads can manage group reports too.

const bodySchema = z.object({
  template_id: z.string().uuid().nullable(),
});

export async function PATCH(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "regional_lead") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id: eventId } = await params;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input", detail: parsed.error.message }, { status: 400 });
  }

  const service = createSupabaseServiceClient();

  // If setting a template, confirm it exists and is live.
  if (parsed.data.template_id) {
    const { data: tpl } = await service
      .from("group_report_templates")
      .select("id")
      .eq("id", parsed.data.template_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!tpl) return NextResponse.json({ error: "template_not_found" }, { status: 404 });
  }

  const { error } = await service
    .from("events")
    .update({ group_report_template_id: parsed.data.template_id })
    .eq("id", eventId);
  if (error) {
    return NextResponse.json({ error: "update_failed", detail: error.message }, { status: 500 });
  }

  await writeAuditLog({
    actor_id: admin.id,
    action: "event.group_report_template_changed",
    entity: "events",
    entity_id: eventId,
    metadata: { template_id: parsed.data.template_id },
  });

  return NextResponse.json({ ok: true });
}
