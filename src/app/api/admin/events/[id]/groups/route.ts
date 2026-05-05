import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/admin/events/[id]/groups
//
// Pass 2 — manually create a fresh empty group on the event. Lands at
// max(group_no) + 1. Admin then drags members in and curates leaders.
// Created groups default to locked=false so a Regenerate run that
// happens to bump them out is non-fatal — admin can re-add them.

type RouteCtx = { params: Promise<{ id: string }> };

const Body = z.object({
  group_class: z.enum(["strategic", "key", "growth", "maintenance"]),
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

  const service = createSupabaseServiceClient();

  // Confirm the event exists. (No mode check — table-mode and cushion-
  // mode both have event_groups rows in their persisted state.)
  const { data: event } = await service
    .from("events")
    .select("id, seating_mode")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) {
    return NextResponse.json({ error: "event_not_found" }, { status: 404 });
  }
  if (event.seating_mode === "cushions") {
    return NextResponse.json(
      {
        error: "cushion_mode_unsupported",
        detail: "Manual group creation is only available in table mode.",
      },
      { status: 409 },
    );
  }

  // Compute next group_no.
  const { data: existing } = await service
    .from("event_groups")
    .select("group_no")
    .eq("event_id", eventId)
    .order("group_no", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextNo = (existing?.group_no ?? 0) + 1;

  const { data: inserted, error: insErr } = await service
    .from("event_groups")
    .insert({
      event_id: eventId,
      group_no: nextNo,
      group_class: body.group_class,
    })
    .select("id, group_no, group_class")
    .single();
  if (insErr || !inserted) {
    return NextResponse.json(
      { error: insErr?.message ?? "insert_failed" },
      { status: 500 },
    );
  }

  await writeAuditLog({
    actor_id: admin.id,
    action: "groups.created",
    entity: "event_groups",
    entity_id: inserted.id,
    after: { group_no: inserted.group_no, group_class: inserted.group_class },
    metadata: { event_id: eventId, via: "manual_add" },
  });

  return NextResponse.json({ ok: true, group: inserted });
}
