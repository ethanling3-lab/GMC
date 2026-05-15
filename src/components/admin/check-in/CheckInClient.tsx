"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type {
  CheckInAbsentRow,
  CheckInGroupRow,
  CheckInRecent,
  CheckInStats,
  CheckInTimeBucket,
  CheckInVelocity,
} from "@/lib/check-in/types";
import { Sparkline } from "./Sparkline";
import { GroupCompletionCard } from "./GroupCompletionCard";
import { AbsenteeRow } from "./AbsenteeRow";

// Read-only check-in dashboard for the event organizer. The active
// scanner + manual fallback lives on the sibling `/scan` route so door
// staff can run it on a phone while the organizer keeps this view up on
// a laptop. Both surfaces poll the same backend on a 5s tick, so
// arrivals appear here within one poll cycle of the scan.

type Props = {
  eventId: string;
  eventSlug: string;
  eventTitle: string;
  eventTitleCn: string | null;
  eventStartDate: string | null;
  initialStats: CheckInStats;
  initialRecent: CheckInRecent[];
  initialVelocity: CheckInVelocity;
  initialGroups: CheckInGroupRow[];
  initialAbsent: CheckInAbsentRow[];
  initialBuckets: CheckInTimeBucket[];
};

const STATS_POLL_MS = 5000;

