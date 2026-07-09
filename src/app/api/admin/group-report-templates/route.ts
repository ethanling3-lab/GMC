import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";
import { defaultGroupReportSchema } from "@/lib/group-report-schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET  /api/admin/group-report-templates — list active (non-deleted) templates.
// POST /api/admin/group-report-templates — create a new empty template.

const createSchema = z.object({
  name_en: z.string().max(200).optional(),
  name_cn: z.string().max(200).optional(),
});

export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "regional_lead") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input", detail: parsed.error.message }, { status: 400 });
  }
  if (!parsed.data.name_en && !parsed.data.name_cn) {
    return NextResponse.json({ error: "name_required" }, { status: 400 });
  }

  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from("group_report_templates")
    .insert({
      name_en: parsed.data.name_en ?? null,
      name_cn: parsed.data.name_cn ?? null,
      schema: defaultGroupReportSchema(),
      created_by: admin.id,
    })
    .select("id")
    .single();
  if (error || !data) {
    return NextResponse.json({ error: "insert_failed", detail: error?.message ?? "unknown" }, { status: 500 });
  }

  await writeAuditLog({
    actor_id: admin.id,
    action: "group_report_template.created",
    entity: "group_report_templates",
    entity_id: data.id,
    metadata: {},
  });

  return NextResponse.json({ ok: true, id: data.id }, { status: 201 });
}

export async function GET() {
  const admin = await requireAdmin();
  void admin;

  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from("group_report_templates")
    .select("id, name_en, name_cn, active, created_at, updated_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ templates: data ?? [] });
}
