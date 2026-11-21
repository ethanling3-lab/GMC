import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { loadBadges, type BadgeScope } from "@/lib/badges/load";
import { TOKEN_PREFIX_LEN } from "@/lib/badges/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET  — badge payload (settings + sorted paid rows) for the client renderer.
//        ?scope=all (default) | changed | ids&ids=<uuid>,<uuid>
// POST — after a successful download, record what was printed so the next
//        "new & changed" run knows. Same split as profile-deck: the server
//        does auth + the cross-table join, the browser draws the PDF.

type RouteCtx = { params: Promise<{ id: string }> };

function gateRoles(role: string): boolean {
  return role === "super_admin" || role === "regional_lead" || role === "instructor";
}

const UUID = z.string().uuid();

export async function GET(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (!gateRoles(admin.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id: eventId } = await params;

  const url = new URL(req.url);
  const scopeParam = url.searchParams.get("scope") ?? "all";
  let scope: BadgeScope;
  if (scopeParam === "changed") {
    scope = { kind: "changed" };
  } else if (scopeParam === "ids") {
    const ids = (url.searchParams.get("ids") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length === 0 || ids.length > 1000 || !ids.every((i) => UUID.safeParse(i).success)) {
      return NextResponse.json({ error: "bad_ids" }, { status: 400 });
    }
    scope = { kind: "ids", enrollmentIds: ids };
  } else {
    scope = { kind: "all" };
  }

  try {
    return NextResponse.json(await loadBadges(eventId, scope));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "load_failed";
    if (msg === "event_not_found") {
      return NextResponse.json({ error: "event_not_found" }, { status: 404 });
    }
    if (msg === "duplicate_qr_token") {
      return NextResponse.json({ error: "duplicate_qr_token" }, { status: 409 });
    }
    return NextResponse.json({ error: "load_failed", detail: msg }, { status: 500 });
  }
}

const PostBody = z.object({
  scope: z.enum(["all", "changed", "ids"]),
  items: z
    .array(
      z.object({
        enrollment_id: z.string().uuid(),
        name: z.string().max(200),
        display_no: z.number().int().nullable(),
        seat_no: z.number().int().nullable(),
        token_prefix: z.string().min(1).max(TOKEN_PREFIX_LEN),
      }),
    )
    .min(1)
    .max(2000),
});

export async function POST(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (!gateRoles(admin.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id: eventId } = await params;

  const parsed = PostBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "bad_request", detail: parsed.error.message },
      { status: 400 },
    );
  }
  const { items, scope } = parsed.data;
  const service = createSupabaseServiceClient();

  // Only record enrollments that really belong to this event — the ids come
  // from the client.
  const { data: owned, error: ownErr } = await service
    .from("enrollments")
    .select("id")
    .eq("event_id", eventId)
    .in(
      "id",
      items.map((i) => i.enrollment_id),
    );
  if (ownErr) {
    return NextResponse.json({ error: ownErr.message }, { status: 500 });
  }
  const ownedIds = new Set((owned ?? []).map((r) => r.id as string));
  const valid = items.filter((i) => ownedIds.has(i.enrollment_id));

  const { data: prev } = await service
    .from("badge_prints")
    .select("enrollment_id, print_count")
    .eq("event_id", eventId)
    .in(
      "enrollment_id",
      valid.map((i) => i.enrollment_id),
    );
  const prevCount = new Map(
    (prev ?? []).map((p) => [p.enrollment_id as string, p.print_count as number]),
  );

  const now = new Date().toISOString();
  const { error: upErr } = await service.from("badge_prints").upsert(
    valid.map((i) => ({
      enrollment_id: i.enrollment_id,
      event_id: eventId,
      printed_name: i.name,
      printed_display_no: i.display_no,
      printed_seat_no: i.seat_no,
      printed_token_prefix: i.token_prefix,
      print_count: (prevCount.get(i.enrollment_id) ?? 0) + 1,
      last_printed_at: now,
      last_printed_by: admin.id,
    })),
    { onConflict: "enrollment_id" },
  );
  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  await writeAuditLog({
    actor_id: admin.id,
    action: "badges.exported",
    entity: "event",
    entity_id: eventId,
    metadata: { scope, badge_count: valid.length },
  });

  return NextResponse.json({ ok: true, recorded: valid.length });
}
