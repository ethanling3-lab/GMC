import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/admin/events/[id]/layout/shapes
//
// Bulk upsert + delete for floor-plan shapes. The editor batches edits
// (debounced 400ms after last action) and sends them in one round-trip:
//   { upserts: Shape[], deletes: string[] }
//
// Server enforces:
//   * role gate (super_admin | regional_lead — instructor is read-only)
//   * event_id is set from the route param, never trusted from the body
//   * deletes are scoped to shapes belonging to this event
//
// Audits per shape: floor_plan.shape_added (new id) / floor_plan.shape_moved
// (existing id) / floor_plan.shape_deleted.

type RouteCtx = { params: Promise<{ id: string }> };

const ShapeKindEnum = z.enum([
  "round_table",
  "square_table",
  "cushion",
  "stage",
  "podium",
  "text_label",
  "door",
  "wall",
]);

const SquareSeatsSchema = z.object({
  top: z.number().int().min(0).max(8),
  right: z.number().int().min(0).max(8),
  bottom: z.number().int().min(0).max(8),
  head: z.number().int().min(0).max(8),
});

// Bounds: the printable page is 300×180, but the editor (Miro-style) lets
// admins drag shapes one page-width/height beyond on every side as scratch.
// Hard caps below match `clampShape` in types.ts (-300..600, -180..360).
// If the viewBox is bumped, update both ends of the contract.
const ShapeSchema = z.object({
  id: z.string().uuid(),
  kind: ShapeKindEnum,
  x_pct: z.number().min(-300).max(600),
  y_pct: z.number().min(-180).max(360),
  width_pct: z.number().min(0.5).max(300),
  height_pct: z.number().min(0.5).max(180),
  rotation_deg: z.number().min(-360).max(360),
  seat_count: z.number().int().min(0).max(64).nullable(),
  seats_per_side: SquareSeatsSchema.nullable(),
  label_en: z.string().max(200).nullable(),
  label_cn: z.string().max(200).nullable(),
  group_id: z.string().uuid().nullable(),
  locked: z.boolean(),
  z_order: z.number().int().min(-1024).max(1024),
});

const Body = z.object({
  upserts: z.array(ShapeSchema).max(256),
  deletes: z.array(z.string().uuid()).max(256),
});

export async function POST(req: Request, { params }: RouteCtx) {
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

  if (body.upserts.length === 0 && body.deletes.length === 0) {
    return NextResponse.json({ ok: true, unchanged: true });
  }

  const service = createSupabaseServiceClient();

  // Confirm the event exists (avoid orphan rows if route param is wrong).
  const { data: ev, error: evErr } = await service
    .from("events")
    .select("id")
    .eq("id", eventId)
    .maybeSingle();
  if (evErr) return NextResponse.json({ error: evErr.message }, { status: 500 });
  if (!ev) return NextResponse.json({ error: "event_not_found" }, { status: 404 });

  // ---------------------------------------------------------------------------
  // Pre-fetch existing rows for upsert ids — we need to distinguish "added"
  // from "moved" for the audit trail, and verify event scoping for deletes.
  // ---------------------------------------------------------------------------

  const upsertIds = body.upserts.map((s) => s.id);
  const deleteIds = body.deletes;

  type Existing = {
    id: string;
    event_id: string;
    x_pct: number | string;
    y_pct: number | string;
    width_pct: number | string;
    height_pct: number | string;
    rotation_deg: number | string;
    kind: string;
  };

  let existing: Existing[] = [];
  if (upsertIds.length > 0 || deleteIds.length > 0) {
    const ids = [...new Set([...upsertIds, ...deleteIds])];
    const { data, error } = await service
      .from("event_floor_plan_shapes")
      .select("id, event_id, x_pct, y_pct, width_pct, height_pct, rotation_deg, kind")
      .in("id", ids);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    existing = (data ?? []) as Existing[];
  }

  const existingById = new Map(existing.map((e) => [e.id, e]));

  // Refuse upserts/deletes that target shapes from a different event.
  for (const s of body.upserts) {
    const e = existingById.get(s.id);
    if (e && e.event_id !== eventId) {
      return NextResponse.json(
        { error: "cross_event_shape", detail: `shape ${s.id} belongs to a different event` },
        { status: 400 },
      );
    }
  }
  const validDeleteIds = deleteIds.filter((id) => {
    const e = existingById.get(id);
    return !e || e.event_id === eventId;
  });

  // ---------------------------------------------------------------------------
  // Upsert.
  // ---------------------------------------------------------------------------

  if (body.upserts.length > 0) {
    const rows = body.upserts.map((s) => ({
      id: s.id,
      event_id: eventId,
      kind: s.kind,
      x_pct: s.x_pct,
      y_pct: s.y_pct,
      width_pct: s.width_pct,
      height_pct: s.height_pct,
      rotation_deg: s.rotation_deg,
      seat_count: s.seat_count,
      seats_per_side: s.seats_per_side,
      label_en: s.label_en,
      label_cn: s.label_cn,
      group_id: s.group_id,
      locked: s.locked,
      z_order: s.z_order,
    }));
    const { error } = await service
      .from("event_floor_plan_shapes")
      .upsert(rows, { onConflict: "id" });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // ---------------------------------------------------------------------------
  // Delete.
  // ---------------------------------------------------------------------------

  if (validDeleteIds.length > 0) {
    const { error } = await service
      .from("event_floor_plan_shapes")
      .delete()
      .in("id", validDeleteIds)
      .eq("event_id", eventId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // ---------------------------------------------------------------------------
  // Audit (best-effort, non-blocking).
  // ---------------------------------------------------------------------------

  for (const s of body.upserts) {
    const wasExisting = existingById.has(s.id);
    if (!wasExisting) {
      void writeAuditLog({
        actor_id: admin.id,
        action: "floor_plan.shape_added",
        entity: "event_floor_plan_shapes",
        entity_id: s.id,
        after: {
          kind: s.kind,
          x_pct: s.x_pct,
          y_pct: s.y_pct,
          width_pct: s.width_pct,
          height_pct: s.height_pct,
          rotation_deg: s.rotation_deg,
        },
        metadata: { event_id: eventId },
      });
    } else {
      const before = existingById.get(s.id)!;
      void writeAuditLog({
        actor_id: admin.id,
        action: "floor_plan.shape_moved",
        entity: "event_floor_plan_shapes",
        entity_id: s.id,
        before: {
          x_pct: before.x_pct,
          y_pct: before.y_pct,
          width_pct: before.width_pct,
          height_pct: before.height_pct,
          rotation_deg: before.rotation_deg,
        },
        after: {
          x_pct: s.x_pct,
          y_pct: s.y_pct,
          width_pct: s.width_pct,
          height_pct: s.height_pct,
          rotation_deg: s.rotation_deg,
        },
        metadata: { event_id: eventId },
      });
    }
  }

  for (const id of validDeleteIds) {
    const before = existingById.get(id);
    void writeAuditLog({
      actor_id: admin.id,
      action: "floor_plan.shape_deleted",
      entity: "event_floor_plan_shapes",
      entity_id: id,
      before: before
        ? {
            kind: before.kind,
            x_pct: before.x_pct,
            y_pct: before.y_pct,
          }
        : null,
      metadata: { event_id: eventId },
    });
  }

  return NextResponse.json({
    ok: true,
    upserted: body.upserts.length,
    deleted: validDeleteIds.length,
  });
}
