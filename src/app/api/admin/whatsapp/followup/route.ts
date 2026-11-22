import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";
import { FOLLOWUP_DAY_OPTIONS } from "@/lib/whatsapp/automations-types";
import { WHATSAPP_WRITE_ROLES } from "@/lib/whatsapp/faq-schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({
  enabled: z.boolean(),
  after_days: z
    .number()
    .int()
    .refine((n) => (FOLLOWUP_DAY_OPTIONS as readonly number[]).includes(n)),
});

// PATCH /api/admin/whatsapp/followup — the payment reminder settings.
export async function PATCH(req: Request) {
  const admin = await requireAdmin();
  if (!WHATSAPP_WRITE_ROLES.has(admin.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const service = createSupabaseServiceClient();
  const { data: before, error: readErr } = await service
    .from("whatsapp_automations")
    .select("followup_enabled, followup_after_days, followup_enabled_at")
    .eq("id", true)
    .maybeSingle();
  if (readErr || !before) {
    return NextResponse.json({ error: "read_failed", detail: readErr?.message }, { status: 500 });
  }

  // Each time it's switched on, the start line moves to now: nobody approved
  // earlier is swept up in a surprise batch.
  const turningOn = parsed.data.enabled && !before.followup_enabled;
  const after = {
    followup_enabled: parsed.data.enabled,
    followup_after_days: parsed.data.after_days,
    followup_enabled_at: turningOn ? new Date().toISOString() : before.followup_enabled_at,
  };

  const { error } = await service
    .from("whatsapp_automations")
    .update({ ...after, updated_by: admin.id, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (error) {
    return NextResponse.json({ error: "update_failed", detail: error.message }, { status: 500 });
  }
  await writeAuditLog({
    actor_id: admin.id,
    action: "whatsapp.settings_changed",
    entity: "whatsapp_automations",
    entity_id: admin.id,
    before,
    after,
    metadata: {},
  });
  return NextResponse.json({ ok: true });
}
