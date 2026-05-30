import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";
import { ScheduleBroadcastBodyZ } from "@/lib/broadcasts/api-schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

// POST /api/admin/broadcasts/:id/schedule — flip draft → scheduled with
// a future scheduled_for. The cron at /api/cron/broadcasts-due picks
// these up every 5 min.
export async function POST(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "regional_lead") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;

  let body: ReturnType<typeof ScheduleBroadcastBodyZ.parse>;
  try {
    body = ScheduleBroadcastBodyZ.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: "validation_error", detail: err instanceof Error ? err.message : "Invalid" },
      { status: 400 },
    );
  }

  const scheduledFor = new Date(body.scheduled_for);
  if (!Number.isFinite(scheduledFor.getTime())) {
    return NextResponse.json({ error: "invalid_date" }, { status: 400 });
  }
  if (scheduledFor.getTime() <= Date.now()) {
    return NextResponse.json(
      { error: "in_the_past", detail: "scheduled_for must be in the future" },
      { status: 400 },
    );
  }

  const service = createSupabaseServiceClient();
  const { data: existing } = await service
    .from("broadcasts")
    .select("id, status")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const status = (existing as { status: string }).status;
  if (status !== "draft" && status !== "scheduled") {
    return NextResponse.json(
      { error: "wrong_status", detail: `Cannot schedule broadcast in status ${status}` },
      { status: 409 },
    );
  }

  const { error: updErr } = await service
    .from("broadcasts")
    .update({
      status: "scheduled",
      scheduled_for: scheduledFor.toISOString(),
      updated_by: admin.id,
    })
    .eq("id", id);
  if (updErr) {
    return NextResponse.json({ error: "update_failed", detail: updErr.message }, { status: 500 });
  }

  await writeAuditLog({
    actor_id: admin.id,
    action: "broadcast.scheduled",
    entity: "broadcasts",
    entity_id: id,
    metadata: { scheduled_for: scheduledFor.toISOString() },
  });

  return NextResponse.json({ ok: true, scheduled_for: scheduledFor.toISOString() });
}
