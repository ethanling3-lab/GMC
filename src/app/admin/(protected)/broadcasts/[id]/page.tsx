import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { buildAudienceSummary } from "@/lib/broadcasts/audience";
import {
  BROADCAST_RECIPIENT_STATUS_LABEL,
  BROADCAST_ERROR_CODE_LABEL,
  type AudienceFilter,
  type BroadcastChannel,
  type BroadcastStatus,
  type BroadcastRecipientStatus,
  type BroadcastErrorCode,
  type BroadcastStats,
  emptyBroadcastStats,
} from "@/lib/broadcasts/types";
import { BroadcastStatusPill, BroadcastChannelPill } from "@/components/admin/broadcasts/BroadcastStatusPill";
import { BroadcastActionBar } from "@/components/admin/broadcasts/BroadcastActionBar";
import { RecipientsTable } from "@/components/admin/broadcasts/RecipientsTable";

export const metadata: Metadata = { title: "Broadcast detail" };
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function BroadcastDetailPage({ params, searchParams }: PageProps) {
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

  const { id } = await params;
  const sp = await searchParams;
  const recipientTab = parseRecipientTab(sp);

  const supabase = await createSupabaseServerClient();
  const { data: broadcast } = await supabase
    .from("broadcasts")
    .select(
      "id, name, audience_mode, audience_filter, audience_snapshot_count, channels, whatsapp_template_name, whatsapp_template_language, email_subject_en, email_subject_cn, status, scheduled_for, started_at, completed_at, stats, created_at, deleted_at, created_by_admin:admins!broadcasts_created_by_fkey(id, name_en, name_cn)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!broadcast) notFound();
  const b = broadcast as unknown as {
    id: string;
    name: string;
    audience_mode: "event_cohort" | "participant_master";
    audience_filter: AudienceFilter;
    audience_snapshot_count: number;
    channels: BroadcastChannel[];
    whatsapp_template_name: string | null;
    whatsapp_template_language: string | null;
    email_subject_en: string | null;
    email_subject_cn: string | null;
    status: BroadcastStatus;
    scheduled_for: string | null;
    started_at: string | null;
    completed_at: string | null;
    stats: Record<string, unknown>;
    created_at: string;
    deleted_at: string | null;
    created_by_admin: { id: string; name_en: string | null; name_cn: string | null } | null;
  };
  if (b.deleted_at) notFound();

  // Event hydration for the audience summary in event-cohort mode.
  let eventTitle: string | null = null;
  if (b.audience_filter.mode === "event_cohort") {
    const { data: ev } = await supabase
      .from("events")
      .select("title_en, title_cn")
      .eq("id", b.audience_filter.event_id)
      .maybeSingle();
    if (ev) {
      eventTitle =
        (ev as { title_en: string | null }).title_en ??
        (ev as { title_cn: string | null }).title_cn ??
        null;
    }
  }
  const audienceSummary = buildAudienceSummary(b.audience_filter, eventTitle);

  // Recipients for the current tab (paginated to 200 rows for v1).
  const { data: recipientsRaw, count: recipientCount } = await supabase
    .from("broadcast_recipients")
    .select(
      "id, participant_id, channel, target_address, status, error_code, error_message, sent_at, conversation_id, participant:participants(id, region_id, name_en, name_cn)",
      { count: "exact" },
    )
    .eq("broadcast_id", id)
    .eq("status", recipientTab)
    .order("sent_at", { ascending: false, nullsFirst: false })
    .limit(200);
  void recipientCount;
  const recipients = (recipientsRaw ?? []) as unknown as Array<{
    id: string;
    participant_id: string;
    channel: BroadcastChannel;
    target_address: string | null;
    status: BroadcastRecipientStatus;
    error_code: BroadcastErrorCode | null;
    error_message: string | null;
    sent_at: string | null;
    conversation_id: string | null;
    participant: {
      id: string;
      region_id: string | null;
      name_en: string | null;
      name_cn: string | null;
    } | null;
  }>;

  // Per-status counts for the tab bar.
  const counts = await loadCounts(supabase, id);

  const stats = mergeStats(b.stats);
  const total = stats.queued + stats.sent + stats.failed + stats.skipped;
  const sentPct = total > 0 ? Math.round((stats.sent / Math.max(stats.queued || total, 1)) * 100) : 0;

  const canManage = admin.role === "super_admin" || admin.role === "regional_lead";

  return (
    <div>
      <div className="flex items-end justify-between gap-6 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
            <Link
              href="/admin/broadcasts"
              className="hover:text-[var(--cinnabar-deep)]"
              style={{ color: "var(--cinnabar)" }}
            >
              Communication · 群发
            </Link>
            <span className="text-[var(--ink-faint)]">›</span>
            <span className="text-[var(--ink-mute)]">{b.id.slice(0, 8)}</span>
          </div>
          <h1 className="mt-4 font-display text-[32px] md:text-[36px] leading-[1.1] tracking-[-0.015em] text-[var(--ink)] truncate">
            {b.name}
          </h1>
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <BroadcastStatusPill status={b.status} />
            <div className="flex gap-1">
              {b.channels.map((c) => (
                <BroadcastChannelPill key={c} channel={c} />
              ))}
            </div>
            <span className="text-[11.5px] text-[var(--ink-mute)] tracking-[0.06em]">
              {audienceSummary} · {b.audience_snapshot_count} pax (snapshot)
            </span>
          </div>
        </div>
        {canManage ? (
          <BroadcastActionBar id={b.id} status={b.status} />
        ) : null}
      </div>

      {/* Stats ribbon */}
      <section className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Sent · 已送达" value={stats.sent} tone="ok" />
        <StatCard label="Failed · 失败" value={stats.failed} tone="bad" />
        <StatCard label="Skipped · 跳过" value={stats.skipped} tone="mute" />
        <StatCard label="Pending · 待发送" value={counts.pending} tone="warn" />
      </section>

      {/* Progress bar */}
      {total > 0 ? (
        <div className="mt-4 h-[6px] rounded-full bg-[var(--paper-deep)] overflow-hidden">
          <div
            className="h-full bg-[var(--cinnabar)] transition-[width] duration-300"
            style={{ width: `${sentPct}%` }}
          />
        </div>
      ) : null}

      {/* Recipient tabs */}
      <nav className="mt-8 flex gap-1 flex-wrap" aria-label="Recipient status">
        {(["sent", "failed", "skipped", "pending"] as BroadcastRecipientStatus[]).map((s) => {
          const active = recipientTab === s;
          const c = counts[s];
          const href = `/admin/broadcasts/${id}?tab=${s}`;
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
              <span>{BROADCAST_RECIPIENT_STATUS_LABEL[s].en}</span>
              <span className="text-[var(--ink-faint)]">·</span>
              <span>{c}</span>
            </Link>
          );
        })}
      </nav>

      <section className="mt-4 rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] p-6 shadow-[var(--shadow-paper-1)]">
        <RecipientsTable recipients={recipients} errorLabels={BROADCAST_ERROR_CODE_LABEL} />
      </section>
    </div>
  );
}

