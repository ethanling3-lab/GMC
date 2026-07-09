import { NextResponse } from "next/server";
import { z } from "zod";
import { requireParticipant } from "@/lib/participant-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { resolveSubmittableAssignment } from "@/lib/course-portal";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

// POST /api/me/assignments/[id]/submit — save (draft) or submit a homework /
// report. Upserts one submission per (assignment, participant) and replaces
// its file list with the storage paths the browser already uploaded via the
// upload-url route. `action` = "draft" keeps it editable; "submit" stamps
// submitted_at and flips status. Re-submitting an already-submitted piece is
// allowed (status stays submitted, submitted_at refreshed).

const fileSchema = z.object({
  storage_path: z.string().min(1).max(400),
  filename: z.string().min(1).max(200),
  mime_type: z.string().max(120).nullable().optional(),
  byte_size: z.number().int().nonnegative().nullable().optional(),
});

const bodySchema = z.object({
  action: z.enum(["draft", "submit"]),
  text_body: z.string().max(20000).optional(),
  files: z.array(fileSchema).max(20).optional(),
});

export async function POST(req: Request, { params }: RouteCtx) {
  const participant = await requireParticipant();
  const { id: assignmentId } = await params;

  const gate = await resolveSubmittableAssignment(participant.id, assignmentId);
  if (!gate) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", detail: parsed.error.message },
      { status: 400 },
    );
  }
  const { action, text_body, files = [] } = parsed.data;

  const textTrimmed = (text_body ?? "").trim();

  // On final submit, enforce that something was provided per the assignment's
  // submission_type. Drafts can be empty.
  if (action === "submit") {
    const hasText = textTrimmed.length > 0;
    const hasFiles = files.length > 0;
    if (gate.submissionType === "text" && !hasText) {
      return NextResponse.json({ error: "text_required" }, { status: 400 });
    }
    if (gate.submissionType === "file" && !hasFiles) {
      return NextResponse.json({ error: "file_required" }, { status: 400 });
    }
    if (gate.submissionType === "both" && !hasText && !hasFiles) {
      return NextResponse.json({ error: "empty_submission" }, { status: 400 });
    }
  }

  const service = createSupabaseServiceClient();
  const now = new Date().toISOString();
  const status = action === "submit" ? "submitted" : "draft";

  // Upsert the submission row by the (assignment, participant) unique index.
  const { data: upserted, error: upsertErr } = await service
    .from("course_submissions")
    .upsert(
      {
        assignment_id: assignmentId,
        participant_id: participant.id,
        status,
        text_body: gate.submissionType === "file" ? null : textTrimmed || null,
        submitted_at: action === "submit" ? now : null,
      },
      { onConflict: "assignment_id,participant_id" },
    )
    .select("id")
    .single();
  if (upsertErr || !upserted) {
    return NextResponse.json(
      { error: "save_failed", detail: upsertErr?.message ?? "unknown" },
      { status: 500 },
    );
  }
  const submissionId = upserted.id as string;

  // Replace the file list: drop existing rows, insert the current set. The
  // storage objects themselves persist (orphans are harmless in a private
  // bucket); we only re-point the metadata rows.
  if (gate.submissionType !== "text") {
    await service.from("course_submission_files").delete().eq("submission_id", submissionId);
    if (files.length > 0) {
      const { error: filesErr } = await service.from("course_submission_files").insert(
        files.map((f) => ({
          submission_id: submissionId,
          storage_path: f.storage_path,
          filename: f.filename,
          mime_type: f.mime_type ?? null,
          byte_size: f.byte_size ?? null,
        })),
      );
      if (filesErr) {
        return NextResponse.json(
          { error: "files_save_failed", detail: filesErr.message },
          { status: 500 },
        );
      }
    }
  }

  await writeAuditLog({
    actor_id: null,
    action: action === "submit" ? "submission.submitted" : "submission.saved_draft",
    entity: "course_submissions",
    entity_id: submissionId,
    metadata: {
      assignment_id: assignmentId,
      participant_id: participant.id,
      file_count: files.length,
    },
  });

  return NextResponse.json({ ok: true, status, submission_id: submissionId });
}
