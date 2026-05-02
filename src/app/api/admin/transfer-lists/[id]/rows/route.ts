import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/admin/transfer-lists/[id]/rows
//
// Inserts a fully manual row into a transfer list. Manual rows aren't tied
// to any flight_info — they exist for special arrangements (external
// pickups, driver placeholders, vendor cars). Manual rows are always
// `admin_edited = true` so regenerate refuses to wipe them without ?force=1.
//
// Role gate matches transfer_lists RLS write policy: super_admin or
// regional_lead.

type RouteCtx = { params: Promise<{ id: string }> };

const ManualPassenger = z.object({
  name: z.string().trim().min(1).max(128),
  region_id: z.string().trim().max(16).nullable().optional(),
  note: z.string().trim().max(256).nullable().optional(),
});

const Body = z.object({
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
  remark: z.string().trim().max(512).nullable().optional(),
  vip: z.boolean().optional(),
  manual_passengers: z.array(ManualPassenger).min(1).max(50),
});

export async function POST(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "regional_lead") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id: listId } = await params;

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

  // Validate the parent list exists; abort if final (admin must revert to
  // draft before adding rows — same protection as regenerate).
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
        detail: "Revert to draft before adding rows.",
      },
      { status: 409 },
    );
  }

  // Append at the bottom: group_no = max(existing) + 1.
  const { data: maxRow } = await service
    .from("transfer_list_rows")
    .select("group_no")
    .eq("transfer_list_id", listId)
    .order("group_no", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextGroupNo = (maxRow?.group_no ?? 0) + 1;

  const insertPayload = {
    transfer_list_id: listId,
    group_no: nextGroupNo,
    vehicle_type: body.vehicle_type,
    landing_or_takeoff_at: body.landing_or_takeoff_at,
    terminal:
      body.terminal === undefined || body.terminal === ""
        ? null
        : body.terminal,
    destination: body.destination,
    remark: body.remark === "" ? null : body.remark ?? null,
    vip: body.vip ?? false,
    flight_info_ids: [] as string[],
    manual_passengers: body.manual_passengers,
    admin_edited: true,
  };

  const { data: inserted, error: insErr } = await service
    .from("transfer_list_rows")
    .insert(insertPayload)
    .select(
      "id, group_no, vehicle_type, landing_or_takeoff_at, terminal, destination, remark, vip, manual_passengers",
    )
    .single();
  if (insErr || !inserted) {
    return NextResponse.json(
      { error: insErr?.message ?? "insert_failed" },
      { status: 500 },
    );
  }

  await writeAuditLog({
    actor_id: admin.id,
    action: "transfer_list.row_added_manual",
    entity: "transfer_list_rows",
    entity_id: inserted.id,
    after: {
      group_no: inserted.group_no,
      vehicle_type: inserted.vehicle_type,
      destination: inserted.destination,
      passenger_count: body.manual_passengers.length,
    },
    metadata: {
      transfer_list_id: listId,
      direction: list.direction,
    },
  });

  return NextResponse.json({ ok: true, row: inserted });
}
