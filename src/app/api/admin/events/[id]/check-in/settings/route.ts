import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";
import { canRunEvent } from "@/lib/check-in/gate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// PATCH /api/admin/events/[id]/check-in/settings
//   { test_mode?: boolean, long_absence_minutes?: 1–240 }
//
// Kept apart from the main event PATCH (super_admin-only field whitelist) so
// regional leads running the floor can change these too — same pattern as
// group-report-template.

type RouteCtx = { params: Promise<{ id: string }> };

const Body = z
  .object({
    test_mode: z.boolean().optional(),
    long_absence_minutes: z.number().int().min(1).max(240).optional(),
  })
  .refine((v) => v.test_mode !== undefined || v.long_absence_minutes !== undefined, "nothing to change");

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

  const update: Record<string, unknown> = {};
  if (parsed.data.test_mode !== undefined) update.check_in_test_mode = parsed.data.test_mode;
  if (parsed.data.long_absence_minutes !== undefined) {
    update.long_absence_minutes = parsed.data.long_absence_minutes;
  }

  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from("events")
    .update(update)
    .eq("id", eventId)
    .select("id")
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: "update_failed", detail: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await writeAuditLog({
    actor_id: admin.id,
    action: "check_in.settings_changed",
    entity: "events",
    entity_id: eventId,
    metadata: parsed.data,
  });

  return NextResponse.json({ ok: true });
}
