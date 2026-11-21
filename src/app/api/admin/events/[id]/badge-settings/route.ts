import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";
import { BADGE_BUCKET, loadBadgeSettings } from "@/lib/badges/load";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// /api/admin/events/[id]/badge-settings — the event's 名牌 design.
//
// GET    settings + a fresh signed URL for the background
// PUT    ink colour / QR plate / layout knobs
// POST   multipart upload of the background design (replaces the previous one)
// DELETE remove the background design
//
// One background per event, stored in the private event-floor-plans bucket
// under `${eventId}/badge/` — same delete-then-upload approach as
// floor-plan-asset, so the settings row never points at two files.

type RouteCtx = { params: Promise<{ id: string }> };

const MAX_BYTES = 20 * 1024 * 1024; // bucket cap
const ALLOWED_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

function canEdit(role: string) {
  return role === "super_admin" || role === "regional_lead";
}
function canView(role: string) {
  return canEdit(role) || role === "instructor";
}

async function eventExists(
  service: ReturnType<typeof createSupabaseServiceClient>,
  eventId: string,
) {
  const { data } = await service
    .from("events")
    .select("id")
    .eq("id", eventId)
    .maybeSingle();
  return Boolean(data);
}

export async function GET(_req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (!canView(admin.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id: eventId } = await params;
  const service = createSupabaseServiceClient();
  const { bg_storage_path: _p, ...settings } = await loadBadgeSettings(service, eventId);
  return NextResponse.json({ settings });
}

const PutBody = z.object({
  ink_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  qr_plate: z.boolean(),
  plate_fill: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  plate_ink: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  name_center_pct: z.number().min(5).max(95),
  qr_top_pct: z.number().min(5).max(95),
  qr_size_mm: z.number().min(18).max(44),
});

export async function PUT(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (!canEdit(admin.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id: eventId } = await params;

  const parsed = PutBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", detail: parsed.error.message },
      { status: 400 },
    );
  }

  const service = createSupabaseServiceClient();
  if (!(await eventExists(service, eventId))) {
    return NextResponse.json({ error: "event_not_found" }, { status: 404 });
  }

  const { error } = await service.from("event_badge_settings").upsert(
    { event_id: eventId, ...parsed.data, updated_by: admin.id },
    { onConflict: "event_id" },
  );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

async function removePriorBackground(
  service: ReturnType<typeof createSupabaseServiceClient>,
  eventId: string,
): Promise<{ removed: boolean; error?: string }> {
  const { data: existing } = await service
    .from("event_badge_settings")
    .select("bg_storage_path")
    .eq("event_id", eventId)
    .maybeSingle<{ bg_storage_path: string | null }>();
  if (!existing?.bg_storage_path) return { removed: false };

  const { error: delObjErr } = await service.storage
    .from(BADGE_BUCKET)
    .remove([existing.bg_storage_path]);
  if (delObjErr) {
    // An orphaned object is tolerable; a row pointing at nothing is not.
    console.warn("badge background prior storage delete failed", delObjErr);
  }
  const { error: updErr } = await service
    .from("event_badge_settings")
    .update({ bg_storage_path: null, bg_original_filename: null })
    .eq("event_id", eventId);
  if (updErr) return { removed: false, error: updErr.message };
  return { removed: true };
}

export async function POST(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (!canEdit(admin.role)) {
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
            ? "PDF designs aren't supported — export the design as PNG or JPEG."
            : `${mimeType} not allowed. Use PNG, JPEG, or WebP.`,
      },
      { status: 415 },
    );
  }

  const service = createSupabaseServiceClient();
  if (!(await eventExists(service, eventId))) {
    return NextResponse.json({ error: "event_not_found" }, { status: 404 });
  }

  const prior = await removePriorBackground(service, eventId);
  if (prior.error) {
    return NextResponse.json(
      { error: "prior_delete_failed", detail: prior.error },
      { status: 500 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const safeName = (file.name || "badge")
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 80);
  const path = `${eventId}/badge/${randomUUID()}-${safeName}`;

  const { error: uploadErr } = await service.storage
    .from(BADGE_BUCKET)
    .upload(path, buffer, { contentType: mimeType, upsert: false });
  if (uploadErr) {
    return NextResponse.json(
      { error: "upload_failed", detail: uploadErr.message },
      { status: 500 },
    );
  }

  const { error: upsertErr } = await service.from("event_badge_settings").upsert(
    {
      event_id: eventId,
      bg_storage_path: path,
      bg_original_filename: file.name ?? null,
      updated_by: admin.id,
    },
    { onConflict: "event_id" },
  );
  if (upsertErr) {
    await service.storage.from(BADGE_BUCKET).remove([path]).catch(() => undefined);
    return NextResponse.json({ error: upsertErr.message }, { status: 500 });
  }

  await writeAuditLog({
    actor_id: admin.id,
    action: "badges.background_uploaded",
    entity: "event",
    entity_id: eventId,
    after: { storage_path: path, original_filename: file.name ?? null },
    metadata: { mime_type: mimeType, size: file.size, replaced_prior: prior.removed },
  });

  const { bg_storage_path: _p, ...settings } = await loadBadgeSettings(service, eventId);
  return NextResponse.json({ ok: true, settings });
}

export async function DELETE(_req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (!canEdit(admin.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id: eventId } = await params;
  const service = createSupabaseServiceClient();
  const prior = await removePriorBackground(service, eventId);
  if (prior.error) {
    return NextResponse.json(
      { error: "delete_failed", detail: prior.error },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, removed: prior.removed });
}
