import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string; assignmentId: string }> };

// PATCH  — edit an assignment (fields + active toggle).
// DELETE — soft-delete an assignment (stamps deleted_at).

const patchSchema = z.object({
  title_en: z.string().max(200).nullable().optional(),
  title_cn: z.string().max(200).nullable().optional(),
  description_en: z.string().max(4000).nullable().optional(),
  description_cn: z.string().max(4000).nullable().optional(),
  kind: z.enum(["homework", "report"]).optional(),
  submission_type: z.enum(["file", "text", "both"]).optional(),
  due_at: z.string().datetime().nullable().optional(),
  active: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "regional_lead") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { assignmentId } = await params;

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
    .from("course_assignments")
    .update(patch)
    .eq("id", assignmentId)
    .is("deleted_at", null);
  if (error) {
    return NextResponse.json({ error: "update_failed", detail: error.message }, { status: 500 });
  }

  await writeAuditLog({
    actor_id: admin.id,
    action: "assignment.updated",
    entity: "course_assignments",
    entity_id: assignmentId,
    metadata: { fields: Object.keys(patch) },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "regional_lead") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { assignmentId } = await params;

  const service = createSupabaseServiceClient();
  const { error } = await service
    .from("course_assignments")
    .update({ deleted_at: new Date().toISOString(), active: false })
    .eq("id", assignmentId)
    .is("deleted_at", null);
  if (error) {
    return NextResponse.json({ error: "delete_failed", detail: error.message }, { status: 500 });
  }

  await writeAuditLog({
    actor_id: admin.id,
    action: "assignment.deleted",
    entity: "course_assignments",
    entity_id: assignmentId,
    metadata: {},
  });

  return NextResponse.json({ ok: true });
}
