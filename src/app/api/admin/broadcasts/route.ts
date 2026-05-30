import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";
import { previewAudienceCount } from "@/lib/broadcasts/audience";
import { CreateBroadcastBodyZ } from "@/lib/broadcasts/api-schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/admin/broadcasts — create a draft broadcast.
// Role-gated to super_admin | regional_lead (CS / instructor / finance
// are read-only on this surface).
export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "regional_lead") {
    return NextResponse.json(
      { error: "forbidden", detail: "Only super / regional leads can create broadcasts" },
      { status: 403 },
    );
  }

  let body: ReturnType<typeof CreateBroadcastBodyZ.parse>;
  try {
    body = CreateBroadcastBodyZ.parse(await req.json());
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid payload";
    return NextResponse.json({ error: "validation_error", detail: msg }, { status: 400 });
  }

  const service = createSupabaseServiceClient();

  // Resolve audience to capture the snapshot count at create time.
  // The actual fan-out re-resolves at send-time so a draft saved today
  // and sent next week picks up new enrolments.
  const preview = await previewAudienceCount(
    service,
    admin,
    body.audience_filter,
    body.channels,
  );

  const { data, error } = await service
    .from("broadcasts")
    .insert({
      name: body.name,
      audience_mode: body.audience_mode,
      audience_filter: body.audience_filter,
      audience_snapshot_count: preview.reachable,
      channels: body.channels,
      whatsapp_template_name: body.whatsapp_template_name ?? null,
      whatsapp_template_language: body.whatsapp_template_language ?? null,
      whatsapp_template_params: body.whatsapp_template_params ?? null,
      email_subject_en: body.email_subject_en ?? null,
      email_subject_cn: body.email_subject_cn ?? null,
      email_body_en: body.email_body_en ?? null,
      email_body_cn: body.email_body_cn ?? null,
      status: "draft",
      created_by: admin.id,
      updated_by: admin.id,
    })
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "insert_failed", detail: error?.message ?? "unknown" },
      { status: 500 },
    );
  }

  await writeAuditLog({
    actor_id: admin.id,
    action: "broadcast.created",
    entity: "broadcasts",
    entity_id: data.id,
    metadata: {
      audience_mode: body.audience_mode,
      channels: body.channels,
      audience_snapshot_count: preview.reachable,
    },
  });

  return NextResponse.json(
    {
      id: data.id,
      audience_preview: preview,
    },
    { status: 201 },
  );
}
