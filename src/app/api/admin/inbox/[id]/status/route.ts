import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/admin/inbox/[id]/status — flip a single conversation's status
// (open / pending / snoozed / closed). Idempotent: re-setting to the
// current value short-circuits with `unchanged: true` so the bulk runner's
// concurrency-capped fan-out doesn't generate spurious audit rows.

const Body = z.object({
  status: z.enum(["open", "pending", "snoozed", "closed"]),
});

const WRITE_ROLES = new Set(["super_admin", "regional_lead", "customer_service"]);

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (!WRITE_ROLES.has(admin.role)) {
    return NextResponse.json(
      { error: "forbidden", detail: "Only super/regional/CS admins can change conversation status." },
      { status: 403 },
    );
  }

  const { id: conversationId } = await params;

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid payload";
    return NextResponse.json({ error: "validation_error", detail: msg }, { status: 400 });
  }

  const service = createSupabaseServiceClient();
  const { data: before, error: loadErr } = await service
    .from("conversations")
    .select("id, status")
    .eq("id", conversationId)
    .maybeSingle();
  if (loadErr) {
    return NextResponse.json({ error: loadErr.message }, { status: 500 });
  }
  if (!before) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (before.status === body.status) {
    return NextResponse.json({ ok: true, unchanged: true, status: body.status });
  }

  const { error: updErr } = await service
    .from("conversations")
    .update({ status: body.status })
    .eq("id", conversationId);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  await writeAuditLog({
    actor_id: admin.id,
    action: "inbox.conversation_status_changed",
    entity: "conversations",
    entity_id: conversationId,
    before: { status: before.status },
    after: { status: body.status },
    metadata: {},
  });

  return NextResponse.json({ ok: true, status: body.status });
}
