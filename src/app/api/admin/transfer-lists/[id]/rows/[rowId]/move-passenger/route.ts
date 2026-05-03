import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/admin/transfer-lists/[id]/rows/[rowId]/move-passenger
//
// Moves a single passenger out of one row in a transfer list and into a
// different row in the SAME list (same direction by construction). The
// passenger can be either a real flight (entry in flight_info_ids) or a
// manual passenger (entry in manual_passengers JSONB).
//
// Target is either:
//   - { kind: "existing", row_id }: appends to that row
//   - { kind: "new_manual", ... }: creates a new manual row at max(group_no)+1
//
// Both source + target are stamped admin_edited = true so subsequent
// regenerate refuses to silently overwrite (matches row-edit / manual-add
// semantics). The optional remark is appended to the target row's remark
// column with a `· ` separator so the move's reason stays visible in the
// table; full payload also lands in the audit log metadata.
//
// Role gate matches transfer_lists RLS write policy: super_admin or
// regional_lead.

type RouteCtx = { params: Promise<{ id: string; rowId: string }> };

const Body = z.object({
  from: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("real"),
      flight_info_id: z.string().uuid(),
    }),
    z.object({
      kind: z.literal("manual"),
      manual_index: z.number().int().min(0).max(63),
    }),
  ]),
  target: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("existing"),
      row_id: z.string().uuid(),
    }),
    z.object({
      kind: z.literal("new_manual"),
      vehicle_type: z.string().trim().min(1).max(128),
      landing_or_takeoff_at: z
        .string()
        .trim()
        .refine(
          (v) => !Number.isNaN(new Date(v).getTime()),
          "landing_or_takeoff_at must be a valid ISO timestamp",
        ),
      terminal: z.string().trim().max(32).nullable().optional(),
      destination: z.string().trim().min(1).max(256),
      vip: z.boolean().optional(),
    }),
  ]),
  remark: z.string().trim().max(512).optional(),
});

type ManualPax = {
  name: string;
  region_id?: string | null;
  note?: string | null;
};

