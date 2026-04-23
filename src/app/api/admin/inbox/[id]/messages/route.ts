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
//   { attachments: [{ path, mime_type, filename, size? }], body_text?: string }
//
// Sends an outbound message on the conversation's channel. Templates +
// attachments are WhatsApp-only. Attachments ship as one message each (WhatsApp
// allows one media per message); body_text rides along as the caption on the
// first attachment.

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

const AttachmentSchema = z.object({
  path: z.string().trim().min(1).max(512),
  mime_type: z.string().trim().min(1).max(128),
  filename: z.string().trim().min(1).max(256),
  size: z.number().int().nonnegative().optional(),
});

const MediaBody = z.object({
  attachments: z.array(AttachmentSchema).min(1).max(10),
  body_text: z.string().trim().max(1024).optional(),
});

const Body = z.union([MediaBody, TemplateBody, TextBody]);

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

  if ("template" in parsed && conv.channel !== "whatsapp") {
    return NextResponse.json(
      {
        error: "unsupported_channel",
        detail: "Template send is only supported on WhatsApp threads.",
      },
      { status: 400 },
    );
  }
  if ("attachments" in parsed && conv.channel !== "whatsapp") {
    return NextResponse.json(
      {
        error: "unsupported_channel",
        detail: "Attachment send is only supported on WhatsApp threads.",
      },
      { status: 400 },
    );
  }
  // Scope attachment paths to this conversation so a compromised admin UI
  // can't post a path that belongs to another thread's outbound folder.
  if ("attachments" in parsed) {
    const expectedPrefix = `${conv.channel}/${conversationId}/outbound/`;
    for (const a of parsed.attachments) {
      if (!a.path.startsWith(expectedPrefix)) {
        return NextResponse.json(
          {
            error: "invalid_attachment_path",
            detail: `Attachment path must live under ${expectedPrefix}`,
          },
          { status: 400 },
        );
      }
    }
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
    if ("attachments" in parsed) {
      const result = await sendOutboundMessage({
        kind: "media",
        conversationId,
        senderAdminId: admin.id,
        bodyText: parsed.body_text,
        attachments: parsed.attachments,
      });
      return NextResponse.json({ ok: true, ...result });
    }
    if ("template" in parsed) {
      const result = await sendOutboundMessage({
        kind: "template",
        conversationId,
        senderAdminId: admin.id,
        templateName: parsed.template.name,
        languageCode: parsed.template.language_code,
        params: parsed.template.params,
      });
      return NextResponse.json({ ok: true, ...result });
    }
    const result = await sendOutboundMessage({
      kind: "text",
      conversationId,
      senderAdminId: admin.id,
      bodyText: parsed.body_text,
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
