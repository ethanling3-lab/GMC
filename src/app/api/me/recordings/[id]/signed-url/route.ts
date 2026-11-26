import { NextResponse } from "next/server";
import { requireParticipant } from "@/lib/participant-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { canWatch } from "@/lib/recordings/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

// GET /api/me/recordings/[id]/signed-url — mint a fresh signed URL for
// the recording's storage object. Used by the player to refresh the
// URL before the 10-minute TTL expires.
//
// Gates on canWatch (member access or a hand-added grant). 404
// (not 403) on missing access — don't leak existence.

const SIGNED_URL_TTL_SECONDS = 600;

export async function GET(_req: Request, { params }: RouteCtx) {
  const participant = await requireParticipant();
  const { id: recordingId } = await params;

  const service = createSupabaseServiceClient();
  if (!(await canWatch(participant.id, recordingId))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { data: recording } = await service
    .from("event_recordings")
    .select("id, storage_path, mime_type, deleted_at")
    .eq("id", recordingId)
    .maybeSingle();
  if (
    !recording ||
    (recording as { deleted_at: string | null }).deleted_at !== null
  ) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const rec = recording as { storage_path: string; mime_type: string | null };

  const { data: signed, error } = await service.storage
    .from("event-recordings")
    .createSignedUrl(rec.storage_path, SIGNED_URL_TTL_SECONDS);
  if (error || !signed) {
    return NextResponse.json(
      { error: "signed_url_failed", detail: error?.message ?? "unknown" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    signed_url: signed.signedUrl,
    mime_type: rec.mime_type,
    expires_in: SIGNED_URL_TTL_SECONDS,
  });
}
