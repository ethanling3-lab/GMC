import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

// POST /api/admin/broadcasts/:id/cancel — cancel a scheduled or
// in-flight broadcast.
//
// scheduled → cancelled (no recipients exist yet).
// sending → cancelled; pending recipients flip to skipped with
// error_code='cancelled'. In-flight provider calls won't be aborted —
// any recipient whose adapter call already returned will still get
// stamped sent/failed by the background fn. We accept that race.
export async function POST(_req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "regional_lead") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;

  const service = createSupabaseServiceClient();
  const { data: existing } = await service
    .from("broadcasts")
    .select("id, status")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const status = (existing as { status: string }).status;
  if (status !== "scheduled" && status !== "sending" && status !== "draft" && status !== "partial") {
    return NextResponse.json(
      { error: "wrong_status", detail: `Cannot cancel broadcast in status ${status}` },
      { status: 409 },
    );
  }

  // Mark remaining pending recipients as skipped — they won't fire even
  // if the background fn is mid-batch (it queries fresh pending rows
  // on every loop).
  const { error: skipErr } = await service
    .from("broadcast_recipients")
    .update({
      status: "skipped",
      error_code: "cancelled",
      error_message: "Broadcast cancelled before send",
    })
    .eq("broadcast_id", id)
    .eq("status", "pending");
  if (skipErr) {
    return NextResponse.json({ error: "skip_failed", detail: skipErr.message }, { status: 500 });
  }

  const { error: updErr } = await service
    .from("broadcasts")
    .update({
      status: "cancelled",
      completed_at: new Date().toISOString(),
      updated_by: admin.id,
    })
    .eq("id", id);
  if (updErr) {
    return NextResponse.json({ error: "update_failed", detail: updErr.message }, { status: 500 });
  }

  await writeAuditLog({
    actor_id: admin.id,
    action: "broadcast.cancelled",
    entity: "broadcasts",
    entity_id: id,
    metadata: { previous_status: status },
  });

  return NextResponse.json({ ok: true });
}
