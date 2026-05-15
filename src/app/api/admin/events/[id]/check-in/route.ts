import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-guard";
import { performCheckIn, undoCheckIn } from "@/lib/check-in/check-in-write";
import {
  loadStats,
  loadRecent,
  loadVelocity,
  loadGroupRoster,
  loadAbsentees,
  loadArrivalBuckets,
} from "@/lib/check-in/check-in-query";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/admin/events/[id]/check-in
//
// Records a check-in. Body shape is one of:
//   { qr_token: "<nonce>.<sig>", notes?: string }    — camera scan
//   { enrollment_id: "<uuid>",     notes?: string }    — manual fallback
//
// 200 success body matches CheckInResult from check-in-write.ts.
// 4xx for the various business-rule errors (not_found, wrong_event, etc).

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
      qrToken: body.qr_token ?? null,
      enrollmentId: body.enrollment_id ?? null,
      notes: body.notes ?? null,
    });

    if (!result.ok) {
      const status =
        result.error === "not_found"
          ? 404
          : result.error === "already_checked_in"
            ? 409
            : 400;
      return NextResponse.json({ error: result.error }, { status });
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
// Returns the live stats + recent log so the scanner page can poll while
// the camera is active. Lightweight (~2 queries).
export async function GET(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (!ALLOWED_ROLES.has(admin.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id: eventId } = await params;

  try {
    const [stats, recent, velocity, groups, absent, buckets] =
      await Promise.all([
        loadStats(eventId),
        loadRecent(eventId, 20),
        loadVelocity(eventId),
        loadGroupRoster(eventId),
        loadAbsentees(eventId, 50),
        loadArrivalBuckets(eventId, 120, 5),
      ]);
    return NextResponse.json({
      stats,
      recent,
      velocity,
      groups,
      absent,
      buckets,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[check-in GET]", msg);
    return NextResponse.json(
      { error: "server_error", detail: msg },
      { status: 500 },
    );
  }
}
