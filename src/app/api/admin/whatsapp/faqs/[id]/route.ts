import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";
import { FaqBody, WHATSAPP_WRITE_ROLES } from "@/lib/whatsapp/faq-schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (!WHATSAPP_WRITE_ROLES.has(admin.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const parsed = FaqBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from("whatsapp_faqs")
    .update({ ...parsed.data, updated_by: admin.id, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id, question, answer_en, answer_zh")
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: "update_failed", detail: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await writeAuditLog({
    actor_id: admin.id,
    action: "whatsapp.settings_changed",
    entity: "whatsapp_faqs",
    entity_id: id,
    after: parsed.data,
    metadata: { change: "faq_edited" },
  });
  return NextResponse.json({ faq: data });
}

export async function DELETE(_req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (!WHATSAPP_WRITE_ROLES.has(admin.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from("whatsapp_faqs")
    .delete()
    .eq("id", id)
    .select("question, answer_en, answer_zh")
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: "delete_failed", detail: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await writeAuditLog({
    actor_id: admin.id,
    action: "whatsapp.settings_changed",
    entity: "whatsapp_faqs",
    entity_id: id,
    before: data,
    metadata: { change: "faq_deleted" },
  });
  return NextResponse.json({ ok: true });
}
