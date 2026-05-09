import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/admin/events/[id]/layout/exported
//
// Audit-only endpoint. Floor-plan exports happen client-side (the SVG is
// already in the browser, signed URLs are already resolved), but we still
// want a server-side trail of who exported what for the admin audit log.
// The client fires-and-forgets a POST after each successful download.

const Body = z.object({
  format: z.enum(["png", "pdf", "pptx"]),
  reveal: z.enum(["names", "region_ids"]),
  page_size: z.string().max(40).optional(),
  pixel_scale: z.number().int().min(1).max(40).optional(),
});

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (
    admin.role !== "super_admin"
    && admin.role !== "regional_lead"
    && admin.role !== "instructor"
  ) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id: eventId } = await params;
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "bad_request", detail: parsed.error.message },
      { status: 400 },
    );
  }

  await writeAuditLog({
    actor_id: admin.id,
    action: "floor_plan.exported",
    entity: "event",
    entity_id: eventId,
    metadata: {
      format: parsed.data.format,
      reveal: parsed.data.reveal,
      page_size: parsed.data.page_size ?? null,
      pixel_scale: parsed.data.pixel_scale ?? null,
    },
  });

  return NextResponse.json({ ok: true });
}
