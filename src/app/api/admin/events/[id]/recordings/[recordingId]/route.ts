import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string; recordingId: string }> };

const patchSchema = z.object({
  title_en: z.string().max(200).nullable().optional(),
  title_cn: z.string().max(200).nullable().optional(),
  description_en: z.string().max(2000).nullable().optional(),
  description_cn: z.string().max(2000).nullable().optional(),
});

export async function PATCH(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "regional_lead") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { recordingId } = await params;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", detail: parsed.error.message },
      { status: 400 },
    );
  }

  const updates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== undefined) updates[k] = v;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ ok: true });
  }

  const service = createSupabaseServiceClient();
  const { error } = await service
    .from("event_recordings")
    .update(updates)
    .eq("id", recordingId);
  if (error) {
    return NextResponse.json({ error: "update_failed", detail: error.message }, { status: 500 });
  }

  await writeAuditLog({
    actor_id: admin.id,
    action: "recording.updated",
    entity: "event_recordings",
    entity_id: recordingId,
    metadata: { fields: Object.keys(updates) },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "regional_lead") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { recordingId } = await params;

  const service = createSupabaseServiceClient();
  const { error } = await service
    .from("event_recordings")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", recordingId);
  if (error) {
    return NextResponse.json({ error: "delete_failed", detail: error.message }, { status: 500 });
  }

  await writeAuditLog({
    actor_id: admin.id,
    action: "recording.deleted",
    entity: "event_recordings",
    entity_id: recordingId,
  });
  return NextResponse.json({ ok: true });
}
