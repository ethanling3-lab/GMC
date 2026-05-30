import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import {
  loadBroadcasts,
  loadBroadcastsStatusCounts,
  parseFilters,
} from "@/lib/broadcasts/broadcasts-query";
import { BROADCAST_STATUS_VALUES, type BroadcastStatus } from "@/lib/broadcasts/types";
import { BroadcastStatusPill, BroadcastChannelPill } from "@/components/admin/broadcasts/BroadcastStatusPill";

export const metadata: Metadata = { title: "Broadcasts" };
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const STATUS_TAB_ORDER: Array<BroadcastStatus | "all"> = [
  "all",
  "draft",
  "scheduled",
  "sending",
  "sent",
  "partial",
  "failed",
];

const STATUS_TAB_LABEL: Record<BroadcastStatus | "all", { en: string; cn: string }> = {
  all: { en: "All", cn: "全部" },
  draft: { en: "Drafts", cn: "草稿" },
  scheduled: { en: "Scheduled", cn: "已排程" },
  sending: { en: "Sending", cn: "发送中" },
  sent: { en: "Sent", cn: "已送达" },
  partial: { en: "Partial", cn: "部分" },
  cancelled: { en: "Cancelled", cn: "已取消" },
  failed: { en: "Failed", cn: "失败" },
};

