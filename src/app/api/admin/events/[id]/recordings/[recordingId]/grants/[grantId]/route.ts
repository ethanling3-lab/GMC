import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string; recordingId: string; grantId: string }> };

// DELETE — revoke a grant (soft via revoked_at). Participant no longer
// sees the recording in /me/recordings.
export async function DELETE(_req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "regional_lead") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { grantId } = await params;

  const service = createSupabaseServiceClient();
  const { error } = await service
    .from("event_recording_access")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", grantId);
  if (error) {
    return NextResponse.json({ error: "revoke_failed", detail: error.message }, { status: 500 });
  }

  await writeAuditLog({
    actor_id: admin.id,
    action: "recording.access_revoked",
    entity: "event_recording_access",
    entity_id: grantId,
  });
  return NextResponse.json({ ok: true });
}
