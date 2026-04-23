import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { sendOutboundMessage } from "@/lib/inbox/send";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/admin/inbox/[id]/messages
// Body (one of):
//   { body_text: string }
//   { template: { name, language_code: "en_US"|"zh_CN", params: { [k]: string } } }
//
// Sends an outbound text OR WhatsApp template on the conversation's channel.
// If the conversation is unassigned, the first send auto-assigns it to the
// admin — closes a small ops gap where replies should claim the thread.

const TextBody = z.object({
  body_text: z.string().trim().min(1).max(4000),
});

const TemplateBody = z.object({
  template: z.object({
    name: z.string().trim().min(1).max(128),
    language_code: z.enum(["en_US", "zh_CN"]),
    params: z.record(z.string(), z.string().max(1024)).default({}),
  }),
});

const Body = z.union([TextBody, TemplateBody]);

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

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid payload";
    return NextResponse.json({ error: "validation_error", detail: msg }, { status: 400 });
  }

  const service = createSupabaseServiceClient();

  const { data: conv, error: convErr } = await service
    .from("conversations")
    .select("id, assigned_to, channel")
    .eq("id", conversationId)
    .maybeSingle();
  if (convErr) {
    return NextResponse.json({ error: convErr.message }, { status: 500 });
  }
  if (!conv) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Template send is WhatsApp-only — reject early with a clear 400 rather
  // than letting send.ts throw. LINE has its own richer flows we'll handle
  // when we actually wire LINE push templates.
  if ("template" in parsed && conv.channel !== "whatsapp") {
    return NextResponse.json(
      {
        error: "unsupported_channel",
        detail: "Template send is only supported on WhatsApp threads.",
      },
      { status: 400 },
    );
  }

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
    const result = await sendOutboundMessage(
      "template" in parsed
        ? {
            kind: "template",
            conversationId,
            senderAdminId: admin.id,
            templateName: parsed.template.name,
            languageCode: parsed.template.language_code,
            params: parsed.template.params,
          }
        : {
            kind: "text",
            conversationId,
            senderAdminId: admin.id,
            bodyText: parsed.body_text,
          },
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "send_failed";
    return NextResponse.json(
      { error: "send_failed", detail: msg },
      { status: 500 },
    );
  }
}
