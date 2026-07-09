import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";
import { GroupReportSchema } from "@/lib/group-report-schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

// GET    — load one template (for the builder).
// PATCH  — update name / active / the full schema document (replaced wholesale).
// DELETE — soft-delete.

const patchSchema = z.object({
  name_en: z.string().max(200).nullable().optional(),
  name_cn: z.string().max(200).nullable().optional(),
  active: z.boolean().optional(),
  schema: GroupReportSchema.optional(),
});

export async function GET(_req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  void admin;
  const { id } = await params;

  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from("group_report_templates")
    .select("id, name_en, name_cn, active, schema, created_at, updated_at")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({ template: data });
}

export async function PATCH(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "regional_lead") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input", detail: parsed.error.message }, { status: 400 });
  }
  const patch = parsed.data;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "empty_patch" }, { status: 400 });
  }

  const service = createSupabaseServiceClient();
  const { error } = await service
    .from("group_report_templates")
    .update(patch)
    .eq("id", id)
    .is("deleted_at", null);
  if (error) {
    return NextResponse.json({ error: "update_failed", detail: error.message }, { status: 500 });
  }

  await writeAuditLog({
    actor_id: admin.id,
    action: "group_report_template.updated",
    entity: "group_report_templates",
    entity_id: id,
    metadata: { fields: Object.keys(patch) },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "regional_lead") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;

  const service = createSupabaseServiceClient();
  const { error } = await service
    .from("group_report_templates")
    .update({ deleted_at: new Date().toISOString(), active: false })
    .eq("id", id)
    .is("deleted_at", null);
  if (error) {
    return NextResponse.json({ error: "delete_failed", detail: error.message }, { status: 500 });
  }

  await writeAuditLog({
    actor_id: admin.id,
    action: "group_report_template.deleted",
    entity: "group_report_templates",
    entity_id: id,
    metadata: {},
  });

  return NextResponse.json({ ok: true });
}
