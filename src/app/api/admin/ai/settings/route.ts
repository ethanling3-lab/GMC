import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { flushAiSettings } from "@/lib/ai/settings";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// PATCH /api/admin/ai/settings — change the global AI controls.
//
// Deliberately open to super_admin AND regional_lead. This is the kill switch;
// at 2am the person who needs it is whoever is awake, and a switch only one
// person can reach is a switch that doesn't get pulled.

const WRITE_ROLES = ["super_admin", "regional_lead"] as const;

const Body = z.object({
  ai_enabled: z.boolean().optional(),
  // Null clears the cap. Explicitly allowed, but the UI warns — an uncapped
  // AI answering strangers is how one scripted attacker becomes an invoice.
  daily_cost_cap_cents: z.number().int().positive().max(1_000_000).nullable().optional(),
  max_replies_per_conversation_hour: z.number().int().positive().max(1000).optional(),
  max_replies_per_conversation_day: z.number().int().positive().max(10_000).optional(),
});

export async function PATCH(req: Request) {
  const admin = await requireAdmin();
  if (!(WRITE_ROLES as readonly string[]).includes(admin.role)) {
    return NextResponse.json(
      { error: "forbidden", detail: "Only super admins and regional leads can change AI settings" },
      { status: 403 },
    );
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid payload";
    return NextResponse.json({ error: "validation_error", detail: msg }, { status: 400 });
  }

  if (Object.keys(body).length === 0) {
    return NextResponse.json({ error: "validation_error", detail: "No fields to update" }, { status: 400 });
  }

  const service = createSupabaseServiceClient();

  const { data: before } = await service
    .from("ai_settings")
    .select("*")
    .eq("scope", "global")
    .maybeSingle();

  const { data: after, error } = await service
    .from("ai_settings")
    .update({ ...body, updated_by: admin.id, updated_at: new Date().toISOString() })
    .eq("scope", "global")
    .select()
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Drop the memo so the change lands immediately on this instance. Other
  // Netlify instances pick it up within the 20s TTL — that is the honest
  // worst case, and the UI says so rather than claiming "instant".
  flushAiSettings();

  await writeAuditLog({
    actor_id: admin.id,
    action: "ai.settings_changed",
    entity: "ai_settings",
    entity_id: (after?.id as string) ?? null,
    before: before ?? undefined,
    after: after ?? undefined,
    metadata: { fields: Object.keys(body) },
  });

  return NextResponse.json({ ok: true, settings: after });
}
