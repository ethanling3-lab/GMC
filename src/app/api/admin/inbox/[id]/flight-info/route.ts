import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import {
  upsertFlightInfo,
  deleteFlightInfo,
  FLIGHT_TIME_REQUIRED,
  FLIGHT_TIME_REQUIRED_DETAIL,
  HOTEL_NAME_REQUIRED,
  HOTEL_NAME_REQUIRED_DETAIL,
} from "@/lib/inbox/flight-info-write";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Manage a participant's flight_info from inside the inbox thread.
//
// POST   /api/admin/inbox/[id]/flight-info
//   Body: { enrollment_id, direction, ...fields, confirm?: boolean }
//   Upserts on (enrollment_id, direction) — see flight-info-write.ts.
//
// DELETE /api/admin/inbox/[id]/flight-info?enrollment_id=...&direction=...
//
// Conversation id in the URL is used to validate thread access (RLS) and
// flow into the audit metadata. The actual write logic lives in the
// shared helper so the transfer-list dialog can reuse it without a
// conversation context.

type RouteCtx = { params: Promise<{ id: string }> };

const isoOrEmpty = z
  .string()
  .trim()
  .max(64)
  .refine(
    (v) => v === "" || !Number.isNaN(new Date(v).getTime()),
    "scheduled_at must be empty or a valid ISO timestamp",
  )
  .optional();

const PostBody = z.object({
  enrollment_id: z.string().uuid(),
  direction: z.enum(["arrival", "departure"]),
  flight_number: z.string().trim().max(32).optional(),
  airline: z.string().trim().max(64).optional(),
  origin_airport: z.string().trim().toUpperCase().length(3).optional().or(z.literal("")),
  destination_airport: z.string().trim().toUpperCase().length(3).optional().or(z.literal("")),
  scheduled_at: isoOrEmpty,
  terminal: z.string().trim().max(16).optional(),
  hotel_key: z.string().trim().max(240).optional(),
  is_vip: z.boolean().optional(),
  confirm: z.boolean().optional(),
});

function rolesAllowed(role: string): boolean {
  return (
    role === "super_admin" ||
    role === "regional_lead" ||
    role === "customer_service"
  );
}

export async function POST(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (!rolesAllowed(admin.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id: conversationId } = await params;

  let body: z.infer<typeof PostBody>;
  try {
    body = PostBody.parse(await req.json());
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid payload";
    return NextResponse.json({ error: "validation_error", detail: msg }, { status: 400 });
  }

  // Validate the conversation exists (RLS would also gate this) so the URL
  // segment isn't a free-for-all routing footgun.
  const service = createSupabaseServiceClient();
  const { data: conv, error: convErr } = await service
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .maybeSingle();
  if (convErr) {
    return NextResponse.json({ error: convErr.message }, { status: 500 });
  }
  if (!conv) {
    return NextResponse.json({ error: "thread_not_found" }, { status: 404 });
  }

  const result = await upsertFlightInfo({
    enrollment_id: body.enrollment_id,
    direction: body.direction,
    fields: {
      flight_number: body.flight_number,
      airline: body.airline,
      origin_airport: body.origin_airport,
      destination_airport: body.destination_airport,
      scheduled_at: body.scheduled_at,
      terminal: body.terminal,
      hotel_key: body.hotel_key,
      is_vip: body.is_vip,
    },
    confirm: Boolean(body.confirm),
    actor_id: admin.id,
    actor_role: admin.role,
    conversation_id: conversationId,
    via: "inbox_panel",
  });

  if (!result.ok) {
    if (result.error === FLIGHT_TIME_REQUIRED) {
      return NextResponse.json(
        { error: result.error, detail: FLIGHT_TIME_REQUIRED_DETAIL },
        { status: 400 },
      );
    }
    if (result.error === HOTEL_NAME_REQUIRED) {
      return NextResponse.json(
        { error: result.error, detail: HOTEL_NAME_REQUIRED_DETAIL },
        { status: 400 },
      );
    }
    if (result.error === "enrollment_not_found") {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    id: result.id,
    confirmed_at: result.confirmed_at,
    transfer: result.transfer,
    flagged: result.flagged,
    vip_requested: result.vip_requested,
    flag_failed: result.flag_failed,
  });
}

export async function DELETE(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (!rolesAllowed(admin.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id: conversationId } = await params;
  const url = new URL(req.url);
  const enrollment_id = url.searchParams.get("enrollment_id");
  const direction = url.searchParams.get("direction");
  if (!enrollment_id || (direction !== "arrival" && direction !== "departure")) {
    return NextResponse.json(
      { error: "validation_error", detail: "enrollment_id + direction required" },
      { status: 400 },
    );
  }

  const result = await deleteFlightInfo({
    enrollment_id,
    direction,
    actor_id: admin.id,
    actor_role: admin.role,
    conversation_id: conversationId,
    via: "inbox_panel",
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true, missing: !result.deleted, transfer: result.transfer });
}
