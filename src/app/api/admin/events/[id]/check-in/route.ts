import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-guard";
import { performCheckIn, undoCheckIn } from "@/lib/check-in/check-in-write";
import { loadDaySnapshot, loadStats } from "@/lib/check-in/check-in-query";
import { isIsoDay, todayInEventTz } from "@/lib/check-in/day";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/admin/events/[id]/check-in
//
// Records a check-in for TODAY (event-local, from the server clock — the
// device's own date is never trusted). Body shape is one of:
//   { qr_token: "<nonce>.<sig>", notes?: string }    — camera scan
//   { enrollment_id: "<uuid>",     notes?: string }    — manual / face / override
// plus `allow_unpaid: true` when the desk confirmed checking in an
// approved-but-unpaid attendee after the 402 `unpaid` response.
//
// 200 success body matches CheckInResult from check-in-write.ts. Errors carry
// the person (when known) so the desk can still show who it was:
//   402 unpaid · 409 already_checked_in · 404 not_found · 400 the rest.

type RouteCtx = { params: Promise<{ id: string }> };

const Body = z
  .object({
    qr_token: z.string().trim().min(1).max(256).optional(),
    enrollment_id: z.string().uuid().optional(),
    notes: z.string().trim().max(512).optional(),
    // M7.1c — explicit method for the face-recognition flow. Optional
    // for back-compat with the existing QR + manual paths, which derive
    // method from which body field is set.
    method: z.enum(["qr", "manual", "face_match"]).optional(),
    allow_unpaid: z.boolean().optional(),
  })
  .refine(
    (v) => Boolean(v.qr_token) !== Boolean(v.enrollment_id),
    "exactly one of qr_token / enrollment_id required",
  );

const ALLOWED_ROLES = new Set([
  "super_admin",
  "regional_lead",
  "customer_service",
  "instructor",
]);

export async function POST(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (!ALLOWED_ROLES.has(admin.role)) {
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

  try {
    const result = await performCheckIn({
      eventId,
      actorId: admin.id,
      method:
        body.method ?? (body.qr_token ? "qr" : "manual"),
      checkInDate: todayInEventTz(),
      qrToken: body.qr_token ?? null,
      enrollmentId: body.enrollment_id ?? null,
      allowUnpaid: body.allow_unpaid === true,
      notes: body.notes ?? null,
    });

    if (!result.ok) {
      const status =
        result.error === "not_found"
          ? 404
          : result.error === "already_checked_in"
            ? 409
            : result.error === "unpaid"
              ? 402
              : 400;
      return NextResponse.json(result, { status });
    }

    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[check-in POST]", msg);
    return NextResponse.json(
      { error: "server_error", detail: msg },
      { status: 500 },
    );
  }
}

// DELETE /api/admin/events/[id]/check-in?check_in_id=<uuid>
// Reverses a check-in. Used when the wrong person was scanned or admin
// needs to re-record manually.
export async function DELETE(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (!ALLOWED_ROLES.has(admin.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id: eventId } = await params;
  const url = new URL(req.url);
  const checkInId = url.searchParams.get("check_in_id");
  if (!checkInId) {
    return NextResponse.json(
      { error: "missing_check_in_id" },
      { status: 400 },
    );
  }

  try {
    const result = await undoCheckIn({
      checkInId,
      eventId,
      actorId: admin.id,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[check-in DELETE]", msg);
    return NextResponse.json(
      { error: "server_error", detail: msg },
      { status: 500 },
    );
  }
}

// GET /api/admin/events/[id]/check-in
//   (no params)          → { stats } for today — the scanner stations' poll
//   ?view=day&day=YYYY-MM-DD → full dashboard snapshot for that day
export async function GET(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (!ALLOWED_ROLES.has(admin.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id: eventId } = await params;
  const url = new URL(req.url);
  const dayParam = url.searchParams.get("day");
  const day = isIsoDay(dayParam) ? dayParam : todayInEventTz();

  try {
    if (url.searchParams.get("view") === "day") {
      return NextResponse.json(await loadDaySnapshot(eventId, day));
    }
    return NextResponse.json({ stats: await loadStats(eventId, day) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[check-in GET]", msg);
    return NextResponse.json(
      { error: "server_error", detail: msg },
      { status: 500 },
    );
  }
}