export async function POST(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "regional_lead") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id: listId, rowId: sourceRowId } = await params;

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

  // Refuse on finalized lists — same protection as row-add and regenerate.
  const { data: list, error: listErr } = await service
    .from("transfer_lists")
    .select("id, status, direction")
    .eq("id", listId)
    .maybeSingle();
  if (listErr) {
    return NextResponse.json({ error: listErr.message }, { status: 500 });
  }
  if (!list) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (list.status === "final") {
    return NextResponse.json(
      {
        error: "list_finalized",
        detail: "Revert to draft before moving passengers.",
      },
      { status: 409 },
    );
  }

  // Load source row.
  const { data: sourceRow, error: srcErr } = await service
    .from("transfer_list_rows")
    .select(
      "id, transfer_list_id, group_no, vehicle_type, landing_or_takeoff_at, terminal, destination, remark, vip, flight_info_ids, manual_passengers",
    )
    .eq("id", sourceRowId)
    .maybeSingle<{
      id: string;
      transfer_list_id: string;
      group_no: number;
      vehicle_type: string | null;
      landing_or_takeoff_at: string | null;
      terminal: string | null;
      destination: string | null;
      remark: string | null;
      vip: boolean;
      flight_info_ids: string[] | null;
      manual_passengers: ManualPax[] | null;
    }>();
  if (srcErr) {
    return NextResponse.json({ error: srcErr.message }, { status: 500 });
  }
  if (!sourceRow) {
    return NextResponse.json({ error: "source_not_found" }, { status: 404 });
  }
  if (sourceRow.transfer_list_id !== listId) {
    return NextResponse.json(
      { error: "row_belongs_to_other_list" },
      { status: 400 },
    );
  }

  const sourceFlights = sourceRow.flight_info_ids ?? [];
  const sourceManual = sourceRow.manual_passengers ?? [];

  // Validate the moved passenger exists on the source.
  let movedFlightId: string | null = null;
  let movedManual: ManualPax | null = null;
  let nextSourceFlights = sourceFlights;
  let nextSourceManual = sourceManual;
  if (body.from.kind === "real") {
    if (!sourceFlights.includes(body.from.flight_info_id)) {
      return NextResponse.json(
        { error: "flight_not_on_source_row" },
        { status: 400 },
      );
    }
    movedFlightId = body.from.flight_info_id;
    nextSourceFlights = sourceFlights.filter((id) => id !== movedFlightId);
  } else {
    const idx = body.from.manual_index;
    if (idx >= sourceManual.length) {
      return NextResponse.json(
        { error: "manual_index_out_of_range" },
        { status: 400 },
      );
    }
    movedManual = sourceManual[idx];
    nextSourceManual = sourceManual.filter((_, i) => i !== idx);
  }

  // Resolve / create target row.
  let targetRowId: string;
  let targetBefore: {
    id: string;
    group_no: number;
    flight_info_ids: string[];
    manual_passengers: ManualPax[];
    remark: string | null;
  } | null = null;
  let createdTargetGroupNo: number | null = null;

  if (body.target.kind === "existing") {
    if (body.target.row_id === sourceRowId) {
      return NextResponse.json(
        { error: "target_equals_source" },
        { status: 400 },
      );
    }
    const { data: t, error: tErr } = await service
      .from("transfer_list_rows")
      .select(
        "id, transfer_list_id, group_no, flight_info_ids, manual_passengers, remark",
      )
      .eq("id", body.target.row_id)
      .maybeSingle<{
        id: string;
        transfer_list_id: string;
        group_no: number;
        flight_info_ids: string[] | null;
        manual_passengers: ManualPax[] | null;
        remark: string | null;
      }>();
    if (tErr) {
      return NextResponse.json({ error: tErr.message }, { status: 500 });
    }
    if (!t) {
      return NextResponse.json({ error: "target_not_found" }, { status: 404 });
    }
    if (t.transfer_list_id !== listId) {
      return NextResponse.json(
        { error: "target_belongs_to_other_list" },
        { status: 400 },
      );
    }
    targetRowId = t.id;
    targetBefore = {
      id: t.id,
      group_no: t.group_no,
      flight_info_ids: t.flight_info_ids ?? [],
      manual_passengers: t.manual_passengers ?? [],
      remark: t.remark,
    };
  } else {
    // Create the new manual row at max(group_no)+1.
    const { data: maxRow } = await service
      .from("transfer_list_rows")
      .select("group_no")
      .eq("transfer_list_id", listId)
      .order("group_no", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextGroupNo = (maxRow?.group_no ?? 0) + 1;
    createdTargetGroupNo = nextGroupNo;

    const initialFlightIds: string[] = movedFlightId ? [movedFlightId] : [];
    const initialManual: ManualPax[] = movedManual
      ? [
          {
            name: movedManual.name,
            ...(movedManual.region_id ? { region_id: movedManual.region_id } : {}),
            ...(movedManual.note ? { note: movedManual.note } : {}),
          },
        ]
      : [];

    const newRowPayload = {
      transfer_list_id: listId,
      group_no: nextGroupNo,
      vehicle_type: body.target.vehicle_type,
      landing_or_takeoff_at: body.target.landing_or_takeoff_at,
      terminal:
        body.target.terminal === undefined || body.target.terminal === ""
          ? null
          : body.target.terminal,
      destination: body.target.destination,
      remark: body.remark && body.remark.length > 0 ? body.remark : null,
      vip: body.target.vip ?? false,
      flight_info_ids: initialFlightIds,
      manual_passengers: initialManual,
      admin_edited: true,
    };

    const { data: created, error: createErr } = await service
      .from("transfer_list_rows")
      .insert(newRowPayload)
      .select("id")
      .single();
    if (createErr || !created) {
      return NextResponse.json(
        { error: createErr?.message ?? "create_failed" },
        { status: 500 },
      );
    }
    targetRowId = created.id;
  }

  // Update source row (drop the moved passenger). admin_edited=true.
  const sourceUpdate: Record<string, unknown> = {
    flight_info_ids: nextSourceFlights,
    manual_passengers: nextSourceManual,
    admin_edited: true,
  };
  const { error: srcUpdErr } = await service
    .from("transfer_list_rows")
    .update(sourceUpdate)
    .eq("id", sourceRowId);
  if (srcUpdErr) {
    return NextResponse.json({ error: srcUpdErr.message }, { status: 500 });
  }

  // Update target row when it pre-existed. (For the new_manual path the
  // moved passenger was already in the insert payload.)
  if (body.target.kind === "existing" && targetBefore) {
    const nextTargetFlights = movedFlightId
      ? [...targetBefore.flight_info_ids, movedFlightId]
      : targetBefore.flight_info_ids;
    const nextTargetManual = movedManual
      ? [
          ...targetBefore.manual_passengers,
          {
            name: movedManual.name,
            ...(movedManual.region_id ? { region_id: movedManual.region_id } : {}),
            ...(movedManual.note ? { note: movedManual.note } : {}),
          },
        ]
      : targetBefore.manual_passengers;
    const nextTargetRemark =
      body.remark && body.remark.length > 0
        ? targetBefore.remark
          ? `${targetBefore.remark} · ${body.remark}`
          : body.remark
        : targetBefore.remark;

    const { error: tgtUpdErr } = await service
      .from("transfer_list_rows")
      .update({
        flight_info_ids: nextTargetFlights,
        manual_passengers: nextTargetManual,
        remark: nextTargetRemark,
        admin_edited: true,
      })
      .eq("id", targetRowId);
    if (tgtUpdErr) {
      return NextResponse.json({ error: tgtUpdErr.message }, { status: 500 });
    }
  }

  await writeAuditLog({
    actor_id: admin.id,
    action: "transfer_list.passenger_moved",
    entity: "transfer_list_rows",
    entity_id: sourceRowId,
    before: {
      source_row: {
        id: sourceRowId,
        group_no: sourceRow.group_no,
        flight_info_ids: sourceFlights,
        manual_passengers: sourceManual,
      },
      target_row: targetBefore
        ? {
            id: targetBefore.id,
            group_no: targetBefore.group_no,
            flight_info_ids: targetBefore.flight_info_ids,
            manual_passengers: targetBefore.manual_passengers,
          }
        : null,
    },
    after: {
      source_row: {
        id: sourceRowId,
        flight_info_ids: nextSourceFlights,
        manual_passengers: nextSourceManual,
      },
      target_row: {
        id: targetRowId,
        created: body.target.kind === "new_manual",
        ...(createdTargetGroupNo !== null
          ? { group_no: createdTargetGroupNo }
          : {}),
      },
    },
    metadata: {
      transfer_list_id: listId,
      direction: list.direction,
      moved: movedFlightId
        ? { kind: "real", flight_info_id: movedFlightId }
        : { kind: "manual", passenger: movedManual },
      remark: body.remark ?? null,
    },
  });

  return NextResponse.json({
    ok: true,
    target_row_id: targetRowId,
    created: body.target.kind === "new_manual",
  });
}
