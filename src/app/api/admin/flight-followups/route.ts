import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";
import { createSupabaseServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// PATCH /api/admin/flight-followups
// Customer service and leads record a contact attempt, or mark that someone
// doesn't need a transfer in one direction.

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("contacted"),
    enrollment_id: z.string().uuid(),
    note: z.string().trim().max(300).optional(),
  }),
  z.object({
    action: z.literal("not_needed"),
    enrollment_id: z.string().uuid(),
    direction: z.enum(["arrival", "departure"]),
    value: z.boolean(),
  }),
]);

export async function PATCH(req: Request) {
  const admin = await requireAdmin();
  if (!["super_admin", "regional_lead", "customer_service"].includes(admin.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_error" }, { status: 400 });
  }
  const body = parsed.data;

  const service = createSupabaseServiceClient();
  const { data: enrollment } = await service
    .from("enrollments")
    .select("id, participant:participants!inner(region, assigned_cs_id)")
    .eq("id", body.enrollment_id)
    .maybeSingle<{ id: string; participant: { region: string | null; assigned_cs_id: string | null } | null }>();
  if (!enrollment) {
    return NextResponse.json({ error: "enrollment_not_found" }, { status: 404 });
  }
  if (admin.role === "regional_lead" && enrollment.participant?.region !== admin.region) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  // CS only follow up their own customers (Phase 3, 2026-11-26).
  if (admin.role === "customer_service" && enrollment.participant?.assigned_cs_id !== admin.id) {
    return NextResponse.json({ error: "forbidden", detail: "This person isn't one of your customers." }, { status: 403 });
  }

  const now = new Date().toISOString();
  let changes: Record<string, unknown>;
  if (body.action === "contacted") {
    changes = {
      contacted_at: now,
      contacted_by: admin.id,
      contact_note: body.note || null,
    };
  } else {
    if (body.value) {
      const { data: flight } = await service
        .from("flight_info")
        .select("id")
        .eq("enrollment_id", body.enrollment_id)
        .eq("direction", body.direction)
        .maybeSingle();
      if (flight) {
        return NextResponse.json(
          {
            error: "flight_exists",
            detail: "This person has a flight saved. Remove it first.",
          },
          { status: 409 },
        );
      }
    }
    changes = { [`${body.direction}_not_needed`]: body.value };
  }

  const { error } = await service
    .from("flight_followups")
    .upsert(
      { enrollment_id: body.enrollment_id, ...changes, updated_at: now },
      { onConflict: "enrollment_id" },
    );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await writeAuditLog({
    actor_id: admin.id,
    action: "transfer.flight_followup",
    entity: "enrollment",
    entity_id: body.enrollment_id,
    metadata:
      body.action === "contacted"
        ? { action: body.action }
        : { action: body.action, direction: body.direction, value: body.value },
  });

  return NextResponse.json({ ok: true });
}
