import type { Metadata } from "next";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import {
  loadConversations,
  loadStatusCounts,
  parseFilters,
  type ConversationListRow,
  type InboxListFilters,
} from "@/lib/inbox/inbox-query";
import { InboxListItem } from "@/components/admin/inbox/InboxListItem";
import { InboxSearch } from "@/components/admin/inbox/InboxSearch";

export const metadata: Metadata = { title: "Inbox" };
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function InboxListPage({ searchParams }: PageProps) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const filters = parseFilters(admin, sp);

  const supabase = await createSupabaseServerClient();
  const [rows, counts] = await Promise.all([
    loadConversations(supabase, filters),
    loadStatusCounts(supabase, { admin_id: admin.id, channel: filters.channel }),
  ]);

  return (
    <div>
      {/* Header */}
      <div className="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
            <span className="w-5 h-px bg-current" />
            Inbox · 收件箱
          </div>
          <h1 className="mt-4 font-display text-[36px] md:text-[40px] leading-[1.05] tracking-[-0.015em] text-[var(--ink)]">
            Every conversation, one place.
          </h1>
          <p className="mt-4 max-w-[64ch] text-[14.5px] leading-[1.7] text-[var(--ink-soft)]">
            WhatsApp and LINE threads unified with participant context, event
            enrolments, and AI triage. Reply, tag, assign, resolve — without
            switching apps.
          </p>
        </div>
        <div className="text-right">
          <div className="text-[9px] tracking-[0.28em] uppercase text-[var(--ink-faint)]">
            Today
          </div>
          <div className="mt-1 font-display text-[20px] leading-[1.1] text-[var(--ink)]">
            {new Date().toLocaleDateString("en-GB", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </div>
        </div>
      </div>

      {/* Toolbar card */}
      <div className="mt-10 rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)] p-5">
        {/* Scope tabs */}
        <div className="flex flex-wrap items-center gap-2">
          <ScopeTab filters={filters} code="mine" label="Mine" labelZh="我的" count={counts.mine} />
          <ScopeTab filters={filters} code="unassigned" label="Unassigned" labelZh="未分配" count={counts.unassigned} />
          <ScopeTab filters={filters} code="all" label="All" labelZh="全部" count={counts.all} />

          <span aria-hidden="true" className="flex-1" />

          <InboxSearch initialQ={filters.q} />
        </div>

        {/* Filter row — channel + status */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <FilterLabel>Channel · 平台</FilterLabel>
          <ChannelFilter filters={filters} code={null} label="All" />
          <ChannelFilter filters={filters} code="whatsapp" label="WhatsApp" />
          <ChannelFilter filters={filters} code="line" label="LINE" />

          <span aria-hidden="true" className="inline-block w-px h-5 bg-[var(--paper-shadow)] mx-2" />

          <FilterLabel>Status · 状态</FilterLabel>
          <StatusFilter filters={filters} code={null} label="Any" />
          <StatusFilter filters={filters} code="open" label="Open" />
          <StatusFilter filters={filters} code="pending" label="Pending" />
          <StatusFilter filters={filters} code="snoozed" label="Snoozed" />
          <StatusFilter filters={filters} code="closed" label="Closed" />
        </div>
      </div>

      {/* List */}
      <div className="mt-6">
        {rows.length === 0 ? (
          <EmptyState filters={filters} />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {rows.map((row) => (
              <InboxListItem key={row.id} row={row} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function FilterLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)] mr-1">
      {children}
    </span>
  );
}

function ScopeTab({
  filters,
  code,
  label,
  labelZh,
  count,
}: {
  filters: InboxListFilters;
  code: InboxListFilters["scope"];
  label: string;
  labelZh: string;
  count: number;
}) {
  const active = filters.scope === code;
  const params = new URLSearchParams();
  if (code !== "mine") params.set("scope", code);
  if (filters.channel) params.set("channel", filters.channel);
  if (filters.status) params.set("status", filters.status);
  if (filters.q) params.set("q", filters.q);
  const qs = params.toString();
  const href = qs ? `/admin/inbox?${qs}` : `/admin/inbox`;
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`inline-flex items-center gap-2 h-8 px-3 rounded-[var(--radius-pill)] border text-[11.5px] tracking-[0.04em]
                  transition-[background-color,border-color,color] duration-[var(--dur-fast)]
                  ${
                    active
                      ? "border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
                      : "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-soft)] hover:border-[var(--cinnabar)]/25 hover:bg-[var(--paper-deep)] hover:text-[var(--ink)]"
                  }`}
    >
      <span>{label}</span>
      <span
        className="tabular-nums text-[9px] tracking-[0.18em] uppercase opacity-70"
        aria-hidden="true"
      >
        {labelZh}
      </span>
      <span
        className={`tabular-nums text-[10px] tracking-[0.06em] px-1.5 py-0.5 rounded-full
                    ${active ? "bg-[var(--cinnabar)]/15" : "bg-[var(--paper-deep)] text-[var(--ink-mute)]"}`}
      >
        {count.toLocaleString()}
      </span>
    </Link>
  );
}

function ChannelFilter({
  filters,
  code,
  label,
}: {
  filters: InboxListFilters;
  code: InboxListFilters["channel"] | null;
  label: string;
}) {
  const active = filters.channel === code;
  const params = new URLSearchParams();
  if (filters.scope !== "mine") params.set("scope", filters.scope);
  if (code) params.set("channel", code);
  if (filters.status) params.set("status", filters.status);
  if (filters.q) params.set("q", filters.q);
  const qs = params.toString();
  return (
    <Link
      href={qs ? `/admin/inbox?${qs}` : "/admin/inbox"}
      aria-current={active ? "page" : undefined}
      className={`inline-flex items-center h-7 px-2.5 rounded-[var(--radius-pill)] border text-[11px] tracking-[0.04em]
                  transition-[background-color,border-color,color] duration-[var(--dur-fast)]
                  ${
                    active
                      ? "border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
                      : "border-[var(--paper-shadow)] bg-transparent text-[var(--ink-mute)] hover:text-[var(--ink)] hover:border-[var(--cinnabar)]/20"
                  }`}
    >
      {label}
    </Link>
  );
}

function StatusFilter({
  filters,
  code,
  label,
}: {
  filters: InboxListFilters;
  code: InboxListFilters["status"] | null;
  label: string;
}) {
  const active = filters.status === code;
  const params = new URLSearchParams();
  if (filters.scope !== "mine") params.set("scope", filters.scope);
  if (filters.channel) params.set("channel", filters.channel);
  if (code) params.set("status", code);
  if (filters.q) params.set("q", filters.q);
  const qs = params.toString();
  return (
    <Link
      href={qs ? `/admin/inbox?${qs}` : "/admin/inbox"}
      aria-current={active ? "page" : undefined}
      className={`inline-flex items-center h-7 px-2.5 rounded-[var(--radius-pill)] border text-[11px] tracking-[0.04em]
                  transition-[background-color,border-color,color] duration-[var(--dur-fast)]
                  ${
                    active
                      ? "border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
                      : "border-[var(--paper-shadow)] bg-transparent text-[var(--ink-mute)] hover:text-[var(--ink)] hover:border-[var(--cinnabar)]/20"
                  }`}
    >
      {label}
    </Link>
  );
}

function EmptyState({ filters }: { filters: InboxListFilters }) {
  const reason =
    filters.q
      ? `No conversations match "${filters.q}".`
      : filters.scope === "mine"
        ? "No conversations assigned to you yet."
        : filters.scope === "unassigned"
          ? "Nothing in the unassigned queue."
          : "No conversations yet. Once WhatsApp or LINE is wired to the webhooks, threads will land here.";
  return (
    <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--paper-shadow)] bg-[var(--paper)]/60 px-8 py-12 text-center">
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-full border border-[var(--paper-shadow)] bg-[var(--paper-warm)] text-[var(--cinnabar)] shadow-[var(--shadow-paper-1)]">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7l-3 3v-3H5a2 2 0 0 1-2-2z" />
        </svg>
      </div>
      <div className="mt-4 text-[14px] text-[var(--ink-soft)] leading-[1.65] max-w-[52ch] mx-auto">
        {reason}
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _RowCheck = ConversationListRow;
