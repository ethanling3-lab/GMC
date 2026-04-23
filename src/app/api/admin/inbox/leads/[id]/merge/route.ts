import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/admin/inbox/leads/[id]/merge
// Body: { target_participant_id: string }
//
// Folds the lead participant identified by :id into target_participant_id.
// All the transactional work happens inside the `merge_lead_into_participant`
// Postgres function (migration 016) so a failure in any step rolls back cleanly.

const Body = z.object({
  target_participant_id: z.string().uuid(),
});

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (
    admin.role !== "super_admin" &&
    admin.role !== "regional_lead" &&
    admin.role !== "customer_service"
  ) {
    return NextResponse.json(
      { error: "forbidden", detail: "Only super/regional/CS admins can merge leads" },
      { status: 403 },
    );
  }

  const { id: leadId } = await params;

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid payload";
    return NextResponse.json({ error: "validation_error", detail: msg }, { status: 400 });
  }

  const service = createSupabaseServiceClient();

  // Snapshot lead + target before mutating so the audit log is meaningful
  // even after the lead row is gone.
  const [leadRes, targetRes] = await Promise.all([
    service
      .from("participants")
      .select("id, status, name_en, name_cn, phone, email")
      .eq("id", leadId)
      .maybeSingle(),
    service
      .from("participants")
      .select("id, status, region_id, name_en, name_cn")
      .eq("id", body.target_participant_id)
      .maybeSingle(),
  ]);
  if (leadRes.error) {
    return NextResponse.json({ error: leadRes.error.message }, { status: 500 });
  }
  if (!leadRes.data) {
    return NextResponse.json({ error: "lead_not_found" }, { status: 404 });
  }
  if (leadRes.data.status !== "lead") {
    return NextResponse.json(
      { error: "not_a_lead", detail: "Only lead participants can be merged" },
      { status: 400 },
    );
  }
  if (targetRes.error) {
    return NextResponse.json({ error: targetRes.error.message }, { status: 500 });
  }
  if (!targetRes.data) {
    return NextResponse.json({ error: "target_not_found" }, { status: 404 });
  }
  if (targetRes.data.status === "lead") {
    return NextResponse.json(
      {
        error: "target_is_lead",
        detail: "Pick a non-lead participant as the merge target.",
      },
      { status: 400 },
    );
  }

  const { data: rpcData, error: rpcErr } = await service.rpc("merge_lead_into_participant", {
    p_lead_id: leadId,
    p_target_id: body.target_participant_id,
  });
  if (rpcErr) {
    return NextResponse.json(
      { error: "merge_failed", detail: rpcErr.message },
      { status: 400 },
    );
  }

  await writeAuditLog({
    actor_id: admin.id,
    action: "inbox.lead_merged",
    entity: "participants",
    entity_id: body.target_participant_id,
    before: {
      lead: {
        id: leadRes.data.id,
        name_en: leadRes.data.name_en,
        name_cn: leadRes.data.name_cn,
        phone: leadRes.data.phone,
        email: leadRes.data.email,
      },
    },
    after: {
      target: {
        id: targetRes.data.id,
        region_id: targetRes.data.region_id,
        name_en: targetRes.data.name_en,
        name_cn: targetRes.data.name_cn,
      },
    },
    metadata: (rpcData ?? {}) as Record<string, unknown>,
  });

  return NextResponse.json({ ok: true, result: rpcData });
}
