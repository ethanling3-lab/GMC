import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 26;

const BulkBody = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("approve"),
    ids: z.array(z.string().uuid()).min(1).max(500),
  }),
  z.object({
    action: z.literal("reject"),
    ids: z.array(z.string().uuid()).min(1).max(500),
  }),
  z.object({
    action: z.literal("cancel"),
    ids: z.array(z.string().uuid()).min(1).max(500),
  }),
  z.object({
    action: z.literal("mark_paid"),
    ids: z.array(z.string().uuid()).min(1).max(500),
  }),
]);

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  const { id: eventId } = await params;

  // Approvals, rejections, and paid-marking are super_admin-only for now.
  // Later we can open approve/reject to regional_lead for their region.
  if (admin.role !== "super_admin") {
    return NextResponse.json(
      { error: "Only super admins can act on enrollments in bulk" },
      { status: 403 },
    );
  }

  let body: z.infer<typeof BulkBody>;
  try {
    body = BulkBody.parse(await req.json());
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid payload";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const service = createSupabaseServiceClient();

  // Scope the write to enrollments on THIS event so a spoofed id can't touch
  // enrollments on a different event. The ids come from the admin UI but
  // belt-and-braces.
  const { data: scoped, error: scopeErr } = await service
    .from("enrollments")
    .select("id")
    .eq("event_id", eventId)
    .in("id", body.ids);
  if (scopeErr) {
    return NextResponse.json({ error: scopeErr.message }, { status: 500 });
  }
  const allowedIds = (scoped ?? []).map((r) => r.id);
  const skipped = body.ids.filter((id) => !allowedIds.includes(id));

  if (allowedIds.length === 0) {
    return NextResponse.json({
      action: body.action,
      affected: 0,
      skipped: skipped.length,
    });
  }

  const now = new Date().toISOString();

  let update: Record<string, unknown> = {};
  switch (body.action) {
    case "approve":
      update = {
        status: "approved",
        approved_by: admin.id,
        approved_at: now,
      };
      break;
    case "reject":
      update = {
        status: "rejected",
        approved_by: admin.id,
        approved_at: now,
      };
      break;
    case "cancel":
      update = { status: "cancelled" };
      break;
    case "mark_paid":
      update = {
        status: "paid",
        payment_status: "paid",
        paid_at: now,
      };
      break;
  }

  const { error } = await service
    .from("enrollments")
    .update(update)
    .in("id", allowedIds);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    action: body.action,
    affected: allowedIds.length,
    skipped: skipped.length,
  });
}
