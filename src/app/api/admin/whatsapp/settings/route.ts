import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";
import { WELCOME_MAX_CHARS } from "@/lib/whatsapp/automations-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// PATCH /api/admin/whatsapp/settings — save the welcome message.

const WRITE_ROLES = new Set(["super_admin", "regional_lead"]);

const Body = z.object({
  welcome_enabled: z.boolean(),
  welcome_en: z.string().trim().min(1).max(WELCOME_MAX_CHARS),
  welcome_zh: z.string().trim().min(1).max(WELCOME_MAX_CHARS),
});

export async function PATCH(req: Request) {
  const admin = await requireAdmin();
  if (!WRITE_ROLES.has(admin.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const service = createSupabaseServiceClient();
  const { data: before } = await service
    .from("whatsapp_automations")
    .select("welcome_enabled, welcome_en, welcome_zh")
    .eq("id", true)
    .maybeSingle();

  const { error } = await service
    .from("whatsapp_automations")
    .update({ ...parsed.data, updated_by: admin.id, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (error) {
    return NextResponse.json({ error: "update_failed", detail: error.message }, { status: 500 });
  }

  await writeAuditLog({
    actor_id: admin.id,
    action: "whatsapp.settings_changed",
    entity: "whatsapp_automations",
    // Single-row table with a boolean key; entity_id is a uuid column.
    entity_id: admin.id,
    before: before ?? undefined,
    after: parsed.data,
    metadata: {},
  });

  return NextResponse.json({ ok: true });
}
