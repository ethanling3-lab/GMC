import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// PATCH /api/admin/transfer-lists/[id]/rows/[rowId]
//
// Per-row admin override on a generated transfer-list row. Marks the row
// `admin_edited = true` so the regenerate route can refuse to silently
// overwrite manual tweaks (regenerate then becomes ?force=1 only).
//
// Role gate matches transfer_lists RLS write policy: super_admin or
// regional_lead.

type RouteCtx = { params: Promise<{ id: string; rowId: string }> };

const ManualPassenger = z.object({
  name: z.string().trim().min(1).max(128),
  region_id: z.string().trim().max(16).nullable().optional(),
  note: z.string().trim().max(256).nullable().optional(),
});

const Body = z
  .object({
    vehicle_type: z.string().trim().min(1).max(64).optional(),
    landing_or_takeoff_at: z
      .string()
      .trim()
      .refine(
        (v) => !Number.isNaN(new Date(v).getTime()),
        "landing_or_takeoff_at must be a valid ISO timestamp",
      )
      .optional(),
    terminal: z.string().trim().max(16).nullable().optional(),
    destination: z.string().trim().max(256).optional(),
    remark: z.string().trim().max(512).nullable().optional(),
    vip: z.boolean().optional(),
    manual_passengers: z.array(ManualPassenger).max(64).optional(),
  })
  .refine(
    (v) => Object.keys(v).length > 0,
    "Provide at least one field to update",
  );

export async function PATCH(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "regional_lead") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id: listId, rowId } = await params;

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

  const { data: existing, error: loadErr } = await service
    .from("transfer_list_rows")
    .select(
      "id, transfer_list_id, vehicle_type, landing_or_takeoff_at, terminal, destination, remark, vip, admin_edited, manual_passengers",
    )
    .eq("id", rowId)
    .maybeSingle();
  if (loadErr) {
    return NextResponse.json({ error: loadErr.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (existing.transfer_list_id !== listId) {
    return NextResponse.json(
      { error: "row_belongs_to_other_list" },
      { status: 400 },
    );
  }

  const update: Record<string, unknown> = { admin_edited: true };
  if ("vehicle_type" in body) update.vehicle_type = body.vehicle_type;
  if ("landing_or_takeoff_at" in body) update.landing_or_takeoff_at = body.landing_or_takeoff_at;
  if ("terminal" in body) update.terminal = body.terminal;
  if ("destination" in body) update.destination = body.destination;
  if ("remark" in body) update.remark = body.remark;
  if ("vip" in body) update.vip = body.vip;
  if ("manual_passengers" in body) {
    update.manual_passengers = body.manual_passengers?.map((p) => ({
      name: p.name,
      ...(p.region_id ? { region_id: p.region_id } : {}),
      ...(p.note ? { note: p.note } : {}),
    }));
  }

  const { data: updated, error: updErr } = await service
    .from("transfer_list_rows")
    .update(update)
    .eq("id", rowId)
    .select(
      "id, vehicle_type, landing_or_takeoff_at, terminal, destination, remark, vip, admin_edited, manual_passengers",
    )
    .single();
  if (updErr || !updated) {
    return NextResponse.json(
      { error: updErr?.message ?? "update_failed" },
      { status: 500 },
    );
  }

  await writeAuditLog({
    actor_id: admin.id,
    action: "transfer_list.row_edited",
    entity: "transfer_list_rows",
    entity_id: rowId,
    before: {
      vehicle_type: existing.vehicle_type,
      landing_or_takeoff_at: existing.landing_or_takeoff_at,
      terminal: existing.terminal,
      destination: existing.destination,
      remark: existing.remark,
      vip: existing.vip,
      manual_passengers: existing.manual_passengers,
    },
    after: {
      vehicle_type: updated.vehicle_type,
      landing_or_takeoff_at: updated.landing_or_takeoff_at,
      terminal: updated.terminal,
      destination: updated.destination,
      remark: updated.remark,
      vip: updated.vip,
      manual_passengers: updated.manual_passengers,
    },
    metadata: { transfer_list_id: listId },
  });

  return NextResponse.json({ ok: true, row: updated });
}
