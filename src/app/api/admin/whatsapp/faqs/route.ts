import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";
import { FaqBody, FaqSwitchBody, WHATSAPP_WRITE_ROLES } from "@/lib/whatsapp/faq-schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/admin/whatsapp/faqs — add an answer.
export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!WHATSAPP_WRITE_ROLES.has(admin.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const parsed = FaqBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from("whatsapp_faqs")
    .insert({ ...parsed.data, created_by: admin.id, updated_by: admin.id })
    .select("id, question, answer_en, answer_zh")
    .single();
  if (error || !data) {
    return NextResponse.json({ error: "insert_failed", detail: error?.message }, { status: 500 });
  }
  await writeAuditLog({
    actor_id: admin.id,
    action: "whatsapp.settings_changed",
    entity: "whatsapp_faqs",
    entity_id: data.id as string,
    after: parsed.data,
    metadata: { change: "faq_added" },
  });
  return NextResponse.json({ faq: data }, { status: 201 });
}

// PUT /api/admin/whatsapp/faqs — turn FAQ answers on or off.
export async function PUT(req: Request) {
  const admin = await requireAdmin();
  if (!WHATSAPP_WRITE_ROLES.has(admin.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const parsed = FaqSwitchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const service = createSupabaseServiceClient();
  const { error } = await service
    .from("whatsapp_automations")
    .update({
      faqs_enabled: parsed.data.enabled,
      updated_by: admin.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", true);
  if (error) {
    return NextResponse.json({ error: "update_failed", detail: error.message }, { status: 500 });
  }
  await writeAuditLog({
    actor_id: admin.id,
    action: "whatsapp.settings_changed",
    entity: "whatsapp_automations",
    entity_id: admin.id,
    after: { faqs_enabled: parsed.data.enabled },
    metadata: {},
  });
  return NextResponse.json({ ok: true });
}
