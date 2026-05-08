import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// /api/admin/events/[id]/floor-plan-asset
//
// One background-image asset per event. POST replaces the existing asset
// (deletes the previous storage object + row before inserting the new one)
// so the rest of the editor never has to handle a list. PATCH adjusts only
// the opacity. DELETE removes the asset.
//
// Storage bucket `event-floor-plans` is private. The route returns a fresh
// signed URL (1h TTL) on every successful POST so the client can render
// immediately; subsequent page loads regenerate the URL via the layout
// page loader.

type RouteCtx = { params: Promise<{ id: string }> };

const BUCKET = "event-floor-plans";
const SIGNED_URL_TTL = 60 * 60; // 1 hour
const MAX_BYTES = 20 * 1024 * 1024; // bucket cap

// Image kinds only for v1. The bucket allows PDFs but the editor can't
// render PDF inline yet; reject early with a clear hint.
const ALLOWED_IMAGE_MIME = new Set<string>([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

async function deletePriorAsset(
  service: ReturnType<typeof createSupabaseServiceClient>,
  eventId: string,
): Promise<{ removed: boolean; error?: string }> {
  const { data: existing } = await service
    .from("event_floor_plan_assets")
    .select("id, storage_path")
    .eq("event_id", eventId)
    .eq("kind", "background_image")
    .maybeSingle<{ id: string; storage_path: string }>();
  if (!existing) return { removed: false };
  const { error: delObjErr } = await service.storage
    .from(BUCKET)
    .remove([existing.storage_path]);
  if (delObjErr) {
    // Storage deletion failure is recoverable — orphaned objects are tolerable
    // and removing the table row is more important. Log + continue.
    console.warn("floor_plan asset prior storage delete failed", delObjErr);
  }
  const { error: delRowErr } = await service
    .from("event_floor_plan_assets")
    .delete()
    .eq("id", existing.id);
  if (delRowErr) return { removed: false, error: delRowErr.message };
  return { removed: true };
}

export async function POST(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "regional_lead") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id: eventId } = await params;

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return NextResponse.json(
      { error: "bad_request", detail: "multipart/form-data required" },
      { status: 400 },
    );
  }

  const form = await req.formData();
  const file = form.get("file");
  const opacityRaw = form.get("opacity");

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
        detail: `File is ${Math.round(file.size / 1024 / 1024)} MB — max 20 MB`,
      },
      { status: 413 },
    );
  }
  const mimeType = file.type || "application/octet-stream";
  if (!ALLOWED_IMAGE_MIME.has(mimeType)) {
    return NextResponse.json(
      {
        error: "unsupported_media_type",
        detail:
          mimeType === "application/pdf"
            ? "PDF uploads aren't supported yet — export the page as PNG or JPEG and try again."
            : `MIME ${mimeType} not allowed. Use JPEG, PNG, or WebP.`,
      },
      { status: 415 },
    );
  }

  let opacity = 0.4;
  if (typeof opacityRaw === "string" && opacityRaw.length > 0) {
    const n = Number(opacityRaw);
    if (Number.isFinite(n)) opacity = Math.max(0.05, Math.min(1, n));
  }

  const service = createSupabaseServiceClient();

  // Confirm the event exists.
  const { data: ev } = await service
    .from("events")
    .select("id")
    .eq("id", eventId)
    .maybeSingle();
  if (!ev) {
    return NextResponse.json({ error: "event_not_found" }, { status: 404 });
  }

  // Drop any prior background_image asset before uploading the new one.
  const prior = await deletePriorAsset(service, eventId);
  if (prior.error) {
    return NextResponse.json(
      { error: "prior_delete_failed", detail: prior.error },
      { status: 500 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const safeName = (file.name || "background")
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 80);
  const path = `${eventId}/${randomUUID()}-${safeName}`;

  const { error: uploadErr } = await service.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: mimeType, upsert: false });
  if (uploadErr) {
    return NextResponse.json(
      { error: "upload_failed", detail: uploadErr.message },
      { status: 500 },
    );
  }

  // Insert the asset row. width_px / height_px are left null for v1 — the
  // editor reads natural dimensions client-side from the rendered <image>.
  const { data: inserted, error: insErr } = await service
    .from("event_floor_plan_assets")
    .insert({
      event_id: eventId,
      kind: "background_image",
      storage_path: path,
      original_filename: file.name ?? null,
      opacity,
    })
    .select("id, storage_path, opacity, width_px, height_px, original_filename")
    .single();
  if (insErr || !inserted) {
    // Try to clean up the orphan storage object before returning.
    await service.storage.from(BUCKET).remove([path]).catch(() => undefined);
    return NextResponse.json(
      { error: insErr?.message ?? "insert_failed" },
      { status: 500 },
    );
  }

  const { data: signed, error: signErr } = await service.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL);
  if (signErr || !signed?.signedUrl) {
    return NextResponse.json(
      { error: "sign_failed", detail: signErr?.message },
      { status: 500 },
    );
  }

  await writeAuditLog({
    actor_id: admin.id,
    action: "floor_plan.image_uploaded",
    entity: "event_floor_plan_assets",
    entity_id: inserted.id,
    after: {
      storage_path: inserted.storage_path,
      opacity: inserted.opacity,
      original_filename: inserted.original_filename,
      replaced_prior: prior.removed,
    },
    metadata: { event_id: eventId, mime_type: mimeType, size: file.size },
  });

  return NextResponse.json({
    ok: true,
    asset: {
      id: inserted.id,
      storage_path: inserted.storage_path,
      opacity: Number(inserted.opacity),
      width_px: inserted.width_px,
      height_px: inserted.height_px,
      original_filename: inserted.original_filename,
      url: signed.signedUrl,
    },
  });
}

const PatchBody = z.object({
  opacity: z.number().min(0.05).max(1),
});

export async function PATCH(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "regional_lead") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id: eventId } = await params;

  let body: z.infer<typeof PatchBody>;
  try {
    body = PatchBody.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: "validation_error",
        detail: err instanceof Error ? err.message : "invalid body",
      },
      { status: 400 },
    );
  }

  const service = createSupabaseServiceClient();
  const { data: existing } = await service
    .from("event_floor_plan_assets")
    .select("id, opacity")
    .eq("event_id", eventId)
    .eq("kind", "background_image")
    .maybeSingle<{ id: string; opacity: number }>();
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (Number(existing.opacity) === body.opacity) {
    return NextResponse.json({ ok: true, unchanged: true });
  }

  const { error: updErr } = await service
    .from("event_floor_plan_assets")
    .update({ opacity: body.opacity })
    .eq("id", existing.id);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, asset: { id: existing.id, opacity: body.opacity } });
}

export async function DELETE(_req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "regional_lead") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id: eventId } = await params;
  const service = createSupabaseServiceClient();

  const prior = await deletePriorAsset(service, eventId);
  if (prior.error) {
    return NextResponse.json(
      { error: "delete_failed", detail: prior.error },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, removed: prior.removed });
}
