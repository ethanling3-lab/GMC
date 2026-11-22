import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-guard";
import { performCheckIn, performClassScan, undoCheckIn } from "@/lib/check-in/check-in-write";
import { loadDaySnapshot, loadStats } from "@/lib/check-in/check-in-query";
import { isIsoDay, todayInEventTz } from "@/lib/check-in/day";
import { resolveDeskContext } from "@/lib/check-in/gate";
import { CHECK_IN_MODES, isClass, isSession } from "@/lib/check-in/mode";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/admin/events/[id]/check-in
//
// One desk scan, for TODAY (event-local, from the server clock — the
// device's own date is never trusted). Body shape is one of:
//   { qr_token: "<nonce>.<sig>", notes?: string }    — camera scan
//   { enrollment_id: "<uuid>",     notes?: string }    — manual / override
// plus:
//   mode          — the desk mode the device is showing. If the organizer has
//                   switched since, nothing is written: 409 `mode_changed`
//                   with the live mode, and the desk asks for a rescan.
//   allow_unpaid  — the desk confirmed an approved-but-unpaid attendee after
//                   the 402 `unpaid` response.
//   intent        — class modes, manual list only: "out" or "back".
//   force_check_in — registration of a specific session from the
//                   out-of-class "Check in now" button: { session }.
//
// What it does follows the event's live mode (gate.ts):
//   registration → check-in for that session (CheckInResult)
//   class        → out / back toggle (ClassScanResult, `kind: "class"`)
//   break        → 409 `break`, nothing recorded
// Outside the event dates with test mode off → 403 `locked`.
//
// Check-in errors carry the person (when known) so the desk can still show
// who it was: 402 unpaid · 409 already_checked_in · 404 not_found · 400 rest.

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
    mode: z.enum(CHECK_IN_MODES).optional(),
    intent: z.enum(["out", "back"]).optional(),
    // "Check in now" from an out-of-class card: register this session
    // regardless of the class mode the desk is in.
    check_in_session: z.enum(["am", "pm"]).optional(),
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
    const ctx = await resolveDeskContext(eventId);
    if (!ctx) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }
    if (ctx.locked) {
      return NextResponse.json(
        { ok: false, error: "locked", start_date: ctx.startDate, end_date: ctx.endDate },
        { status: 403 },
      );
    }
    const modeChanged = body.mode !== undefined && body.mode !== ctx.mode;

    // Out-of-class "Check in now": a registration for an explicit session,
    // allowed while that session's class is running.
    const forceSession = isSession(body.check_in_session) ? body.check_in_session : null;

    if (!forceSession) {
      if (modeChanged) {
        return NextResponse.json(
          { ok: false, error: "mode_changed", mode: ctx.mode },
          { status: 409 },
        );
      }
      if (ctx.mode === "break" || ctx.session === null) {
        return NextResponse.json({ ok: false, error: "break" }, { status: 409 });
      }
      if (isClass(ctx.mode)) {
        const result = await performClassScan({
          eventId,
          actorId: admin.id,
          day: ctx.day,
          session: ctx.session,
          isTest: ctx.testMode,
          qrToken: body.qr_token ?? null,
          enrollmentId: body.enrollment_id ?? null,
          intent: body.intent,
        });
        if (!result.ok) {
          const status = result.error === "not_found" ? 404 : 400;
          return NextResponse.json({ kind: "class", ...result }, { status });
        }
        return NextResponse.json({ kind: "class", ...result });
      }
    }

    const result = await performCheckIn({
      eventId,
      actorId: admin.id,
      method:
        body.method ?? (body.qr_token ? "qr" : "manual"),
      checkInDate: ctx.day,
      session: forceSession ?? ctx.session!,
      isTest: ctx.testMode,
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
//   (no params)                       → { stats } for today's Morning
//   ?view=day&day=YYYY-MM-DD&session=am|pm → full dashboard snapshot
export async function GET(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (!ALLOWED_ROLES.has(admin.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id: eventId } = await params;
  const url = new URL(req.url);
  const dayParam = url.searchParams.get("day");
  const day = isIsoDay(dayParam) ? dayParam : todayInEventTz();
  const sessionParam = url.searchParams.get("session");
  const session = isSession(sessionParam) ? sessionParam : "am";

  try {
    if (url.searchParams.get("view") === "day") {
      return NextResponse.json(await loadDaySnapshot(eventId, day, session));
    }
    return NextResponse.json({ stats: await loadStats(eventId, day, session) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[check-in GET]", msg);
    return NextResponse.json(
      { error: "server_error", detail: msg },
      { status: 500 },
    );
  }
}
