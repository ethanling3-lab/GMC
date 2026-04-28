import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET    — fetch list + rows (joined flight_info hydrated for UI)
// PATCH  — update status (draft ↔ final)
// DELETE — drop list (cascades rows)
//
// Read role gate matches RLS: super, regional_lead, instructor.
// Write role gate: super, regional_lead.

type RouteCtx = { params: Promise<{ id: string }> };

const PatchBody = z.object({
  status: z.enum(["draft", "final"]),
});

export async function GET(_req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (
    admin.role !== "super_admin" &&
    admin.role !== "regional_lead" &&
    admin.role !== "instructor"
  ) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const service = createSupabaseServiceClient();

  const { data: list, error: listErr } = await service
    .from("transfer_lists")
    .select(
      "id, event_id, direction, status, generated_at, rules_snapshot, generated_by",
    )
    .eq("id", id)
    .maybeSingle();
  if (listErr) {
    return NextResponse.json({ error: listErr.message }, { status: 500 });
  }
  if (!list) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { data: rows, error: rowsErr } = await service
    .from("transfer_list_rows")
    .select(
      "id, group_no, vehicle_type, landing_or_takeoff_at, terminal, destination, remark, vip, flight_info_ids",
    )
    .eq("transfer_list_id", id)
    .order("group_no", { ascending: true });
  if (rowsErr) {
    return NextResponse.json({ error: rowsErr.message }, { status: 500 });
  }

  // Hydrate flight_info + participant for each referenced flight id so the
  // table can render names / region_id / flight number. One query for the
  // whole list keeps it cheap.
  const allIds = Array.from(
    new Set((rows ?? []).flatMap((r) => r.flight_info_ids ?? [])),
  );
  let flights: Array<{
    id: string;
    flight_number: string | null;
    airline: string | null;
    origin_airport: string | null;
    destination_airport: string | null;
    scheduled_at: string;
    terminal: string | null;
    hotel_key: string | null;
    is_vip: boolean;
    enrollment: {
      participant: {
        id: string;
        region_id: string | null;
        name_cn: string | null;
        name_en: string | null;
        region: string | null;
      } | null;
    } | null;
  }> = [];
  if (allIds.length > 0) {
    const { data, error: fErr } = await service
      .from("flight_info")
      .select(
        "id, flight_number, airline, origin_airport, destination_airport, scheduled_at, terminal, hotel_key, is_vip, enrollment:enrollments!inner(participant:participants!inner(id, region_id, name_cn, name_en, region))",
      )
      .in("id", allIds)
      .returns<typeof flights>();
    if (fErr) {
      return NextResponse.json({ error: fErr.message }, { status: 500 });
    }
    flights = data ?? [];
  }

  return NextResponse.json({ list, rows: rows ?? [], flights });
}

export async function PATCH(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "regional_lead") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;

  let body: z.infer<typeof PatchBody>;
  try {
    body = PatchBody.parse(await req.json());
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid payload";
    return NextResponse.json({ error: "validation_error", detail: msg }, { status: 400 });
  }

  const service = createSupabaseServiceClient();
  const { data: before, error: loadErr } = await service
    .from("transfer_lists")
    .select("id, status")
    .eq("id", id)
    .maybeSingle();
  if (loadErr) {
    return NextResponse.json({ error: loadErr.message }, { status: 500 });
  }
  if (!before) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (before.status === body.status) {
    return NextResponse.json({ ok: true, unchanged: true, status: body.status });
  }

  const { error: updErr } = await service
    .from("transfer_lists")
    .update({ status: body.status })
    .eq("id", id);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  await writeAuditLog({
    actor_id: admin.id,
    action: body.status === "final" ? "transfer_list.finalized" : "transfer_list.generated",
    entity: "transfer_lists",
    entity_id: id,
    before: { status: before.status },
    after: { status: body.status },
  });

  return NextResponse.json({ ok: true, status: body.status });
}

export async function DELETE(_req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "regional_lead") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const service = createSupabaseServiceClient();

  const { data: before, error: loadErr } = await service
    .from("transfer_lists")
    .select("id, event_id, direction, status")
    .eq("id", id)
    .maybeSingle();
  if (loadErr) {
    return NextResponse.json({ error: loadErr.message }, { status: 500 });
  }
  if (!before) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { error: delErr } = await service
    .from("transfer_lists")
    .delete()
    .eq("id", id);
  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  await writeAuditLog({
    actor_id: admin.id,
    action: "transfer_list.deleted",
    entity: "transfer_lists",
    entity_id: id,
    before,
    after: null,
  });

  return NextResponse.json({ ok: true });
}
