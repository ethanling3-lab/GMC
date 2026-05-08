import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";
import { autoPlaceAndSeat } from "@/lib/floor-plan/auto-place";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Many parallel updates fan out per shape + per seat; give it headroom.
export const maxDuration = 60;

// POST /api/admin/events/[id]/layout/auto-place
//
// Pairs every (un-locked) event_groups row with an event_floor_plan_shapes
// table, then writes shape_id + seat_no on each member of the placed
// groups. Locked groups keep their existing pairing untouched. Tables
// that don't end up paired have their group_id cleared. Members of un-
// placed groups have shape_id + seat_no cleared.
//
// Idempotent — re-running with the same state produces the same result.
// Members can later be swapped manually via the existing groups dnd UI;
// auto-place is the bulk first-pass.

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "regional_lead") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id: eventId } = await params;
  const service = createSupabaseServiceClient();

  // Cushion-mode events get seated by the cushion-rank algorithm; bail
  // here so admins can't accidentally wipe that state.
  const { data: ev } = await service
    .from("events")
    .select("id, seating_mode")
    .eq("id", eventId)
    .maybeSingle<{ id: string; seating_mode: "tables" | "cushions" }>();
  if (!ev) {
    return NextResponse.json({ error: "event_not_found" }, { status: 404 });
  }
  if (ev.seating_mode === "cushions") {
    return NextResponse.json(
      {
        error: "cushion_mode_unsupported",
        detail:
          "Auto-place is for table-mode events only. Cushion mode uses the cushion-rank seating run from the Groups page.",
      },
      { status: 409 },
    );
  }

  const result = await autoPlaceAndSeat(service, eventId);
  if ("error" in result) {
    return NextResponse.json(
      { error: "auto_place_failed", detail: result.error },
      { status: 500 },
    );
  }

  await writeAuditLog({
    actor_id: admin.id,
    action: "seating.auto_placed",
    entity: "events",
    entity_id: eventId,
    after: {
      placements: result.placements.length,
      unplaced: result.unplaced_groups.length,
      unused_tables: result.unused_tables,
      seat_writes: result.seat_writes,
      preserved_locked: result.preserved_locked,
    },
    metadata: { event_id: eventId },
  });

  return NextResponse.json({ ok: true, ...result });
}
