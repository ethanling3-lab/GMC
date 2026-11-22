import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";
import {
  FLIGHT_TIME_REQUIRED,
  FLIGHT_TIME_REQUIRED_DETAIL,
  upsertFlightInfo,
} from "@/lib/inbox/flight-info-write";
import { createSupabaseServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// PATCH /api/admin/flight-flags/[id]
// Leads only: mark a customer service change as reviewed, or decide a VIP request.

const Body = z.object({ action: z.enum(["reviewed", "approve_vip", "decline_vip"]) });

const RESOLUTION = {
  reviewed: "reviewed",
  approve_vip: "approved",
  decline_vip: "declined",
} as const;

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "regional_lead") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!z.string().uuid().safeParse(id).success || !parsed.success) {
    return NextResponse.json({ error: "validation_error" }, { status: 400 });
  }
  const { action } = parsed.data;

  const service = createSupabaseServiceClient();
  const { data: flag } = await service
    .from("flight_change_flags")
    .select(
      "id, kind, enrollment_id, direction, requested_vip, enrollment:enrollments!inner(participant:participants!inner(region))",
    )
    .eq("id", id)
    .is("resolved_at", null)
    .maybeSingle<{
      id: string;
      kind: "changed" | "deleted" | "vip_request";
      enrollment_id: string;
      direction: "arrival" | "departure";
      requested_vip: boolean | null;
      enrollment: { participant: { region: string | null } | null } | null;
    }>();
  if (!flag) {
    return NextResponse.json(
      { error: "already_resolved", detail: "This was already handled. Refresh the page." },
      { status: 409 },
    );
  }
  if (admin.role === "regional_lead" && flag.enrollment?.participant?.region !== admin.region) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if ((flag.kind === "vip_request") === (action === "reviewed")) {
    return NextResponse.json({ error: "validation_error" }, { status: 400 });
  }

  // Claim it first so two admins can't both apply the same decision.
  const { data: claimed } = await service
    .from("flight_change_flags")
    .update({
      resolved_at: new Date().toISOString(),
      resolved_by: admin.id,
      resolution: RESOLUTION[action],
    })
    .eq("id", id)
    .is("resolved_at", null)
    .select("id");
  if (!claimed?.length) {
    return NextResponse.json(
      { error: "already_resolved", detail: "This was already handled. Refresh the page." },
      { status: 409 },
    );
  }
  const reopen = () =>
    service
      .from("flight_change_flags")
      .update({ resolved_at: null, resolved_by: null, resolution: null })
      .eq("id", id);

  if (action === "approve_vip") {
    const { data: flight } = await service
      .from("flight_info")
      .select(
        "flight_number, airline, origin_airport, destination_airport, scheduled_at, terminal, hotel_key, confirmed_at",
      )
      .eq("enrollment_id", flag.enrollment_id)
      .eq("direction", flag.direction)
      .maybeSingle();
    if (!flight) {
      await reopen();
      return NextResponse.json(
        { error: "flight_missing", detail: "This flight was removed. Decline the request." },
        { status: 409 },
      );
    }
    const { confirmed_at, ...fields } = flight;
    const result = await upsertFlightInfo({
      enrollment_id: flag.enrollment_id,
      direction: flag.direction,
      fields: { ...fields, is_vip: Boolean(flag.requested_vip) },
      confirm: Boolean(confirmed_at),
      actor_id: admin.id,
      actor_role: admin.role,
      via: "vip_request_approval",
    });
    if (!result.ok) {
      await reopen();
      const detail =
        result.error === FLIGHT_TIME_REQUIRED ? FLIGHT_TIME_REQUIRED_DETAIL : result.error;
      return NextResponse.json({ error: result.error, detail }, { status: 400 });
    }
  }

  await writeAuditLog({
    actor_id: admin.id,
    action: "transfer.flight_flag_resolved",
    entity: "flight_change_flag",
    entity_id: id,
    metadata: {
      kind: flag.kind,
      resolution: RESOLUTION[action],
      enrollment_id: flag.enrollment_id,
      direction: flag.direction,
    },
  });

  return NextResponse.json({ ok: true });
}
