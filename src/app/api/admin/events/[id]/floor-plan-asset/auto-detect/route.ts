import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";
import {
  VISION_MODEL,
  VISION_TASK,
  detectTablesInFloorPlan,
} from "@/lib/floor-plan/vision-detect";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Vision detection is slow + heavy. Allow up to 60s before the platform
// times out (Vercel/Netlify default is shorter for the lambda runtime).
export const maxDuration = 60;

// POST /api/admin/events/[id]/floor-plan-asset/auto-detect
//
// Sends the event's uploaded background plan to Opus 4.7 vision and returns
// candidate table boxes. The response is normalized (x_norm/y_norm 0-1 of
// image dimensions) — the client owns the letterbox math and the
// accept/reject UI. No shapes are spawned by this route; admin must accept
// each candidate explicitly via the existing layout shapes POST.

type RouteCtx = { params: Promise<{ id: string }> };

const BUCKET = "event-floor-plans";

export async function POST(_req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "regional_lead") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id: eventId } = await params;
  const service = createSupabaseServiceClient();

  // Load the event's background asset (max 1 per event, kind=background_image).
  const { data: asset } = await service
    .from("event_floor_plan_assets")
    .select("id, storage_path, original_filename")
    .eq("event_id", eventId)
    .eq("kind", "background_image")
    .maybeSingle<{
      id: string;
      storage_path: string;
      original_filename: string | null;
    }>();
  if (!asset) {
    return NextResponse.json(
      {
        error: "no_asset",
        detail: "Upload a background floor plan first.",
      },
      { status: 404 },
    );
  }

  // Fetch the bytes from the private bucket.
  const { data: blob, error: dlErr } = await service.storage
    .from(BUCKET)
    .download(asset.storage_path);
  if (dlErr || !blob) {
    return NextResponse.json(
      {
        error: "download_failed",
        detail: dlErr?.message ?? "could not load image",
      },
      { status: 500 },
    );
  }

  // Determine MIME from filename suffix as the source of truth — bucket
  // already restricts to image kinds at upload time. Fallback to PNG.
  const mimeType = guessMime(asset.original_filename ?? asset.storage_path);
  if (mimeType === null) {
    return NextResponse.json(
      {
        error: "unsupported_media_type",
        detail: "Asset is not an image format Claude can read.",
      },
      { status: 415 },
    );
  }

  const buffer = Buffer.from(await blob.arrayBuffer());

  const result = await detectTablesInFloorPlan(buffer, mimeType);

  // Telemetry — even failures get a row so we can trace cost vs. success.
  await service
    .from("ai_runs")
    .insert({
      conversation_id: null,
      message_id: null,
      task: VISION_TASK,
      model: VISION_MODEL,
      input_tokens: result.tokens_in,
      output_tokens: result.tokens_out,
      cache_read_tokens: result.cache_read_tokens,
      cache_creation_tokens: result.cache_creation_tokens,
      latency_ms: result.latency_ms,
      result: {
        event_id: eventId,
        asset_id: asset.id,
        candidate_count: result.candidates.length,
        notes: result.notes,
        failure_reason: result.failure_reason ?? null,
      },
    })
    .then((r) => r, () => undefined); // never fail the request on a telemetry write

  if (result.failure_reason) {
    return NextResponse.json(
      {
        error: result.failure_reason.startsWith("anthropic_call_failed")
          ? "anthropic_failure"
          : result.failure_reason,
        detail: result.failure_reason,
      },
      {
        status: result.failure_reason === "anthropic_api_key_missing"
          ? 503
          : 502,
      },
    );
  }

  await writeAuditLog({
    actor_id: admin.id,
    action: "floor_plan.auto_detected",
    entity: "event_floor_plan_assets",
    entity_id: asset.id,
    after: {
      candidate_count: result.candidates.length,
      tokens_in: result.tokens_in,
      tokens_out: result.tokens_out,
      latency_ms: result.latency_ms,
    },
    metadata: { event_id: eventId },
  });

  return NextResponse.json({
    ok: true,
    candidates: result.candidates,
    notes: result.notes,
    telemetry: {
      tokens_in: result.tokens_in,
      tokens_out: result.tokens_out,
      cache_read_tokens: result.cache_read_tokens,
      cache_creation_tokens: result.cache_creation_tokens,
      latency_ms: result.latency_ms,
    },
  });
}

function guessMime(
  pathOrFilename: string,
): "image/jpeg" | "image/png" | "image/webp" | null {
  const lower = pathOrFilename.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return null;
}
