import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createSupabaseServiceClient, createSupabaseServerClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/admin/inbox/attachments/upload
// multipart/form-data:
//   conversation_id: string
//   file: File
//
// Stores outbound attachments in the same `inbox-attachments` bucket used by
// inbound media. Path convention: `<channel>/<conversation_id>/outbound/<uuid>-<safe-name>`
// — matches the inbound path prefix so the existing signed-URL route handles both.
//
// Returns `{path, mime_type, filename, size}`. Caller then POSTs /messages
// with the path in the `attachments` array — send.ts downloads + uploads to
// WhatsApp in one go.

const MAX_BYTES = 10 * 1024 * 1024;

// Mirror the bucket allowlist from migration 014. Expanding this requires a
// Supabase migration to `storage.buckets.allowed_mime_types`.
const ALLOWED_MIME = new Set<string>([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "audio/mpeg",
  "audio/ogg",
  "audio/mp4",
  "audio/webm",
]);

export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (
    admin.role !== "super_admin" &&
    admin.role !== "regional_lead" &&
    admin.role !== "customer_service"
  ) {
    return NextResponse.json(
      { error: "forbidden", detail: "Only super/regional/CS admins can send attachments" },
      { status: 403 },
    );
  }

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return NextResponse.json(
      { error: "bad_request", detail: "multipart/form-data required" },
      { status: 400 },
    );
  }

  const form = await req.formData();
  const conversationId = typeof form.get("conversation_id") === "string"
    ? (form.get("conversation_id") as string).trim()
    : "";
  const file = form.get("file");

  if (!conversationId) {
    return NextResponse.json(
      { error: "validation_error", detail: "conversation_id is required" },
      { status: 400 },
    );
  }
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "validation_error", detail: "file is required" },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      {
        error: "file_too_large",
        detail: `File is ${Math.round(file.size / 1024 / 1024)} MB — max 10 MB`,
      },
      { status: 413 },
    );
  }
  const mimeType = file.type || "application/octet-stream";
  if (!ALLOWED_MIME.has(mimeType)) {
    return NextResponse.json(
      {
        error: "unsupported_media_type",
        detail: `MIME ${mimeType} not allowed. Supported: images, PDF, audio.`,
      },
      { status: 415 },
    );
  }

  // Verify the admin can see the conversation (RLS check) + resolve channel.
  const userClient = await createSupabaseServerClient();
  const { data: conv, error: convErr } = await userClient
    .from("conversations")
    .select("id, channel")
    .eq("id", conversationId)
    .maybeSingle();
  if (convErr) {
    return NextResponse.json({ error: convErr.message }, { status: 500 });
  }
  if (!conv) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (conv.channel !== "whatsapp") {
    return NextResponse.json(
      {
        error: "unsupported_channel",
        detail: "Attachment sending is only supported on WhatsApp threads.",
      },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  const safeName = (file.name || "attachment")
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 80);
  const path = `${conv.channel}/${conversationId}/outbound/${randomUUID()}-${safeName}`;

  const service = createSupabaseServiceClient();
  const { error: uploadErr } = await service.storage
    .from("inbox-attachments")
    .upload(path, buffer, {
      contentType: mimeType,
      upsert: false,
    });
  if (uploadErr) {
    return NextResponse.json(
      { error: "upload_failed", detail: uploadErr.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    path,
    mime_type: mimeType,
    filename: safeName,
    size: file.size,
  });
}
