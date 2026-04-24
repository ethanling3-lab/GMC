import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/admin/inbox/[id]/ai/toggle
// Body: { enabled: boolean }
//
// Flips the Tier 1 AI assistant on or off for a single thread. Role-gated to
// super / regional_lead / customer_service — matches the sender-role rules
// on the composer itself. When AI picks up, replies go through with
// sender_type='ai_agent'; handoffs automatically flip this off and bump
// status to 'pending' so admin sees it in the queue.

const Body = z.object({ enabled: z.boolean() });

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (
    admin.role !== "super_admin" &&
    admin.role !== "regional_lead" &&
    admin.role !== "customer_service"
  ) {
    return NextResponse.json(
      { error: "forbidden", detail: "Only super/regional/CS admins can toggle AI" },
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
    .select("id, ai_enabled, channel")
    .eq("id", conversationId)
    .maybeSingle();
  if (loadErr) {
    return NextResponse.json({ error: loadErr.message }, { status: 500 });
  }
  if (!before) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  // Tier 1 is WhatsApp-only today — the adapter-level dispatch in
  // runTier1Reply doesn't differentiate but we don't want to enable AI on
  // channels where the send path isn't proven.
  if (body.enabled && before.channel !== "whatsapp") {
    return NextResponse.json(
      {
        error: "unsupported_channel",
        detail: "AI assistant is only supported on WhatsApp threads.",
      },
      { status: 400 },
    );
  }

  if (before.ai_enabled === body.enabled) {
    return NextResponse.json({ ok: true, unchanged: true, ai_enabled: body.enabled });
  }

  const { error: updErr } = await service
    .from("conversations")
    .update({ ai_enabled: body.enabled })
    .eq("id", conversationId);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  await writeAuditLog({
    actor_id: admin.id,
    action: "inbox.ai_enabled_changed",
    entity: "conversations",
    entity_id: conversationId,
    before: { ai_enabled: before.ai_enabled },
    after: { ai_enabled: body.enabled },
    metadata: {},
  });

  return NextResponse.json({ ok: true, ai_enabled: body.enabled });
}