export function CheckInClient({
  eventId,
  eventSlug,
  eventTitle,
  eventTitleCn,
  eventStartDate,
  initialStats,
  initialRecent,
  initialVelocity,
  initialGroups,
  initialAbsent,
  initialBuckets,
}: Props) {
  const [stats, setStats] = useState<CheckInStats>(initialStats);
  const [recent, setRecent] = useState<CheckInRecent[]>(initialRecent);
  const [velocity, setVelocity] = useState<CheckInVelocity>(initialVelocity);
  const [groups, setGroups] = useState<CheckInGroupRow[]>(initialGroups);
  const [absent, setAbsent] = useState<CheckInAbsentRow[]>(initialAbsent);
  const [buckets, setBuckets] = useState<CheckInTimeBucket[]>(initialBuckets);

  const refreshStats = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/events/${eventId}/check-in`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const json = (await res.json()) as {
        stats: CheckInStats;
        recent: CheckInRecent[];
        velocity: CheckInVelocity;
        groups: CheckInGroupRow[];
        absent: CheckInAbsentRow[];
        buckets: CheckInTimeBucket[];
      };
      setStats(json.stats);
      setRecent(json.recent);
      if (json.velocity) setVelocity(json.velocity);
      if (json.groups) setGroups(json.groups);
      if (json.absent) setAbsent(json.absent);
      if (json.buckets) setBuckets(json.buckets);
    } catch {
      // Silent — next poll retries.
    }
  }, [eventId]);

  useEffect(() => {
    const t = window.setInterval(refreshStats, STATS_POLL_MS);
    return () => window.clearInterval(t);
  }, [refreshStats]);

  const pct = useMemo(() => {
    if (stats.total_eligible === 0) return 0;
    return Math.round((stats.total_checked_in / stats.total_eligible) * 100);
  }, [stats]);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
              <span className="w-5 h-px bg-current" />
              Check-in · 签到 · {eventSlug}
            </div>
            <h1 className="mt-2 font-display text-[30px] md:text-[36px] leading-[1.05] tracking-[-0.015em] text-[var(--ink)]">
              {eventTitle}
              {eventTitleCn ? (
                <span className="ml-3 text-[var(--ink-mute)] text-[22px] md:text-[26px]">
                  {eventTitleCn}
                </span>
              ) : null}
            </h1>
          </div>
          <Link
            href={`/admin/events/${eventId}/check-in/scan`}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 inline-flex items-center gap-2 h-10 px-4 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] text-[var(--paper)] text-[12px] tracking-[0.04em] font-medium hover:opacity-90 transition-opacity"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="2.5" y="2.5" width="4" height="4" rx="0.5" />
              <rect x="9.5" y="2.5" width="4" height="4" rx="0.5" />
              <rect x="2.5" y="9.5" width="4" height="4" rx="0.5" />
              <path d="M9.5 9.5h2v2M13.5 9.5v.01M9.5 13.5h.01M11.5 13.5h2" />
            </svg>
            Open scanner · 打开扫码
          </Link>
        </div>

        {/* Live counter + velocity cluster */}
        <div className="mt-2 flex flex-wrap items-end gap-x-8 gap-y-3">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-[44px] md:text-[56px] leading-none tracking-[-0.02em] text-[var(--ink)] tabular-nums">
              {stats.total_checked_in}
            </span>
            <span className="text-[var(--ink-faint)] text-[15px] tabular-nums">
              / {stats.total_eligible}
            </span>
            <span className="ml-2 inline-flex items-center h-[24px] px-2.5 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] text-[var(--paper)] text-[11px] tracking-[0.04em] font-medium tabular-nums">
              {pct}%
            </span>
          </div>
          <VelocityCluster velocity={velocity} />
          <div className="text-[10.5px] tracking-[0.22em] uppercase text-[var(--ink-faint)] ml-auto">
            Face {stats.by_method.face_match} · Manual {stats.by_method.manual}
            {stats.by_method.qr > 0 ? ` · QR ${stats.by_method.qr}` : null}
          </div>
        </div>
      </div>

      {/* Dashboard row 1: sparkline + per-group grid */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-6">
        <section className="bg-[var(--paper-warm)] border border-[var(--paper-deep)] rounded-[var(--radius-card)] shadow-[var(--shadow-paper)] overflow-hidden">
          <div className="px-5 pt-4 pb-1 flex items-end justify-between gap-3">
            <div className="text-[10.5px] tracking-[0.22em] uppercase text-[var(--cinnabar)]">
              Arrival curve · 到场趋势
            </div>
            {eventStartDate ? (
              <div className="text-[10px] tracking-[0.18em] uppercase text-[var(--ink-faint)] tabular-nums">
                Doors {formatEventStartTime(eventStartDate)}
              </div>
            ) : null}
          </div>
          <div className="px-5 pb-4 pt-2">
            <Sparkline buckets={buckets} hint="Last 2h · 5-min buckets" />
          </div>
        </section>

        <section className="bg-[var(--paper-warm)] border border-[var(--paper-deep)] rounded-[var(--radius-card)] shadow-[var(--shadow-paper)] overflow-hidden flex flex-col min-h-0">
          <div className="px-5 pt-4 pb-2 flex items-baseline justify-between gap-3">
            <div className="text-[10.5px] tracking-[0.22em] uppercase text-[var(--cinnabar)]">
              Groups · 小组进度
            </div>
            <div className="text-[10.5px] tracking-[0.12em] uppercase text-[var(--ink-faint)] tabular-nums">
              {groupsSettledCount(groups)} / {groups.length} settled
            </div>
          </div>
          <div className="px-4 pb-4 pt-1 overflow-y-auto max-h-[440px]">
            {groups.length === 0 ? (
              <div className="py-8 text-center text-[12px] text-[var(--ink-faint)]">
                No groups yet · 未分组
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {groups.map((g) => (
                  <GroupCompletionCard key={g.group_id} row={g} />
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Dashboard row 2: absentee chase list */}
      <section className="bg-[var(--paper-warm)] border border-[var(--paper-deep)] rounded-[var(--radius-card)] shadow-[var(--shadow-paper)] overflow-hidden">
        <div className="px-5 pt-4 pb-2 flex items-baseline justify-between gap-3">
          <div className="text-[10.5px] tracking-[0.22em] uppercase text-[var(--cinnabar)]">
            Not yet here · 未到场
          </div>
          <div className="text-[10.5px] tracking-[0.12em] uppercase text-[var(--ink-faint)] tabular-nums">
            {absent.length} {absent.length === 50 ? "shown · top 50" : "remaining"}
          </div>
        </div>
        {absent.length === 0 ? (
          <div className="px-5 py-10 text-center text-[12.5px] text-[var(--ink-faint)]">
            Everyone's in · 全员到齐 🎉
          </div>
        ) : (
          <ul className="divide-y divide-[var(--paper-deep)]/70 max-h-[520px] overflow-y-auto">
            {absent.map((row) => (
              <AbsenteeRow key={row.enrollment_id} row={row} />
            ))}
          </ul>
        )}
      </section>

      {/* Recent log */}
      <section className="bg-[var(--paper-warm)] border border-[var(--paper-deep)] rounded-[var(--radius-card)] shadow-[var(--shadow-paper)] overflow-hidden">
        <div className="px-5 pt-4 pb-2 text-[10.5px] tracking-[0.22em] uppercase text-[var(--cinnabar)]">
          Recent · 最新签到
        </div>
        {recent.length === 0 ? (
          <div className="px-5 py-8 text-center text-[12px] text-[var(--ink-faint)]">
            No check-ins yet · 还没有签到
          </div>
        ) : (
          <ul className="divide-y divide-[var(--paper-deep)]/70">
            {recent.map((r) => (
              <li
                key={r.enrollment_id + r.checked_in_at}
                className="px-5 py-2.5 flex items-center gap-3 text-[12.5px] hover:bg-[var(--paper)]/40 transition-colors"
              >
                <span
                  className="inline-flex items-center justify-center h-[22px] min-w-[44px] px-2 rounded-[var(--radius-pill)] bg-[var(--paper-deep)] text-[10.5px] tracking-[0.04em] font-medium text-[var(--ink-mute)] tabular-nums"
                  title="Region ID"
                >
                  {r.region_id ?? "—"}
                </span>
                <span className="font-medium text-[var(--ink)] flex-1 min-w-0 truncate">
                  {r.name_cn ?? r.name_en ?? "(unnamed)"}
                </span>
                {r.group_no !== null ? (
                  <span className="text-[var(--ink-soft)] text-[11px] tracking-[0.08em] uppercase tabular-nums">
                    Group {r.group_no}
                  </span>
                ) : null}
                <span className="text-[var(--ink-faint)] text-[10.5px] tracking-[0.06em] tabular-nums">
                  {formatTime(r.checked_in_at)}
                </span>
                <span
                  className={
                    "inline-flex items-center h-[18px] px-1.5 rounded-[var(--radius-pill)] text-[9.5px] tracking-[0.08em] uppercase tabular-nums " +
                    (r.method === "qr"
                      ? "bg-[var(--cinnabar)]/12 text-[var(--cinnabar)]"
                      : "bg-[var(--paper-deep)] text-[var(--ink-mute)]")
                  }
                >
                  {r.method}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// -- Helpers ----------------------------------------------------------------

function groupsSettledCount(groups: CheckInGroupRow[]): number {
  let n = 0;
  for (const g of groups) {
    if (g.expected_count > 0 && g.checked_in_count >= g.expected_count) n += 1;
  }
  return n;
}

function formatEventStartTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "—";
  }
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "—";
  }
}

function VelocityCluster({ velocity }: { velocity: CheckInVelocity }) {
  const etaLabel = velocity.eta_iso
    ? new Date(velocity.eta_iso).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : null;
  return (
    <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
      <div className="flex items-baseline gap-1.5">
        <span className="text-[10px] tracking-[0.18em] uppercase text-[var(--ink-faint)]">
          15 min
        </span>
        <span className="font-display text-[18px] text-[var(--ink)] tabular-nums leading-none">
          {velocity.last_15min}
        </span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[10px] tracking-[0.18em] uppercase text-[var(--ink-faint)]">
          60 min
        </span>
        <span className="font-display text-[18px] text-[var(--ink)] tabular-nums leading-none">
          {velocity.last_60min}
        </span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[10px] tracking-[0.18em] uppercase text-[var(--ink-faint)]">
          ETA
        </span>
        <span
          className={
            "font-display text-[18px] tabular-nums leading-none " +
            (etaLabel ? "text-[var(--ink)]" : "text-[var(--ink-faint)]")
          }
        >
          {etaLabel ?? "—"}
        </span>
      </div>
    </div>
  );
}
