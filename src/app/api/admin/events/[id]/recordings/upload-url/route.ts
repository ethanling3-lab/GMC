import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

// POST /api/admin/events/[id]/recordings/upload-url — mints a signed
// upload URL for browser-direct upload to the event-recordings bucket.
// Required because recordings are too large (hundreds of MB) to hop
// through a Next API route (Netlify 26s timeout + payload caps).

const bodySchema = z.object({
  filename: z.string().min(1).max(200),
  mime_type: z.enum([
    "video/mp4",
    "video/webm",
    "video/quicktime",
    "audio/mpeg",
    "audio/mp4",
    "audio/ogg",
  ]),
});

export async function POST(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "regional_lead") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id: eventId } = await params;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", detail: parsed.error.message },
      { status: 400 },
    );
  }

  // Verify the event exists (RLS would catch this otherwise but we want a clean 404).
  const service = createSupabaseServiceClient();
  const { data: event } = await service
    .from("events")
    .select("id")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) return NextResponse.json({ error: "event_not_found" }, { status: 404 });

  const ext = parsed.data.filename.split(".").pop()?.toLowerCase() ?? "bin";
  const storage_path = `${eventId}/${randomUUID()}.${ext}`;

  const { data, error } = await service.storage
    .from("event-recordings")
    .createSignedUploadUrl(storage_path);
  if (error || !data) {
    return NextResponse.json(
      { error: "signed_url_failed", detail: error?.message ?? "unknown" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    storage_path,
    upload_url: data.signedUrl,
    token: data.token,
    mime_type: parsed.data.mime_type,
  });
}
