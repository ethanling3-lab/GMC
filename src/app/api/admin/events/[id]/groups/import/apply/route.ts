import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";
import { applyGroupingImport } from "@/lib/grouping/import-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/admin/events/[id]/groups/import/apply
//
// Commits a confirmed desired-state grouping (produced by .../import/preview
// and reviewed by the admin) to event_groups + event_seat_assignments. Full-
// snapshot: every touched group is stamped edited=true so the imported
// grouping survives a later Regenerate. Server re-validates the payload.

type RouteCtx = { params: Promise<{ id: string }> };

const Body = z.object({
  filename: z.string().max(255).optional(),
  desired_state: z.object({
    groups: z
      .array(
        z.object({
          group_no: z.number().int().min(1).max(999),
          group_class: z.enum(["strategic", "key", "growth", "maintenance"]),
          name_en: z.string().max(120).nullable(),
          name_cn: z.string().max(120).nullable(),
        }),
      )
      .max(400),
    members: z
      .array(
        z.object({
          participant_id: z.string().uuid(),
          group_no: z.number().int().min(1).max(999),
          role: z.enum(["zu_zhang", "fu_zu_zhang", "pai_zhang", "participant"]),
        }),
      )
      .max(2000),
  }),
  options: z.object({
    override_locked: z.boolean(),
    unassign_missing: z.boolean(),
  }),
});

export async function POST(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "regional_lead") {
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

  const service = createSupabaseServiceClient();
  const result = await applyGroupingImport(
    service,
    eventId,
    body.desired_state,
    body.options,
  );
  if ("error" in result) {
    const status = result.error === "event_not_found" ? 404 : 500;
    return NextResponse.json({ error: result.error }, { status });
  }

  await writeAuditLog({
    actor_id: admin.id,
    action: "groups.imported_xlsx",
    entity: "events",
    entity_id: eventId,
    metadata: {
      filename: body.filename ?? null,
      ...result,
      options: body.options,
    },
  });

  return NextResponse.json({ ok: true, ...result });
}
