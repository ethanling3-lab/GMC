import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";
import { canRunEvent } from "@/lib/check-in/gate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// DELETE /api/admin/events/[id]/check-in/test-data
//
// Removes every record made while the event was in test mode (is_test): check-ins
// and any rows left in the retired out-of-class log. Real records are never
// touched.

type RouteCtx = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (!canRunEvent(admin.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id: eventId } = await params;
  const service = createSupabaseServiceClient();

  const [exits, checkIns] = await Promise.all([
    service.from("class_exits").delete().eq("event_id", eventId).eq("is_test", true).select("id"),
    service.from("check_ins").delete().eq("event_id", eventId).eq("is_test", true).select("id"),
  ]);
  const err = exits.error ?? checkIns.error;
  if (err) {
    return NextResponse.json({ error: "delete_failed", detail: err.message }, { status: 500 });
  }

  const result = {
    check_ins: (checkIns.data ?? []).length,
    class_exits: (exits.data ?? []).length,
  };
  await writeAuditLog({
    actor_id: admin.id,
    action: "check_in.test_data_cleared",
    entity: "events",
    entity_id: eventId,
    metadata: result,
  });

  return NextResponse.json({ ok: true, deleted: result });
}
