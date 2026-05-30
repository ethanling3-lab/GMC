import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminContext } from "@/lib/admin-guard";
import {
  BROADCAST_STATUS_VALUES,
  emptyBroadcastStats,
  type AudienceFilter,
  type BroadcastListRow,
  type BroadcastStats,
  type BroadcastStatus,
} from "./types";
import { buildAudienceSummary } from "./audience";

// URL-state filter shape — mirrors the inbox-query / participants-query
// convention (parseFilters + loadX + small count helpers).

export type BroadcastsListFilters = {
  status: BroadcastStatus | null;
  q: string;
};

export function parseFilters(
  sp: URLSearchParams | Record<string, string | string[] | undefined>,
): BroadcastsListFilters {
  const get = (k: string): string | undefined => {
    if (sp instanceof URLSearchParams) return sp.get(k) ?? undefined;
    const v = sp[k];
    if (Array.isArray(v)) return v[0];
    return v ?? undefined;
  };
  const statusRaw = get("status");
  const status =
    statusRaw && (BROADCAST_STATUS_VALUES as readonly string[]).includes(statusRaw)
      ? (statusRaw as BroadcastStatus)
      : null;
  const q = (get("q") ?? "").trim();
  return { status, q };
}

export async function loadBroadcasts(
  service: SupabaseClient,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _admin: AdminContext,
  filters: BroadcastsListFilters,
): Promise<BroadcastListRow[]> {
  let q = service
    .from("broadcasts")
    .select(
      "id, name, audience_mode, audience_filter, audience_snapshot_count, channels, status, scheduled_for, started_at, completed_at, stats, created_at, created_by_admin:admins!broadcasts_created_by_fkey(id, name_en, name_cn)",
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(200);

  if (filters.status) q = q.eq("status", filters.status);
  if (filters.q) {
    const needle = `%${filters.q.replace(/[%_]/g, "\\$&")}%`;
    q = q.ilike("name", needle);
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  // Collect event_ids referenced by event_cohort broadcasts so we can
  // hydrate the audience summary string with event titles.
  const eventIds = new Set<string>();
  for (const row of (data ?? []) as unknown as Array<RawBroadcastRow>) {
    if (row.audience_mode === "event_cohort") {
      const f = row.audience_filter as unknown as AudienceFilter;
      if (f.mode === "event_cohort" && f.event_id) eventIds.add(f.event_id);
    }
  }
  const eventTitles = eventIds.size > 0 ? await loadEventTitles(service, [...eventIds]) : new Map();

  return ((data ?? []) as unknown as Array<RawBroadcastRow>).map((row) => {
    const filter = row.audience_filter as unknown as AudienceFilter;
    const eventTitle =
      filter.mode === "event_cohort" ? eventTitles.get(filter.event_id) ?? null : null;
    return {
      id: row.id,
      name: row.name,
      audience_mode: row.audience_mode,
      audience_summary: buildAudienceSummary(filter, eventTitle),
      audience_snapshot_count: row.audience_snapshot_count,
      channels: row.channels,
      status: row.status,
      scheduled_for: row.scheduled_for,
      started_at: row.started_at,
      completed_at: row.completed_at,
      stats: mergeStats(row.stats),
      created_by: row.created_by_admin
        ? {
            id: row.created_by_admin.id,
            name_en: row.created_by_admin.name_en,
            name_cn: row.created_by_admin.name_cn,
          }
        : null,
      created_at: row.created_at,
    };
  });
}

export async function loadBroadcastsStatusCounts(
  service: SupabaseClient,
): Promise<Record<BroadcastStatus | "all", number>> {
  const base = () =>
    service.from("broadcasts").select("id", { count: "exact", head: true }).is("deleted_at", null);
  const queries = await Promise.all([
    base(),
    base().eq("status", "draft"),
    base().eq("status", "scheduled"),
    base().eq("status", "sending"),
    base().eq("status", "sent"),
    base().eq("status", "partial"),
    base().eq("status", "cancelled"),
    base().eq("status", "failed"),
  ]);
  return {
    all: queries[0].count ?? 0,
    draft: queries[1].count ?? 0,
    scheduled: queries[2].count ?? 0,
    sending: queries[3].count ?? 0,
    sent: queries[4].count ?? 0,
    partial: queries[5].count ?? 0,
    cancelled: queries[6].count ?? 0,
    failed: queries[7].count ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

type RawBroadcastRow = {
  id: string;
  name: string;
  audience_mode: BroadcastListRow["audience_mode"];
  audience_filter: Record<string, unknown>;
  audience_snapshot_count: number;
  channels: BroadcastListRow["channels"];
  status: BroadcastStatus;
  scheduled_for: string | null;
  started_at: string | null;
  completed_at: string | null;
  stats: Record<string, unknown>;
  created_at: string;
  created_by_admin: { id: string; name_en: string | null; name_cn: string | null } | null;
};

async function loadEventTitles(
  service: SupabaseClient,
  ids: string[],
): Promise<Map<string, string>> {
  const { data, error } = await service
    .from("events")
    .select("id, title_en, title_cn")
    .in("id", ids);
  if (error) throw new Error(error.message);
  const out = new Map<string, string>();
  for (const row of (data ?? []) as Array<{ id: string; title_en: string | null; title_cn: string | null }>) {
    out.set(row.id, row.title_en ?? row.title_cn ?? row.id.slice(0, 8));
  }
  return out;
}

function mergeStats(raw: Record<string, unknown>): BroadcastStats {
  const base = emptyBroadcastStats();
  return {
    queued: numOr(raw.queued, base.queued),
    sent: numOr(raw.sent, base.sent),
    failed: numOr(raw.failed, base.failed),
    skipped: numOr(raw.skipped, base.skipped),
  };
}

function numOr(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && Number.isFinite(Number(v))) return Number(v);
  return fallback;
}
