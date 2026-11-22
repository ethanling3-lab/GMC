import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";
import { closeOpenExits } from "@/lib/check-in/check-in-write";
import { canRunEvent, resolveDeskContext } from "@/lib/check-in/gate";
import { CHECK_IN_MODES } from "@/lib/check-in/mode";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// PATCH /api/admin/events/[id]/check-in/mode  { mode }
//
// The organizer moves the event between Morning and Afternoon registration.
// Every desk picks the new mode up on its next poll. Anyone still out of class
// is closed as "didn't scan back": that session's class is over.

type RouteCtx = { params: Promise<{ id: string }> };

const Body = z.object({ mode: z.enum(CHECK_IN_MODES) });

export async function PATCH(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (!canRunEvent(admin.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id: eventId } = await params;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const { mode } = parsed.data;

  try {
    const ctx = await resolveDeskContext(eventId);
    if (!ctx) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const service = createSupabaseServiceClient();
    const { error } = await service
      .from("events")
      .update({
        check_in_mode: mode,
        check_in_mode_set_at: new Date().toISOString(),
        check_in_mode_set_by: admin.id,
      })
      .eq("id", eventId);
    if (error) throw new Error(error.message);

    // After the switch, so a desk scan racing it can't open a new exit behind
    // the sweep (its POST now gets mode_changed).
    const closed = mode !== ctx.mode ? await closeOpenExits(eventId, admin.id) : 0;

    await writeAuditLog({
      actor_id: admin.id,
      action: "check_in.mode_changed",
      entity: "events",
      entity_id: eventId,
      metadata: { from: ctx.mode, to: mode, closed_exits: closed },
    });

    return NextResponse.json({ ok: true, mode, closed_exits: closed });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[check-in mode PATCH]", msg);
    return NextResponse.json({ error: "server_error", detail: msg }, { status: 500 });
  }
}
