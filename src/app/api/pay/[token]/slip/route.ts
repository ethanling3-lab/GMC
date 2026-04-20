import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { verifyPaymentAccessToken } from "@/lib/tokens";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB, mirrors the bucket cap.
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

const EXT_FOR_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

type RouteCtx = { params: Promise<{ token: string }> };

export async function POST(req: Request, { params }: RouteCtx) {
  const { token } = await params;
  const verified = verifyPaymentAccessToken(token);
  if (!verified) {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  }
  const enrollmentId = verified.enrollmentId;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid_form" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing_file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "file_too_large" }, { status: 413 });
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json({ error: "unsupported_type", type: file.type }, { status: 415 });
  }

  const service = createSupabaseServiceClient();

  // Confirm the enrolment still exists + is in a payable state. We don't
  // restrict by status — even rejected/cancelled rows can technically have
  // a slip uploaded if the participant is responding to a previous email,
  // but only approved/pending get useful action from admin.
  const { data: enr, error: enrErr } = await service
    .from("enrollments")
    .select("id, event_id, participant_id, status")
    .eq("id", enrollmentId)
    .maybeSingle();
  if (enrErr) {
    return NextResponse.json({ error: enrErr.message }, { status: 500 });
  }
  if (!enr) {
    return NextResponse.json({ error: "enrollment_not_found" }, { status: 404 });
  }

  const ext = EXT_FOR_MIME[file.type];
  const path = `${enrollmentId}/${Date.now()}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());

  const upload = await service.storage
    .from("transfer-slips")
    .upload(path, buf, {
      contentType: file.type,
      upsert: false,
    });
  if (upload.error) {
    return NextResponse.json(
      { error: "upload_failed", detail: upload.error.message },
      { status: 500 },
    );
  }

  const now = new Date().toISOString();
  const updRes = await service
    .from("enrollments")
    .update({
      transfer_slip_url: path,
      transfer_slip_uploaded_at: now,
    })
    .eq("id", enrollmentId);
  if (updRes.error) {
    return NextResponse.json({ error: updRes.error.message }, { status: 500 });
  }

  await writeAuditLog({
    actor_id: null,
    action: "enrollment.transfer_slip_uploaded",
    entity: "enrollments",
    entity_id: enrollmentId,
    metadata: {
      event_id: enr.event_id,
      via: "pay_portal",
      content_type: file.type,
      bytes: file.size,
    },
  });

  return NextResponse.json({ ok: true });
}
