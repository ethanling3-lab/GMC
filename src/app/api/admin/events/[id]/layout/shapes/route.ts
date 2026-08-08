import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";
import { isTableKind } from "@/components/admin/layout/types";

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
// (existing id, geometry actually changed) / floor_plan.table_numbered
// (table_no changed) / floor_plan.shape_deleted.

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

// Bounds. The page size is per-event since migration 051 (millimetres), and the
// editor lets admins drag shapes one page-width/height beyond every edge as
// scratch space. Rather than loading the event's page just to validate, these
// caps are sized for the LARGEST page any preset offers (A1 portrait, 594×841
// → scratch bounds -594..1782 / -841..2523) plus headroom.
//
// The client already clamps precisely against its own page via clampShape, so
// this layer is a sanity net against absurd values, not the real constraint.
// Deliberately generous: a stricter server bound would reject legitimate
// coordinates on a large page.
const COORD_MIN = -1000;
const COORD_MAX = 3000;
const SIZE_MAX = 2000;

const ShapeSchema = z.object({
  id: z.string().uuid(),
  kind: ShapeKindEnum,
  x_pct: z.number().min(COORD_MIN).max(COORD_MAX),
  y_pct: z.number().min(COORD_MIN).max(COORD_MAX),
  width_pct: z.number().min(0.5).max(SIZE_MAX),
  height_pct: z.number().min(0.5).max(SIZE_MAX),
  rotation_deg: z.number().min(-360).max(360),
  seat_count: z.number().int().min(0).max(64).nullable(),
  seats_per_side: SquareSeatsSchema.nullable(),
  // Required, deliberately NOT .nullish(). Every other field here is required
  // too, and an optional table_no would let a stale cached client bundle
  // silently NULL every table number on its next debounced save. A loud 400
  // in the save badge (admin reloads, gets the current bundle) beats silent
  // data loss.
  table_no: z.number().int().min(1).max(999).nullable(),
  // Per-table seat-name font multiplier. Nullable = inherit the event default,
  // which is a meaningfully different state from an explicit 1.0. Bounds match
  // the DB CHECK in migration 051.
  name_scale: z.number().min(0.5).max(3).nullable(),
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
    table_no: number | null;
    group_id: string | null;
  };

  let existing: Existing[] = [];
  if (upsertIds.length > 0 || deleteIds.length > 0) {
    const ids = [...new Set([...upsertIds, ...deleteIds])];
    const { data, error } = await service
      .from("event_floor_plan_shapes")
      .select(
        "id, event_id, x_pct, y_pct, width_pct, height_pct, rotation_deg, kind, table_no, group_id",
      )
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
      // Never trust the client on which kinds may carry a number, so the DB
      // CHECK (table_no null unless round/square table) can't be tripped.
      table_no: isTableKind(s.kind) ? s.table_no : null,
      name_scale: s.name_scale,
      label_en: s.label_en,
      label_cn: s.label_cn,
      group_id: s.group_id,
      locked: s.locked,
      z_order: s.z_order,
    }));

    // Two-phase write, so values can SWAP between tables in one batch.
    //
    // Two partial unique indexes bite here: (event_id, table_no) from
    // migration 049 and (event_id, group_id) from 050. Unique INDEXES cannot
    // be DEFERRABLE, and a partial constraint can't be expressed as a
    // deferrable table constraint either — so the check fires per-row
    // mid-statement. An upsert that moves T3→T4 while another row moves T4→T3
    // (or hands a group from one table to another) raises 23505 even though
    // the final state is perfectly valid.
    //
    // Same Phase-A/Phase-B pattern auto-place already uses (and documents)
    // for the (shape_id, seat_no) index: release both contended values on
    // exactly the rows we are about to overwrite, then write the authoritative
    // values. The released window is a few ms and covers only those rows; if
    // Phase B fails the editor stays dirty and retries idempotently.
    const needsRelease = rows.some(
      (r) => r.table_no !== null || r.group_id !== null,
    );
    if (needsRelease) {
      const { error: clearErr } = await service
        .from("event_floor_plan_shapes")
        .update({ table_no: null, group_id: null })
        .eq("event_id", eventId)
        .in("id", upsertIds);
      if (clearErr) {
        return NextResponse.json({ error: clearErr.message }, { status: 500 });
      }
    }

    const { error } = await service
      .from("event_floor_plan_shapes")
      .upsert(rows, { onConflict: "id" });
    if (error) {
      // A duplicate that slipped past the editor's own guards — realistically
      // two admins editing the same plan in two tabs. Map to a 409 with a
      // stable code so flushSave's `detail?.error` renders something legible
      // in SaveStateBadge instead of a raw Postgres string.
      if ((error as { code?: string }).code === "23505") {
        const dup = /group/i.test(error.message)
          ? "duplicate_group_pairing"
          : "duplicate_table_no";
        return NextResponse.json(
          { error: dup, detail: error.message },
          { status: 409 },
        );
      }
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

  // Numeric columns come back from PostgREST as strings, so compare loosely
  // rather than by identity — otherwise every save looks like a move.
  const sameNum = (a: number | string, b: number) => Number(a) === b;

  for (const s of body.upserts) {
    const before = existingById.get(s.id);
    if (!before) {
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
          table_no: s.table_no,
        },
        metadata: { event_id: eventId },
      });
      continue;
    }

    // Only audit a move when geometry ACTUALLY changed. Previously every
    // debounced save wrote a shape_moved row — including pure label, lock or
    // group-pairing edits — and Auto-number would multiply that by the table
    // count on a single click.
    const moved =
      !sameNum(before.x_pct, s.x_pct)
      || !sameNum(before.y_pct, s.y_pct)
      || !sameNum(before.width_pct, s.width_pct)
      || !sameNum(before.height_pct, s.height_pct)
      || !sameNum(before.rotation_deg, s.rotation_deg);

    if (moved) {
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

    // Table numbers are the identity every downstream surface displays, so
    // renumbering is worth its own audit action rather than hiding inside a
    // generic update.
    const nextTableNo = isTableKind(s.kind) ? s.table_no : null;
    if (before.table_no !== nextTableNo) {
      void writeAuditLog({
        actor_id: admin.id,
        action: "floor_plan.table_numbered",
        entity: "event_floor_plan_shapes",
        entity_id: s.id,
        before: { table_no: before.table_no },
        after: { table_no: nextTableNo },
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
