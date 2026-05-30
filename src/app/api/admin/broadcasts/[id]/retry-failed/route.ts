import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";
import { requeueFailedRecipients } from "@/lib/broadcasts/materialize";
import { kickBroadcastFanout } from "@/lib/broadcasts/kick-fanout";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

// POST /api/admin/broadcasts/:id/retry-failed — re-queue failed
// recipients (outside_window, provider, unknown errors) as pending and
// re-kick the background fn. no_address + cancelled stay where they
// are; admin would need to fix the underlying participant record then
// resend the whole broadcast.
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
  if (status !== "partial" && status !== "failed" && status !== "sent") {
    return NextResponse.json(
      { error: "wrong_status", detail: `Cannot retry broadcast in status ${status}` },
      { status: 409 },
    );
  }

  const { requeued } = await requeueFailedRecipients(service, id);
  if (requeued === 0) {
    return NextResponse.json({ ok: true, requeued: 0, kick: null });
  }

  await service
    .from("broadcasts")
    .update({ status: "sending", completed_at: null, updated_by: admin.id })
    .eq("id", id);

  const kick = await kickBroadcastFanout(id);

  await writeAuditLog({
    actor_id: admin.id,
    action: "broadcast.retry_failed",
    entity: "broadcasts",
    entity_id: id,
    metadata: { requeued, kick_mocked: kick.mocked, kick_status: kick.status },
  });

  return NextResponse.json({ ok: true, requeued, kick }, { status: 202 });
}
