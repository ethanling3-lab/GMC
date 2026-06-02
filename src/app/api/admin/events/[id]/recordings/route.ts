import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

// POST /api/admin/events/[id]/recordings — insert metadata after the
// browser has finished the direct upload via the signed URL.
//
// GET /api/admin/events/[id]/recordings — list active recordings for
// the event with grant counts. Used by the admin recordings page.

const createSchema = z.object({
  storage_path: z.string().min(1).max(400),
  title_en: z.string().max(200).optional(),
  title_cn: z.string().max(200).optional(),
  description_en: z.string().max(2000).optional(),
  description_cn: z.string().max(2000).optional(),
  mime_type: z.string().max(80),
  byte_size: z.number().int().nonnegative().optional(),
  duration_seconds: z.number().int().nonnegative().optional(),
});

export async function POST(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "regional_lead") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id: eventId } = await params;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", detail: parsed.error.message },
      { status: 400 },
    );
  }
  if (!parsed.data.title_en && !parsed.data.title_cn) {
    return NextResponse.json(
      { error: "title_required", detail: "title_en or title_cn must be set" },
      { status: 400 },
    );
  }

  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from("event_recordings")
    .insert({
      event_id: eventId,
      storage_path: parsed.data.storage_path,
      title_en: parsed.data.title_en ?? null,
      title_cn: parsed.data.title_cn ?? null,
      description_en: parsed.data.description_en ?? null,
      description_cn: parsed.data.description_cn ?? null,
      mime_type: parsed.data.mime_type,
      byte_size: parsed.data.byte_size ?? null,
      duration_seconds: parsed.data.duration_seconds ?? null,
      created_by: admin.id,
    })
    .select("id")
    .single();
  if (error || !data) {
    return NextResponse.json(
      { error: "insert_failed", detail: error?.message ?? "unknown" },
      { status: 500 },
    );
  }

  await writeAuditLog({
    actor_id: admin.id,
    action: "recording.uploaded",
    entity: "event_recordings",
    entity_id: data.id,
    metadata: {
      event_id: eventId,
      mime_type: parsed.data.mime_type,
      byte_size: parsed.data.byte_size ?? null,
    },
  });

  return NextResponse.json({ ok: true, id: data.id }, { status: 201 });
}

export async function GET(_req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  void admin;
  const { id: eventId } = await params;

  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from("event_recordings")
    .select("id, title_en, title_cn, mime_type, byte_size, duration_seconds, created_at")
    .eq("event_id", eventId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Grant counts.
  const ids = (data ?? []).map((r) => (r as { id: string }).id);
  const grantCounts = new Map<string, number>();
  if (ids.length > 0) {
    const { data: grants } = await service
      .from("event_recording_access")
      .select("recording_id")
      .in("recording_id", ids)
      .is("revoked_at", null);
    for (const g of (grants ?? []) as Array<{ recording_id: string }>) {
      grantCounts.set(g.recording_id, (grantCounts.get(g.recording_id) ?? 0) + 1);
    }
  }

  return NextResponse.json({
    recordings: (data ?? []).map((r) => ({
      ...(r as Record<string, unknown>),
      grants: grantCounts.get((r as { id: string }).id) ?? 0,
    })),
  });
}
