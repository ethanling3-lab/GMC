import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-guard";
import {
  upsertFlightInfo,
  deleteFlightInfo,
} from "@/lib/inbox/flight-info-write";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Context-free flight_info upsert/delete. The inbox panel hits the
// `/api/admin/inbox/[id]/flight-info` route with a conversation context;
// the transfer-list "Add flight" dialog hits THIS route directly because
// it doesn't have a conversation handle. Both delegate to the same
// `lib/inbox/flight-info-write.ts` helper.
//
// Role gate matches the inbox endpoint: super, regional_lead, customer_service.

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
  hotel_key: z.string().trim().max(64).optional(),
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

export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!rolesAllowed(admin.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: z.infer<typeof PostBody>;
  try {
    body = PostBody.parse(await req.json());
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid payload";
    return NextResponse.json({ error: "validation_error", detail: msg }, { status: 400 });
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
    via: "transfer_list_dialog",
  });

  if (!result.ok) {
    if (result.error === "enrollment_not_found") {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    id: result.id,
    confirmed_at: result.confirmed_at,
  });
}

export async function DELETE(req: Request) {
  const admin = await requireAdmin();
  if (!rolesAllowed(admin.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

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
    via: "transfer_list_dialog",
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true, missing: !result.deleted });
}
