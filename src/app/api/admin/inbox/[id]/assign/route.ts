import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/admin/inbox/[id]/assign — set or clear a conversation's owner.
//
// Body: { admin_id: "self" | <uuid> | null }
//   "self"  → assign to the caller (server-resolves to admin.id from the
//             session, so the client never has to know its own id)
//   <uuid>  → assign to a specific admin
//   null    → unassign
//
// Idempotent. Bulk toolbar uses "self"; future per-thread assign-picker
// can pass a uuid.

const Body = z.object({
  admin_id: z.union([z.literal("self"), z.string().uuid(), z.null()]),
});

const WRITE_ROLES = new Set(["super_admin", "regional_lead", "customer_service"]);

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (!WRITE_ROLES.has(admin.role)) {
    return NextResponse.json(
      { error: "forbidden", detail: "Only super/regional/CS admins can assign conversations." },
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

  // Resolve the target admin id. "self" → caller's own id (no DB hop
  // needed since requireAdmin already validated the session). Otherwise
  // validate the supplied uuid exists in admins so we surface a clean
  // 404 instead of a raw PostgREST FK error.
  let targetAdminId: string | null;
  if (body.admin_id === "self") {
    targetAdminId = admin.id;
  } else {
    targetAdminId = body.admin_id;
    if (targetAdminId) {
      const { data: target, error: targetErr } = await service
        .from("admins")
        .select("id")
        .eq("id", targetAdminId)
        .maybeSingle();
      if (targetErr) {
        return NextResponse.json({ error: targetErr.message }, { status: 500 });
      }
      if (!target) {
        return NextResponse.json(
          { error: "admin_not_found", detail: "Target admin does not exist." },
          { status: 404 },
        );
      }
    }
  }

  const { data: before, error: loadErr } = await service
    .from("conversations")
    .select("id, assigned_to")
    .eq("id", conversationId)
    .maybeSingle();
  if (loadErr) {
    return NextResponse.json({ error: loadErr.message }, { status: 500 });
  }
  if (!before) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (before.assigned_to === targetAdminId) {
    return NextResponse.json({ ok: true, unchanged: true, assigned_to: targetAdminId });
  }

  const { error: updErr } = await service
    .from("conversations")
    .update({ assigned_to: targetAdminId })
    .eq("id", conversationId);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  await writeAuditLog({
    actor_id: admin.id,
    action: "inbox.conversation_assigned",
    entity: "conversations",
    entity_id: conversationId,
    before: { assigned_to: before.assigned_to },
    after: { assigned_to: targetAdminId },
    metadata: {},
  });

  return NextResponse.json({ ok: true, assigned_to: targetAdminId });
}
