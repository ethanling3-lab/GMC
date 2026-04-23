import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { sendOutboundMessage } from "@/lib/inbox/send";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/admin/inbox/[id]/messages
// Body: { body_text: string }
//
// Sends an outbound text message on the conversation's channel. If the
// conversation is unassigned, the first send auto-assigns it to the admin —
// closes a small ops gap where replies should claim the thread.

const Body = z.object({
  body_text: z.string().trim().min(1).max(4000),
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
      { error: "forbidden", detail: "Only super/regional/CS admins can send" },
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

  // Verify the conversation exists — the RLS for UPDATE on conversations
  // would block a non-privileged admin anyway, but we want to 404 rather
  // than 403 when the id is bogus.
  const { data: conv, error: convErr } = await service
    .from("conversations")
    .select("id, assigned_to")
    .eq("id", conversationId)
    .maybeSingle();
  if (convErr) {
    return NextResponse.json({ error: convErr.message }, { status: 500 });
  }
  if (!conv) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Auto-assign on first reply. A separate step so the audit log captures it
  // as its own event, and so the assignment lands even if the send errors.
  if (!conv.assigned_to) {
    const { error: assignErr } = await service
      .from("conversations")
      .update({ assigned_to: admin.id })
      .eq("id", conversationId);
    if (!assignErr) {
      await writeAuditLog({
        actor_id: admin.id,
        action: "inbox.conversation_assigned",
        entity: "conversations",
        entity_id: conversationId,
        before: { assigned_to: null },
        after: { assigned_to: admin.id },
        metadata: { via: "auto_on_first_send" },
      });
    }
  }

  try {
    const result = await sendOutboundMessage({
      conversationId,
      senderAdminId: admin.id,
      bodyText: body.body_text,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "send_failed";
    return NextResponse.json(
      { error: "send_failed", detail: msg },
      { status: 500 },
    );
  }
}