export default async function BroadcastsIndexPage({ searchParams }: PageProps) {
  const admin = await requireAdmin();
  if (
    admin.role !== "super_admin" &&
    admin.role !== "regional_lead" &&
    admin.role !== "customer_service" &&
    admin.role !== "instructor" &&
    admin.role !== "finance"
  ) {
    redirect("/admin");
  }

  const sp = await searchParams;
  const filters = parseFilters(sp);
  const supabase = await createSupabaseServerClient();
  const [broadcasts, counts] = await Promise.all([
    loadBroadcasts(supabase, admin, filters),
    loadBroadcastsStatusCounts(supabase),
  ]);

  const canCreate = admin.role === "super_admin" || admin.role === "regional_lead";

  return (
    <div>
      <div className="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
            <span className="w-5 h-px bg-current" />
            Communication · 群发
          </div>
          <h1 className="mt-4 font-display text-[36px] md:text-[40px] leading-[1.05] tracking-[-0.015em] text-[var(--ink)]">
            Reach the whole cohort, on cue.
          </h1>
          <p className="mt-4 max-w-[62ch] text-[14.5px] leading-[1.7] text-[var(--ink-soft)]">
            Send WhatsApp and email campaigns to event enrolment cohorts or to
            filtered participant audiences. Every send mirrors into the
            recipient&apos;s inbox thread so replies land back in context.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-[9px] tracking-[0.28em] uppercase text-[var(--ink-faint)]">
              In flight · 进行中
            </div>
            <div className="mt-1 font-display text-[20px] leading-[1.1] text-[var(--ink)] tabular-nums">
              {counts.scheduled + counts.sending}
            </div>
          </div>
          {canCreate ? (
            <Link
              href="/admin/broadcasts/new"
              className="inline-flex items-center gap-2 px-4 h-10 rounded-[var(--radius-md)] bg-[var(--cinnabar)] text-[var(--paper-warm)] text-[12.5px] tracking-[0.06em] uppercase hover:bg-[var(--cinnabar-deep)] transition-colors"
              style={{ color: "var(--paper-warm)" }}
            >
              + New broadcast
            </Link>
          ) : null}
        </div>
      </div>

      <nav className="mt-8 flex gap-1 flex-wrap" aria-label="Status filter">
        {STATUS_TAB_ORDER.map((s) => {
          const active = (filters.status ?? "all") === s;
          const count = counts[s];
          const href = s === "all" ? "/admin/broadcasts" : `/admin/broadcasts?status=${s}`;
          return (
            <Link
              key={s}
              href={href}
              className={`inline-flex items-center gap-1.5 px-3 h-8 rounded-[var(--radius-pill)] border text-[11px] tracking-[0.12em] uppercase tabular-nums transition-colors ${
                active
                  ? "border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
                  : "border-[var(--paper-shadow)] bg-[var(--paper-warm)] text-[var(--ink-soft)] hover:bg-[var(--paper-deep)]"
              }`}
              style={{ color: active ? "var(--cinnabar-deep)" : "var(--ink-soft)" }}
            >
              <span>{STATUS_TAB_LABEL[s].en}</span>
              <span className="text-[var(--ink-faint)]">·</span>
              <span>{count}</span>
            </Link>
          );
        })}
      </nav>

      <section className="mt-6 rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] p-6 shadow-[var(--shadow-paper-1)]">
        {broadcasts.length === 0 ? (
          <p className="text-[13px] leading-[1.7] text-[var(--ink-mute)]">
            No broadcasts in this view yet.{" "}
            {canCreate ? (
              <Link
                href="/admin/broadcasts/new"
                className="text-[var(--cinnabar-deep)] hover:text-[var(--cinnabar)]"
                style={{ color: "var(--cinnabar-deep)" }}
              >
                Compose a new one
              </Link>
            ) : (
              "Super or regional admins can compose one."
            )}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="text-left text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
                  <th className="pb-3 font-normal">Name · Audience</th>
                  <th className="pb-3 font-normal">Channels</th>
                  <th className="pb-3 font-normal">Audience</th>
                  <th className="pb-3 font-normal">Stats</th>
                  <th className="pb-3 font-normal">Scheduled / Sent</th>
                  <th className="pb-3 font-normal">Status</th>
                </tr>
              </thead>
              <tbody>
                {broadcasts.map((b) => (
                  <tr
                    key={b.id}
                    className="border-t border-[var(--paper-shadow)] hover:bg-[var(--paper-deep)]/50 transition-colors"
                  >
                    <td className="py-3 pr-4 max-w-[320px]">
                      <Link
                        href={`/admin/broadcasts/${b.id}`}
                        className="text-[13.5px] text-[var(--ink)] leading-[1.3] hover:text-[var(--cinnabar)] transition-colors"
                        style={{ color: "inherit" }}
                      >
                        <span className="hover:text-[var(--cinnabar)] transition-colors block truncate">
                          {b.name}
                        </span>
                      </Link>
                      <div className="mt-0.5 text-[10.5px] tracking-[0.14em] uppercase text-[var(--ink-faint)] truncate">
                        {b.audience_summary}
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex gap-1 flex-wrap">
                        {b.channels.map((c) => (
                          <BroadcastChannelPill key={c} channel={c} />
                        ))}
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <span className="font-display text-[16px] tabular-nums text-[var(--ink)]">
                        {b.audience_snapshot_count}
                      </span>
                      <span className="ml-1 text-[10px] tracking-[0.18em] uppercase text-[var(--ink-faint)]">
                        pax
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-[12px] text-[var(--ink-soft)] tabular-nums leading-[1.4]">
                      <StatsCell stats={b.stats} />
                    </td>
                    <td className="py-3 pr-4 text-[11.5px] text-[var(--ink-soft)] tabular-nums leading-[1.4]">
                      <ScheduleCell b={b} />
                    </td>
                    <td className="py-3">
                      <BroadcastStatusPill status={b.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function StatsCell({ stats }: { stats: { sent: number; failed: number; skipped: number } }) {
  if (stats.sent === 0 && stats.failed === 0 && stats.skipped === 0) {
    return <span className="text-[var(--ink-faint)]">—</span>;
  }
  return (
    <div className="flex gap-3">
      <span>
        <span className="text-[10px] tracking-[0.14em] uppercase text-[var(--ink-faint)] mr-1">
          ✓
        </span>
        {stats.sent}
      </span>
      {stats.failed > 0 ? (
        <span className="text-[var(--cinnabar-deep)]">
          <span className="text-[10px] tracking-[0.14em] uppercase mr-1">×</span>
          {stats.failed}
        </span>
      ) : null}
      {stats.skipped > 0 ? (
        <span className="text-[var(--ink-mute)]">
          <span className="text-[10px] tracking-[0.14em] uppercase mr-1">↷</span>
          {stats.skipped}
        </span>
      ) : null}
    </div>
  );
}

function ScheduleCell({
  b,
}: {
  b: { status: string; scheduled_for: string | null; completed_at: string | null; started_at: string | null };
}) {
  if (b.status === "scheduled" && b.scheduled_for) {
    return <span>{formatDateTime(b.scheduled_for)}</span>;
  }
  if (b.completed_at) {
    return <span>{formatDateTime(b.completed_at)}</span>;
  }
  if (b.started_at) {
    return <span>{formatDateTime(b.started_at)}</span>;
  }
  return <span className="text-[var(--ink-faint)]">—</span>;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
