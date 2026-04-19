import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_POSTER_BYTES = 15 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const BUCKET = "event-posters";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  const { id: eventId } = await params;

  if (admin.role !== "super_admin") {
    return NextResponse.json(
      { error: "Only super admins can change event posters" },
      { status: 403 },
    );
  }

  const service = createSupabaseServiceClient();

  // Confirm the event exists (so we don't upload orphan files)
  const { data: existing, error: loadErr } = await service
    .from("events")
    .select("id, poster_url")
    .eq("id", eventId)
    .maybeSingle();
  if (loadErr) {
    return NextResponse.json({ error: loadErr.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json(
      { error: "Expected multipart/form-data" },
      { status: 415 },
    );
  }

  const form = await req.formData();
  const action = String(form.get("action") ?? "upload");

  if (action === "remove") {
    const { error } = await service
      .from("events")
      .update({ poster_url: null })
      .eq("id", eventId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    // Best-effort storage cleanup. If the previous poster was stored in this
    // bucket, remove it so we don't leak orphaned blobs.
    const previous = existing.poster_url;
    if (previous) {
      const marker = `/object/public/${BUCKET}/`;
      const idx = previous.indexOf(marker);
      if (idx >= 0) {
        const key = previous.slice(idx + marker.length);
        await service.storage.from(BUCKET).remove([key]);
      }
    }
    return NextResponse.json({ ok: true, url: null });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json(
      {
        error: `Unsupported image type (${file.type || "unknown"}). Use JPEG, PNG, or WebP.`,
      },
      { status: 415 },
    );
  }

  if (file.size > MAX_POSTER_BYTES) {
    return NextResponse.json(
      { error: `Image is larger than ${MAX_POSTER_BYTES / 1024 / 1024}MB` },
      { status: 413 },
    );
  }

  const ext =
    (file.name.split(".").pop() ?? "jpg")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${eventId}/${Date.now()}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());

  const { error: uploadErr } = await service.storage
    .from(BUCKET)
    .upload(path, buf, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadErr) {
    return NextResponse.json(
      {
        error: `Upload failed: ${uploadErr.message}. Confirm the "${BUCKET}" bucket exists in Supabase.`,
      },
      { status: 500 },
    );
  }

  const { data: publicData } = service.storage.from(BUCKET).getPublicUrl(path);
  const publicUrl = publicData?.publicUrl ?? null;

  const { error: updateErr } = await service
    .from("events")
    .update({ poster_url: publicUrl })
    .eq("id", eventId);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  // Clean up the previous poster if it was in our bucket.
  const previous = existing.poster_url;
  if (previous && previous !== publicUrl) {
    const marker = `/object/public/${BUCKET}/`;
    const idx = previous.indexOf(marker);
    if (idx >= 0) {
      const key = previous.slice(idx + marker.length);
      await service.storage.from(BUCKET).remove([key]);
    }
  }

  return NextResponse.json({ ok: true, url: publicUrl });
}
