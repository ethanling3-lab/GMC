import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";
import { grantByHand } from "@/lib/recordings/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string; recordingId: string }> };

const grantSchema = z.object({
  participant_ids: z.array(z.string().uuid()).min(1).max(2000),
  /** Last day they can watch (Singapore date). Omit / null = no end. */
  expires_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  note: z.string().trim().max(300).nullable().optional(),
});

// POST — add people by hand (Phase 4: anyone who isn't covered by the
// automatic member access). Re-adding someone updates their last day.
export async function POST(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "regional_lead") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id: eventId, recordingId } = await params;

  const parsed = grantSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input", detail: parsed.error.message }, { status: 400 });
  }

  const service = createSupabaseServiceClient();
  const { data: rec } = await service
    .from("event_recordings")
    .select("id")
    .eq("id", recordingId)
    .eq("event_id", eventId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!rec) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let result: { added: number; updated: number };
  try {
    result = await grantByHand(service, recordingId, parsed.data.participant_ids, {
      adminId: admin.id,
      expiresOn: parsed.data.expires_on ?? null,
      note: parsed.data.note || null,
    });
  } catch (e) {
    return NextResponse.json({ error: "grant_failed", detail: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }

  await writeAuditLog({
    actor_id: admin.id,
    action: "recording.access_granted",
    entity: "event_recordings",
    entity_id: recordingId,
    metadata: {
      participant_ids: parsed.data.participant_ids,
      expires_on: parsed.data.expires_on ?? null,
      ...result,
    },
  });

  return NextResponse.json({ ok: true, ...result });
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
