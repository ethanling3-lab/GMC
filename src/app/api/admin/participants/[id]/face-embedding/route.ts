import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";
import { EMBEDDING_LEN } from "@/lib/face-recognition/types";

// POST /api/admin/participants/[id]/face-embedding
//
// Stores a freshly-computed face embedding for a participant. Called by
// PhotoUploader right after a successful photo upload (and by a
// re-compute button on the participant detail page). Embedding is
// always extracted client-side via face-api.js; this route just
// persists it.
//
// Body shape:
//   { embedding: number[] }                  — success
//   { error: "no_face_detected" | ... }     — extractor failure (we
//                                             still record the failure
//                                             reason for admin visibility)
//
// We refuse to store an embedding for a participant who hasn't opted in;
// the route returns 409 in that case so PhotoUploader can suppress the
// extract step pre-emptively.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

const ALLOWED_ROLES = new Set([
  "super_admin",
  "regional_lead",
  "customer_service",
]);

const SuccessBody = z.object({
  embedding: z
    .array(z.number().finite())
    .length(EMBEDDING_LEN),
  confidence: z.number().min(0).max(1).optional(),
});

const FailureBody = z.object({
  error: z.enum([
    "no_face_detected",
    "multiple_faces",
    "low_confidence",
    "load_failed",
    "decode_failed",
  ]),
  detail: z.string().max(200).optional(),
});

const Body = z.union([SuccessBody, FailureBody]);

export async function POST(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (!ALLOWED_ROLES.has(admin.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid payload";
    return NextResponse.json(
      { error: "validation_error", detail: msg },
      { status: 400 },
    );
  }

  const service = createSupabaseServiceClient();
  const { data: row, error: lookupErr } = await service
    .from("participants")
    .select("id, facial_recognition_consent")
    .eq("id", id)
    .maybeSingle();
  if (lookupErr) {
    return NextResponse.json({ error: lookupErr.message }, { status: 500 });
  }
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!row.facial_recognition_consent) {
    return NextResponse.json({ error: "no_consent" }, { status: 409 });
  }

  const now = new Date().toISOString();
  const update =
    "embedding" in parsed
      ? {
          face_embedding: parsed.embedding,
          face_embedding_at: now,
          face_embedding_error: null,
        }
      : {
          face_embedding: null,
          face_embedding_at: now,
          face_embedding_error: parsed.error,
        };

  const { error: writeErr } = await service
    .from("participants")
    .update(update)
    .eq("id", id);
  if (writeErr) {
    return NextResponse.json({ error: writeErr.message }, { status: 500 });
  }

  await writeAuditLog({
    actor_id: admin.id,
    action:
      "embedding" in parsed
        ? "participant.face_embedding_computed"
        : "participant.face_embedding_failed",
    entity: "participants",
    entity_id: id,
    metadata:
      "embedding" in parsed
        ? { confidence: parsed.confidence ?? null }
        : { error: parsed.error, detail: parsed.detail ?? null },
  });

  return NextResponse.json({ ok: true });
}
