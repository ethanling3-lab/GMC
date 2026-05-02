import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";
import { loadGeneratorInputs } from "@/lib/transfer/load";
import { generateTransferList } from "@/lib/transfer/generate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/admin/transfer-lists
// Body: { event_id: uuid, direction: 'arrival' | 'departure', rules?: Partial<GeneratorRules> }
// Query: ?force=1 — regenerate even if some prior draft rows have admin_edited=true
//
// Generates (or regenerates) the draft transfer list for the given event +
// direction. Re-running replaces the prior draft for the same pair — drafts
// are disposable, EXCEPT rows that admins manually edited (admin_edited=true)
// require ?force=1 to wipe. A finalized list is always protected; admin
// must revert to draft first.
//
// Role gate matches transfer_lists RLS write policy (migration 014):
// super_admin or regional_lead.

const Body = z.object({
  event_id: z.string().uuid(),
  direction: z.enum(["arrival", "departure"]),
  rules: z
    .object({
      consolidation_window_minutes: z.number().int().positive().optional(),
      departure_lead_hours: z.number().nonnegative().optional(),
      coach_cutoff_hour_local: z.number().int().min(0).max(23).optional(),
      coach_hotel_departure_local: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
      coach_rule_enabled: z.boolean().optional(),
    })
    .optional(),
});

export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "regional_lead") {
    return NextResponse.json(
      { error: "forbidden", detail: "Only super/regional admins can generate transfer lists" },
      { status: 403 },
    );
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid payload";
    return NextResponse.json({ error: "validation_error", detail: msg }, { status: 400 });
  }

  const force = new URL(req.url).searchParams.get("force") === "1";

  const inputs = await loadGeneratorInputs(body.event_id, body.direction);
  if ("error" in inputs) {
    if (inputs.error === "event_not_found") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (inputs.error === "missing_main_venue_hotel_name") {
      return NextResponse.json(
        {
          error: "missing_main_venue_hotel_name",
          detail:
            "Set the event's main venue hotel name before generating a transfer list.",
        },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: inputs.error }, { status: 500 });
  }

  if (inputs.flights.length === 0) {
    return NextResponse.json(
      {
        error: "no_flights",
        detail: `No confirmed ${body.direction} flights for this event yet.`,
      },
      { status: 400 },
    );
  }

  const result = generateTransferList({
    direction: body.direction,
    flights: inputs.flights,
    context: inputs.context,
    rules: body.rules,
  });

  const service = createSupabaseServiceClient();

  // Replace prior non-final list for the same (event, direction). Final
  // lists are protected — caller must PATCH back to draft first.
  const { data: existing, error: existErr } = await service
    .from("transfer_lists")
    .select("id, status")
    .eq("event_id", body.event_id)
    .eq("direction", body.direction);
  if (existErr) {
    return NextResponse.json({ error: existErr.message }, { status: 500 });
  }
  const drafts = (existing ?? []).filter((r) => r.status !== "final");
  const finalized = (existing ?? []).find((r) => r.status === "final");
  if (finalized) {
    return NextResponse.json(
      {
        error: "already_finalized",
        detail:
          "This direction has a finalized list. Revert to draft before regenerating.",
        list_id: finalized.id,
      },
      { status: 409 },
    );
  }
  let editedCount = 0;
  if (drafts.length > 0) {
    const draftIds = drafts.map((d) => d.id);
    const { count } = await service
      .from("transfer_list_rows")
      .select("id", { count: "exact", head: true })
      .in("transfer_list_id", draftIds)
      .eq("admin_edited", true);
    editedCount = count ?? 0;

    if (editedCount > 0 && !force) {
      return NextResponse.json(
        {
          error: "edited_rows_present",
          detail: `Prior draft has ${editedCount} admin-edited row${editedCount === 1 ? "" : "s"}. Re-run with ?force=1 to wipe.`,
          edited_count: editedCount,
        },
        { status: 409 },
      );
    }

    const { error: delErr } = await service
      .from("transfer_lists")
      .delete()
      .in("id", draftIds);
    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }
  }

  const { data: inserted, error: insErr } = await service
    .from("transfer_lists")
    .insert({
      event_id: body.event_id,
      direction: body.direction,
      status: "draft",
      generated_by: admin.id,
      rules_snapshot: result.rules_snapshot,
    })
    .select("id")
    .single();
  if (insErr || !inserted) {
    return NextResponse.json(
      { error: insErr?.message ?? "insert_failed" },
      { status: 500 },
    );
  }

  if (result.groups.length > 0) {
    const { error: rowsErr } = await service.from("transfer_list_rows").insert(
      result.groups.map((g) => ({
        transfer_list_id: inserted.id,
        group_no: g.group_no,
        vehicle_type: g.vehicle_type,
        landing_or_takeoff_at: g.landing_or_takeoff_at,
        terminal: g.terminal,
        destination: g.destination,
        remark: g.remark,
        vip: g.vip,
        flight_info_ids: g.flight_info_ids,
      })),
    );
    if (rowsErr) {
      return NextResponse.json({ error: rowsErr.message }, { status: 500 });
    }
  }

  await writeAuditLog({
    actor_id: admin.id,
    action:
      force && editedCount > 0
        ? "transfer_list.regenerated_force"
        : "transfer_list.generated",
    entity: "transfer_lists",
    entity_id: inserted.id,
    metadata: {
      event_id: body.event_id,
      direction: body.direction,
      total_pax: result.total_pax,
      total_groups: result.total_groups,
      forced_over_edits: force && editedCount > 0 ? editedCount : undefined,
    },
  });

  return NextResponse.json({
    ok: true,
    id: inserted.id,
    direction: body.direction,
    total_pax: result.total_pax,
    total_groups: result.total_groups,
  });
}
