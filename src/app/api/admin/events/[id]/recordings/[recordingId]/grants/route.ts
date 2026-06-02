import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string; recordingId: string }> };

const grantSchema = z.object({
  participant_ids: z.array(z.string().uuid()).min(1).max(2000),
});

// POST /api/admin/events/[id]/recordings/[recordingId]/grants — grant
// access to a list of participants. Upserts on (recording_id, participant_id)
// with revoked_at=null so re-granting reuses the same row.
export async function POST(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "regional_lead") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { recordingId } = await params;

  const parsed = grantSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input", detail: parsed.error.message }, { status: 400 });
  }

  const service = createSupabaseServiceClient();
  const rows = parsed.data.participant_ids.map((pid) => ({
    recording_id: recordingId,
    participant_id: pid,
    granted_by: admin.id,
    granted_at: new Date().toISOString(),
    revoked_at: null,
  }));

  // Upsert by the live partial unique index. We need to clear any prior
  // revoked rows for the same (recording, participant) pair to make room
  // for the new live grant — Supabase upsert with a partial-unique
  // constraint can be fiddly, so we do a clean insert with conflict
  // ignore + a separate revive-revoked pass.
  // For simplicity at v1: insert with ignoreDuplicates, then bump any
  // already-existing rows' revoked_at to null.
  const { error: insErr } = await service
    .from("event_recording_access")
    .upsert(rows, {
      onConflict: "recording_id,participant_id",
      ignoreDuplicates: true,
    });
  if (insErr) {
    return NextResponse.json({ error: "grant_failed", detail: insErr.message }, { status: 500 });
  }

  // Revive any rows we may have collided with (already-revoked grants).
  const { error: revErr } = await service
    .from("event_recording_access")
    .update({ revoked_at: null, granted_by: admin.id, granted_at: new Date().toISOString() })
    .eq("recording_id", recordingId)
    .in("participant_id", parsed.data.participant_ids)
    .not("revoked_at", "is", null);
  if (revErr) {
    console.warn(`[grants] revive failed: ${revErr.message}`);
  }

  await writeAuditLog({
    actor_id: admin.id,
    action: "recording.access_granted",
    entity: "event_recordings",
    entity_id: recordingId,
    metadata: { participant_ids: parsed.data.participant_ids, count: parsed.data.participant_ids.length },
  });

  return NextResponse.json({ ok: true, count: parsed.data.participant_ids.length });
}

// GET — list current live grants for the recording.
export async function GET(_req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  void admin;
  const { recordingId } = await params;
  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from("event_recording_access")
    .select(
      "id, granted_at, participant_id, participant:participants(id, region_id, name_en, name_cn)",
    )
    .eq("recording_id", recordingId)
    .is("revoked_at", null)
    .order("granted_at", { ascending: false })
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ grants: data ?? [] });
}