function parseRecipientTab(sp: Record<string, string | string[] | undefined>): BroadcastRecipientStatus {
  const raw = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  if (raw === "sent" || raw === "failed" || raw === "skipped" || raw === "pending") return raw;
  return "sent";
}

async function loadCounts(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  broadcastId: string,
): Promise<Record<BroadcastRecipientStatus, number>> {
  const base = () =>
    supabase
      .from("broadcast_recipients")
      .select("id", { count: "exact", head: true })
      .eq("broadcast_id", broadcastId);
  const [sent, failed, skipped, pending] = await Promise.all([
    base().eq("status", "sent"),
    base().eq("status", "failed"),
    base().eq("status", "skipped"),
    base().eq("status", "pending"),
  ]);
  return {
    sent: sent.count ?? 0,
    failed: failed.count ?? 0,
    skipped: skipped.count ?? 0,
    pending: pending.count ?? 0,
  };
}

function mergeStats(raw: Record<string, unknown>): BroadcastStats {
  const base = emptyBroadcastStats();
  const numOr = (v: unknown, f: number) =>
    typeof v === "number" ? v : typeof v === "string" && Number.isFinite(Number(v)) ? Number(v) : f;
  return {
    queued: numOr(raw.queued, base.queued),
    sent: numOr(raw.sent, base.sent),
    failed: numOr(raw.failed, base.failed),
    skipped: numOr(raw.skipped, base.skipped),
  };
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "ok" | "bad" | "mute" | "warn";
}) {
  const valueColor =
    tone === "ok"
      ? "text-[#3a6b3b]"
      : tone === "bad"
        ? "text-[var(--cinnabar-deep)]"
        : tone === "warn"
          ? "text-[var(--gold)]"
          : "text-[var(--ink-mute)]";
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] p-4 shadow-[var(--shadow-paper-1)]">
      <div className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">{label}</div>
      <div className={`mt-1 font-display text-[28px] tabular-nums ${valueColor}`}>{value}</div>
    </div>
  );
}
