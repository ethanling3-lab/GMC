import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-guard";
import { regenerateTransferList } from "@/lib/transfer/regenerate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/admin/transfer-lists
// Body: { event_id: uuid, direction: 'arrival' | 'departure', rules?: Partial<GeneratorRules> }
// Query: ?force=1 — rebuild from scratch, discarding manual edits
//
// Generates (or regenerates) the draft transfer list for the given event +
// direction. See lib/transfer/regenerate.ts.
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
      oversize_strategy: z.enum(["split", "bus"]).optional(),
      other_hotel_pickup: z.enum(["own", "main"]).optional(),
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

  const result = await regenerateTransferList({
    eventId: body.event_id,
    direction: body.direction,
    actorId: admin.id,
    rules: body.rules,
    force: new URL(req.url).searchParams.get("force") === "1",
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, detail: result.detail },
      { status: result.status },
    );
  }

  return NextResponse.json({
    ok: true,
    id: result.id,
    direction: body.direction,
    total_pax: result.total_pax,
    total_groups: result.total_groups,
    kept_edited_rows: result.kept_edited_rows,
  });
}
