import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { requireParticipant } from "@/lib/participant-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { resolveSubmittableAssignment } from "@/lib/course-portal";
import { SUBMISSION_ACCEPT_MIME } from "@/lib/course-portal-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

// POST /api/me/assignments/[id]/upload-url — mint a signed upload URL so the
// browser can PUT a homework file straight into the private
// course-submissions bucket (bypassing the Netlify payload/timeout limits),
// mirroring the recordings upload flow. Gated: the participant must be
// enrolled in the assignment's event, and the assignment must accept files.

const bodySchema = z.object({
  filename: z.string().min(1).max(200),
  mime_type: z.enum(SUBMISSION_ACCEPT_MIME),
});

export async function POST(req: Request, { params }: RouteCtx) {
  const participant = await requireParticipant();
  const { id: assignmentId } = await params;

  const gate = await resolveSubmittableAssignment(participant.id, assignmentId);
  if (!gate) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (gate.submissionType === "text") {
    return NextResponse.json({ error: "files_not_allowed" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", detail: parsed.error.message },
      { status: 400 },
    );
  }

  const ext = parsed.data.filename.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const storage_path = `${gate.eventId}/${assignmentId}/${participant.id}/${randomUUID()}.${ext}`;

  const service = createSupabaseServiceClient();
  const { data, error } = await service.storage
    .from("course-submissions")
    .createSignedUploadUrl(storage_path);
  if (error || !data) {
    return NextResponse.json(
      { error: "signed_url_failed", detail: error?.message ?? "unknown" },
      { status: 500 },
    );
  }

  return NextResponse.json({ storage_path, upload_url: data.signedUrl, token: data.token });
}
