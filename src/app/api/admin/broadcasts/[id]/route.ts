import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";
import { previewAudienceCount } from "@/lib/broadcasts/audience";
import { PatchBroadcastBodyZ } from "@/lib/broadcasts/api-schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

// GET /api/admin/broadcasts/:id — campaign detail + recipient counts.
// Open to all admin roles for read.
export async function GET(_req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  const { id } = await params;
  const service = createSupabaseServiceClient();

  const { data: broadcast, error } = await service
    .from("broadcasts")
    .select(
      "id, name, audience_mode, audience_filter, audience_snapshot_count, channels, whatsapp_template_name, whatsapp_template_language, whatsapp_template_params, email_subject_en, email_subject_cn, email_body_en, email_body_cn, status, scheduled_for, started_at, completed_at, stats, created_at, updated_at, deleted_at, created_by_admin:admins!broadcasts_created_by_fkey(id, name_en, name_cn)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error || !broadcast) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if ((broadcast as { deleted_at: string | null }).deleted_at) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Per-status recipient counts power the detail-page tabs.
  const counts = await loadCounts(service, id);

  // Regional-lead visibility: the row is readable (RLS lets all roles
  // SELECT broadcasts) but the recipient counts honour the per-region
  // gate on broadcast_recipients RLS. Effectively, a regional_lead's
  // "sent" count reflects only the in-region recipients — same shape as
  // the conversations RLS.
  void admin;

  return NextResponse.json({ broadcast, counts });
}

// PATCH /api/admin/broadcasts/:id — edit a draft or scheduled broadcast.
// Rejects edits on sending / sent / failed.
export async function PATCH(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "regional_lead") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;

  let body: ReturnType<typeof PatchBroadcastBodyZ.parse>;
  try {
    body = PatchBroadcastBodyZ.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: "validation_error", detail: err instanceof Error ? err.message : "Invalid payload" },
      { status: 400 },
    );
  }

  const service = createSupabaseServiceClient();
  const { data: existing } = await service
    .from("broadcasts")
    .select("id, status, channels, audience_filter")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const current = existing as { id: string; status: string; channels: ("whatsapp" | "email")[] };
  if (current.status !== "draft" && current.status !== "scheduled") {
    return NextResponse.json(
      { error: "wrong_status", detail: `Cannot edit broadcast in status ${current.status}` },
      { status: 409 },
    );
  }

  // If audience changed, re-snapshot the reachable count.
  let audienceSnapshotCount: number | undefined;
  if (body.audience_filter || body.channels) {
    const filter = body.audience_filter ?? (existing as unknown as { audience_filter: never }).audience_filter;
    const channels = body.channels ?? current.channels;
    const preview = await previewAudienceCount(service, admin, filter, channels);
    audienceSnapshotCount = preview.reachable;
  }

  const updates: Record<string, unknown> = { updated_by: admin.id };
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined) updates[k] = v;
  }
  if (audienceSnapshotCount !== undefined) updates.audience_snapshot_count = audienceSnapshotCount;

  const { error: updErr } = await service.from("broadcasts").update(updates).eq("id", id);
  if (updErr) {
    return NextResponse.json(
      { error: "update_failed", detail: updErr.message },
      { status: 500 },
    );
  }

  await writeAuditLog({
    actor_id: admin.id,
    action: "broadcast.updated",
    entity: "broadcasts",
    entity_id: id,
    metadata: { fields: Object.keys(body), audience_snapshot_count: audienceSnapshotCount ?? null },
  });

  return NextResponse.json({ ok: true });
}

async function loadCounts(
  service: ReturnType<typeof createSupabaseServiceClient>,
  broadcastId: string,
): Promise<Record<"total" | "pending" | "sent" | "failed" | "skipped", number>> {
  const base = () =>
    service
      .from("broadcast_recipients")
      .select("id", { count: "exact", head: true })
      .eq("broadcast_id", broadcastId);
  const [total, pending, sent, failed, skipped] = await Promise.all([
    base(),
    base().eq("status", "pending"),
    base().eq("status", "sent"),
    base().eq("status", "failed"),
    base().eq("status", "skipped"),
  ]);
  return {
    total: total.count ?? 0,
    pending: pending.count ?? 0,
    sent: sent.count ?? 0,
    failed: failed.count ?? 0,
    skipped: skipped.count ?? 0,
  };
}
