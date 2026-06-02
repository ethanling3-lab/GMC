import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string; recordingId: string }> };

// POST /api/admin/events/[id]/recordings/[recordingId]/grants/bulk-paid
// Grants access to every participant who has a paid enrollment for the
// event. The common case — "share the recording with everyone who
// attended."

export async function POST(_req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "regional_lead") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id: eventId, recordingId } = await params;

  const service = createSupabaseServiceClient();
  const { data: paidRows, error: enrollErr } = await service
    .from("enrollments")
    .select("participant_id")
    .eq("event_id", eventId)
    .in("status", ["paid"]);
  if (enrollErr) {
    return NextResponse.json({ error: "load_failed", detail: enrollErr.message }, { status: 500 });
  }
  const participantIds = [
    ...new Set((paidRows ?? []).map((r) => (r as { participant_id: string }).participant_id)),
  ];
  if (participantIds.length === 0) {
    return NextResponse.json({ ok: true, count: 0 });
  }

  const rows = participantIds.map((pid) => ({
    recording_id: recordingId,
    participant_id: pid,
    granted_by: admin.id,
    granted_at: new Date().toISOString(),
    revoked_at: null,
  }));

  const { error: upErr } = await service
    .from("event_recording_access")
    .upsert(rows, { onConflict: "recording_id,participant_id", ignoreDuplicates: true });
  if (upErr) {
    return NextResponse.json({ error: "grant_failed", detail: upErr.message }, { status: 500 });
  }
  // Revive revoked.
  await service
    .from("event_recording_access")
    .update({ revoked_at: null, granted_by: admin.id, granted_at: new Date().toISOString() })
    .eq("recording_id", recordingId)
    .in("participant_id", participantIds)
    .not("revoked_at", "is", null);

  await writeAuditLog({
    actor_id: admin.id,
    action: "recording.access_granted",
    entity: "event_recordings",
    entity_id: recordingId,
    metadata: { via: "bulk_paid", event_id: eventId, count: participantIds.length },
  });

  return NextResponse.json({ ok: true, count: participantIds.length });
}
