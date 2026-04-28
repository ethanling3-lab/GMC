import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Manage a participant's flight_info from inside the inbox thread.
//
// POST   /api/admin/inbox/[id]/flight-info
//   Body: { enrollment_id, direction, ...fields, confirm?: boolean }
//   Upserts on (enrollment_id, direction) — the unique key. confirm=true
//   stamps confirmed_by + confirmed_at; otherwise existing values are kept.
//
// DELETE /api/admin/inbox/[id]/flight-info?enrollment_id=...&direction=...
//   Drops the row.
//
// The conversation id in the URL is used only to validate that the caller
// has thread access (RLS) and to scope the audit metadata. The flight row
// is keyed by enrollment, not by conversation.

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
  hotel_key: z.string().trim().max(64).optional(),
  is_vip: z.boolean().optional(),
  confirm: z.boolean().optional(),
});

function emptyToNull<T extends string | undefined | null>(v: T): string | null {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}

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

  const { data: enrollment, error: enrErr } = await service
    .from("enrollments")
    .select("id, event_id, participant_id")
    .eq("id", body.enrollment_id)
    .maybeSingle();
  if (enrErr) {
    return NextResponse.json({ error: enrErr.message }, { status: 500 });
  }
  if (!enrollment) {
    return NextResponse.json({ error: "enrollment_not_found" }, { status: 404 });
  }

  const { data: existing } = await service
    .from("flight_info")
    .select("id, source, confirmed_at")
    .eq("enrollment_id", body.enrollment_id)
    .eq("direction", body.direction)
    .maybeSingle();

  const payload: Record<string, unknown> = {
    enrollment_id: body.enrollment_id,
    direction: body.direction,
    flight_number: emptyToNull(body.flight_number),
    airline: emptyToNull(body.airline),
    origin_airport: emptyToNull(body.origin_airport),
    destination_airport: emptyToNull(body.destination_airport),
    scheduled_at: emptyToNull(body.scheduled_at),
    terminal: emptyToNull(body.terminal),
    hotel_key: emptyToNull(body.hotel_key),
    is_vip: body.is_vip ?? false,
    source: existing?.source ?? "manual",
  };
  if (body.confirm) {
    payload.confirmed_by = admin.id;
    payload.confirmed_at = new Date().toISOString();
  } else if (!existing) {
    payload.confirmed_by = null;
    payload.confirmed_at = null;
  }

  const { data: upserted, error: upErr } = await service
    .from("flight_info")
    .upsert(payload, { onConflict: "enrollment_id,direction" })
    .select("id, confirmed_at")
    .single();
  if (upErr || !upserted) {
    return NextResponse.json(
      { error: upErr?.message ?? "upsert_failed" },
      { status: 500 },
    );
  }

  await writeAuditLog({
    actor_id: admin.id,
    action: body.confirm
      ? "inbox.flight_info_confirmed"
      : "inbox.flight_info_extracted",
    entity: "flight_info",
    entity_id: upserted.id,
    metadata: {
      conversation_id: conversationId,
      enrollment_id: body.enrollment_id,
      direction: body.direction,
      via: "inbox_panel",
    },
  });

  return NextResponse.json({
    ok: true,
    id: upserted.id,
    confirmed_at: upserted.confirmed_at,
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

  const service = createSupabaseServiceClient();
  const { data: existing } = await service
    .from("flight_info")
    .select("id")
    .eq("enrollment_id", enrollment_id)
    .eq("direction", direction)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ ok: true, missing: true });
  }
  const { error: delErr } = await service
    .from("flight_info")
    .delete()
    .eq("id", existing.id);
  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  await writeAuditLog({
    actor_id: admin.id,
    action: "inbox.flight_info_extracted",
    entity: "flight_info",
    entity_id: existing.id,
    metadata: {
      conversation_id: conversationId,
      enrollment_id,
      direction,
      deleted: true,
      via: "inbox_panel",
    },
  });

  return NextResponse.json({ ok: true });
}
