import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// PATCH /api/admin/events/[id]/layout/settings
//
// Per-event floor-plan presentation settings that are NOT part of the shape
// payload: the printable page size and the event-wide seat-name font scale.
//
// Deliberately its own route rather than folding into the super-admin-only
// EventUpdateSchema — these are layout-editor concerns, and regional_lead can
// already edit the plan itself, so they must be able to set its page size too.
// (Same reasoning as the dedicated group-report-template route.)

type RouteCtx = { params: Promise<{ id: string }> };

// Bounds mirror the DB CHECKs in migration 051. Page is in MILLIMETRES.
const Body = z
  .object({
    page_w: z.number().min(50).max(2000).optional(),
    page_h: z.number().min(50).max(2000).optional(),
    // Free-form label for which preset produced w/h ("a3_landscape"), or null
    // for a custom size. Cosmetic — w/h are the source of truth.
    page_preset: z.string().max(40).nullable().optional(),
    name_scale: z.number().min(0.5).max(3).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, {
    message: "no fields to update",
  })
  // Width and height only make sense together — a lone dimension would leave
  // the page at a ratio the caller never asked for.
  .refine((b) => (b.page_w === undefined) === (b.page_h === undefined), {
    message: "page_w and page_h must be sent together",
  });

export async function PATCH(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "regional_lead") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id: eventId } = await params;

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid payload";
    return NextResponse.json(
      { error: "validation_error", detail: msg },
      { status: 400 },
    );
  }

  const service = createSupabaseServiceClient();

  const { data: before, error: beforeErr } = await service
    .from("events")
    .select(
      "id, floor_plan_page_w, floor_plan_page_h, floor_plan_page_preset, floor_plan_name_scale",
    )
    .eq("id", eventId)
    .maybeSingle();
  if (beforeErr) {
    return NextResponse.json({ error: beforeErr.message }, { status: 500 });
  }
  if (!before) {
    return NextResponse.json({ error: "event_not_found" }, { status: 404 });
  }

  const patch: Record<string, number | string | null> = {};
  if (body.page_w !== undefined) patch.floor_plan_page_w = body.page_w;
  if (body.page_h !== undefined) patch.floor_plan_page_h = body.page_h;
  if (body.page_preset !== undefined) {
    patch.floor_plan_page_preset = body.page_preset;
  }
  if (body.name_scale !== undefined) {
    patch.floor_plan_name_scale = body.name_scale;
  }

  const { error } = await service
    .from("events")
    .update(patch)
    .eq("id", eventId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  void writeAuditLog({
    actor_id: admin.id,
    action: "floor_plan.settings_changed",
    entity: "events",
    entity_id: eventId,
    before: {
      page_w: before.floor_plan_page_w,
      page_h: before.floor_plan_page_h,
      page_preset: before.floor_plan_page_preset,
      name_scale: before.floor_plan_name_scale,
    },
    after: patch,
    metadata: { event_id: eventId },
  });

  return NextResponse.json({ ok: true, ...patch });
}
