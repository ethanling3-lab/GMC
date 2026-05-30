import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { materialiseRecipients } from "@/lib/broadcasts/materialize";
import { kickBroadcastFanout } from "@/lib/broadcasts/kick-fanout";
import { writeAuditLog } from "@/lib/audit";
import type { AudienceFilter, BroadcastChannel } from "@/lib/broadcasts/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Triggered every 5 min by netlify/functions/cron-broadcasts-due.mts.
// Scans broadcasts where status='scheduled' AND scheduled_for <= now(),
// materialises pending recipients (re-resolving the audience as of NOW),
// flips status to 'sending', and kicks the broadcast-fanout-background
// function for each.
//
// Auth: `Authorization: Bearer ${CRON_SECRET}` — same gate as the
// M7.2 reminders cron. Without the env var, dev-mode allows unsigned
// requests for local smoking; production refuses.

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function isAuthorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  return timingSafeEqual(match[1], secret);
}

async function handle(req: Request): Promise<Response> {
  if (!isAuthorised(req)) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  try {
    const service = createSupabaseServiceClient();
    const nowIso = new Date().toISOString();
    const { data: due, error } = await service
      .from("broadcasts")
      .select(
        "id, name, audience_mode, audience_filter, channels, created_by, scheduled_for",
      )
      .eq("status", "scheduled")
      .lte("scheduled_for", nowIso)
      .is("deleted_at", null)
      .limit(50);
    if (error) throw new Error(error.message);

    const rows = (due ?? []) as Array<{
      id: string;
      name: string;
      audience_mode: "event_cohort" | "participant_master";
      audience_filter: AudienceFilter;
      channels: BroadcastChannel[];
      created_by: string;
      scheduled_for: string;
    }>;

    const fired: Array<{ id: string; queued: number; total_pending: number; kick_status: number | null }> = [];
    const skipped: Array<{ id: string; reason: string }> = [];

    for (const row of rows) {
      // Use the creator as the actor — they own the campaign. (We
      // could spoof a super-admin role here for audience resolution,
      // but reusing the creator preserves regional-lead gating which
      // is the safer default.)
      const { data: actor } = await service
        .from("admins")
        .select("id, role, region, email, name_cn, name_en")
        .eq("id", row.created_by)
        .maybeSingle();
      if (!actor) {
        skipped.push({ id: row.id, reason: "creator_missing" });
        continue;
      }
      const adminCtx = {
        id: actor.id,
        email: (actor as { email: string | null }).email ?? "",
        name_cn: (actor as { name_cn: string | null }).name_cn,
        name_en: (actor as { name_en: string | null }).name_en,
        role: (actor as {
          role:
            | "super_admin"
            | "regional_lead"
            | "customer_service"
            | "finance"
            | "instructor";
        }).role,
        region: (actor as { region: string | null }).region,
      };

      const { queued, total_pending } = await materialiseRecipients(service, adminCtx, {
        id: row.id,
        audience_mode: row.audience_mode,
        audience_filter: row.audience_filter,
        channels: row.channels,
      });
      if (total_pending === 0) {
        await service
          .from("broadcasts")
          .update({
            status: "failed",
            completed_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        skipped.push({ id: row.id, reason: "empty_audience" });
        continue;
      }
      await service
        .from("broadcasts")
        .update({ status: "sending", started_at: new Date().toISOString() })
        .eq("id", row.id);
      const kick = await kickBroadcastFanout(row.id);
      fired.push({ id: row.id, queued, total_pending, kick_status: kick.status });

      await writeAuditLog({
        actor_id: row.created_by,
        action: "broadcast.sent",
        entity: "broadcasts",
        entity_id: row.id,
        metadata: {
          via: "cron",
          queued,
          total_pending,
          scheduled_for: row.scheduled_for,
        },
      });
    }

    return NextResponse.json({ fired, skipped, total: rows.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[cron/broadcasts-due]", msg);
    return NextResponse.json({ error: "server_error", detail: msg }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
