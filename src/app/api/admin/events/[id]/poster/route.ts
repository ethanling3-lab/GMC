import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_POSTER_BYTES = 15 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const BUCKET = "event-posters";
const STORAGE_MARKER = `/object/public/${BUCKET}/`;

// Conceptually one ordered list of images per event:
//   images[0] → poster_url  (hero / thumbnail / share preview)
//   images[1..] → gallery   (rest of the slideshow)
// The DB keeps two columns for backwards compatibility; this route is the
// only writer that coordinates them so the editor doesn't have to care.

type RouteCtx = { params: Promise<{ id: string }> };

type EventRow = {
  id: string;
  poster_url: string | null;
  gallery: string[] | null;
};

function assembleImages(row: EventRow): string[] {
  const list: string[] = [];
  if (row.poster_url) list.push(row.poster_url);
  for (const g of row.gallery ?? []) {
    if (g && g !== row.poster_url) list.push(g);
  }
  return list;
}

function splitForDb(images: string[]) {
  return {
    poster_url: images[0] ?? null,
    gallery: images.slice(1),
  };
}

function storageKeyFor(url: string): string | null {
  const idx = url.indexOf(STORAGE_MARKER);
  if (idx < 0) return null;
  return url.slice(idx + STORAGE_MARKER.length);
}

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

  const { data: existing, error: loadErr } = await service
    .from("events")
    .select("id, poster_url, gallery")
    .eq("id", eventId)
    .maybeSingle<EventRow>();
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
  const current = assembleImages(existing);

  // ---------- upload ----------
  if (action === "upload") {
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
    const path = `${eventId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const buf = Buffer.from(await file.arrayBuffer());

    const { error: uploadErr } = await service.storage
      .from(BUCKET)
      .upload(path, buf, { contentType: file.type, upsert: false });
    if (uploadErr) {
      return NextResponse.json(
        {
          error: `Upload failed: ${uploadErr.message}. Confirm the "${BUCKET}" bucket exists in Supabase.`,
        },
        { status: 500 },
      );
    }

    const { data: publicData } = service.storage
      .from(BUCKET)
      .getPublicUrl(path);
    const publicUrl = publicData?.publicUrl;
    if (!publicUrl) {
      return NextResponse.json(
        { error: "Could not resolve public URL for uploaded file" },
        { status: 500 },
      );
    }

    const next = [...current, publicUrl];
    const { error: updateErr } = await service
      .from("events")
      .update(splitForDb(next))
      .eq("id", eventId);
    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, images: next });
  }

  // ---------- remove ----------
  if (action === "remove") {
    const url = String(form.get("url") ?? "");
    if (!url) {
      return NextResponse.json({ error: "Missing url" }, { status: 400 });
    }
    const next = current.filter((u) => u !== url);
    if (next.length === current.length) {
      return NextResponse.json(
        { error: "URL is not part of this event's images" },
        { status: 404 },
      );
    }

    const { error: updateErr } = await service
      .from("events")
      .update(splitForDb(next))
      .eq("id", eventId);
    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    // Best-effort storage cleanup
    const key = storageKeyFor(url);
    if (key) await service.storage.from(BUCKET).remove([key]);

    return NextResponse.json({ ok: true, images: next });
  }

  // ---------- set_hero (promote to index 0) ----------
  if (action === "set_hero") {
    const url = String(form.get("url") ?? "");
    if (!url) {
      return NextResponse.json({ error: "Missing url" }, { status: 400 });
    }
    if (!current.includes(url)) {
      return NextResponse.json(
        { error: "URL is not part of this event's images" },
        { status: 404 },
      );
    }
    const next = [url, ...current.filter((u) => u !== url)];
    const { error: updateErr } = await service
      .from("events")
      .update(splitForDb(next))
      .eq("id", eventId);
    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, images: next });
  }

  return NextResponse.json({ error: `Unknown action "${action}"` }, { status: 400 });
}
