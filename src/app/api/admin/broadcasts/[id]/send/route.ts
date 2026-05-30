import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";
import { materialiseRecipients } from "@/lib/broadcasts/materialize";
import { kickBroadcastFanout } from "@/lib/broadcasts/kick-fanout";
import type { AudienceFilter, BroadcastChannel } from "@/lib/broadcasts/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

// POST /api/admin/broadcasts/:id/send — fire (or refire) a broadcast.
//
// Flow:
//   1. Validate role + load the broadcast.
//   2. Re-resolve the audience as of NOW and upsert pending
//      broadcast_recipients rows. Unique constraint dedupes against
//      already-sent / already-failed rows from prior runs.
//   3. Flip status draft|scheduled → sending.
//   4. Kick the Netlify background function (fire-and-forget).
//   5. Return 202 + queue depth.
export async function POST(_req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "regional_lead") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;

  const service = createSupabaseServiceClient();
  const { data: broadcast, error } = await service
    .from("broadcasts")
    .select("id, status, audience_mode, audience_filter, channels, name")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !broadcast) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const row = broadcast as unknown as {
    id: string;
    status: string;
    audience_mode: "event_cohort" | "participant_master";
    audience_filter: AudienceFilter;
    channels: BroadcastChannel[];
    name: string;
  };

  if (row.status !== "draft" && row.status !== "scheduled" && row.status !== "partial") {
    return NextResponse.json(
      { error: "wrong_status", detail: `Cannot send broadcast in status ${row.status}` },
      { status: 409 },
    );
  }

  const { queued, total_pending } = await materialiseRecipients(service, admin, {
    id: row.id,
    audience_mode: row.audience_mode,
    audience_filter: row.audience_filter,
    channels: row.channels,
  });

  if (total_pending === 0) {
    return NextResponse.json(
      { error: "empty_audience", detail: "No reachable recipients to send to" },
      { status: 422 },
    );
  }

  await service
    .from("broadcasts")
    .update({
      status: "sending",
      started_at: new Date().toISOString(),
      updated_by: admin.id,
    })
    .eq("id", id);

  const kick = await kickBroadcastFanout(id);

  await writeAuditLog({
    actor_id: admin.id,
    action: "broadcast.sent",
    entity: "broadcasts",
    entity_id: id,
    metadata: {
      queued,
      total_pending,
      kick_mocked: kick.mocked,
      kick_status: kick.status,
      kick_error: kick.error ?? null,
    },
  });

  return NextResponse.json(
    { ok: true, queued, total_pending, kick },
    { status: 202 },
  );
}
