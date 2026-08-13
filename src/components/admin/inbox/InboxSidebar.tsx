import Link from "next/link";
import type {
  InboxListFilters,
  IdentityConfidence,
} from "@/lib/inbox/inbox-query";
import type { Tag } from "@/lib/inbox/tags-types";
import { tintHex } from "@/lib/inbox/tags-types";
import type { SavedView } from "@/lib/inbox/saved-views-types";
import { savedViewHref } from "@/lib/inbox/saved-views-types";
import { SavedViewItem } from "./SavedViewItem";

// Inbox sub-nav (left column of /admin/inbox). Renders one stacked list of
// "saved views" — each link is just a URL with a different filter set —
// grouped into Scope, Channels, and Identity sections. Server-rendered: the
// active state is derived from the current filters, not client state.
//
// Modeled on Respond.io's sidebar: a single column of links + collapsible
// section headers. We omit two of their items intentionally:
//   - "Incoming Calls" — GMC has no calls feature yet.
//   - "Create AI Agent" — Tier 1 autopilot toggle + AI Assist drawer already
//     cover that surface area.
// "Custom Inbox" maps to Saved Views (placeholder for now).

type Counts = {
  mine: number;
  unassigned: number;
  all: number;
  channels: { whatsapp: number };
};

const IDENTITY_ITEMS: Array<{
  key: IdentityConfidence;
  label: string;
  labelZh: string;
  icon: React.ReactNode;
}> = [
  { key: "unverified", label: "Unverified", labelZh: "待确认", icon: <UnverifiedIcon /> },
  { key: "verified", label: "Known", labelZh: "已确认", icon: <KnownIcon /> },
];

export function InboxSidebar({
  filters,
  counts,
  tags,
  savedViews,
}: {
  filters: InboxListFilters;
  counts: Counts;
  tags: Tag[];
  savedViews: SavedView[];
}) {
  const activeViewHref = savedViewHref({
    scope: filters.scope,
    channel: filters.channel,
    status: filters.status,
    identity: filters.identity,
    tag: filters.tag,
    q: filters.q,
  });
  return (
    // Width is controlled by the parent — either the @subnav slot column in
    // AdminShell (lg+) or the lg:hidden fallback wrapper in inbox/page.tsx.
    <aside className="w-full">
      <div className="rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)] overflow-hidden">
        {/* Sidebar header */}
        <div className="px-4 pt-4 pb-2">
          <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
            <span className="w-4 h-px bg-current" />
            Inbox · 收件箱
          </div>
        </div>

        {/* Scope section (no header — feels primary like Respond.io) */}
        <nav className="px-2 py-1">
          <ScopeLink
            filters={filters}
            code="all"
            label="All"
            labelZh="全部"
            count={counts.all}
            icon={<TrayIcon />}
          />
          <ScopeLink
            filters={filters}
            code="mine"
            label="Mine"
            labelZh="我的"
            count={counts.mine}
            icon={<PersonIcon />}
          />
          <ScopeLink
            filters={filters}
            code="unassigned"
            label="Unassigned"
            labelZh="未分配"
            count={counts.unassigned}
            icon={<PeopleIcon />}
          />
        </nav>

        <SectionDivider />

        {/* Channels section */}
        <SectionHeader>Channels · 平台</SectionHeader>
        <nav className="px-2 py-1">
          <ChannelLink
            filters={filters}
            code="whatsapp"
            label="WhatsApp"
            count={counts.channels.whatsapp}
            color="#25D366"
          />
        </nav>

        <SectionDivider />

        {/* Identity section (participants.identity_confidence) */}
        <SectionHeader>Identity · 身份</SectionHeader>
        <nav className="px-2 py-1 pb-3">
          {IDENTITY_ITEMS.map((item) => (
            <IdentityLink
              key={item.key}
              filters={filters}
              code={item.key}
              label={item.label}
              labelZh={item.labelZh}
              icon={item.icon}
            />
          ))}
        </nav>

        <SectionDivider />

        {/* Tags section — definitions managed inline from any thread. */}
        <SectionHeader>Tags · 标签</SectionHeader>
        {tags.length === 0 ? (
          <div className="px-4 pb-3 text-[11.5px] text-[var(--ink-faint)] italic">
            None yet. Open a thread to create one.
          </div>
        ) : (
          <nav className="px-2 py-1 pb-3 space-y-0.5">
            {tags.map((t) => (
              <TagLink key={t.id} filters={filters} tag={t} />
            ))}
          </nav>
        )}

        <SectionDivider />

        <SectionHeader>
          <span>Saved Views · 保存视图</span>
        </SectionHeader>
        {savedViews.length === 0 ? (
          <div className="px-4 py-3 text-[11.5px] text-[var(--ink-faint)] italic leading-[1.55]">
            No views yet. Apply a filter combo, then use{" "}
            <span className="font-medium text-[var(--ink-mute)]">+ Save view</span>{" "}
            on the list.
          </div>
        ) : (
          <ul className="flex flex-col gap-px px-1">
            {savedViews.map((v) => (
              <SavedViewItem
                key={v.id}
                view={v}
                isActive={savedViewHref(v.filters) === activeViewHref}
              />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function TagLink({ filters, tag }: { filters: InboxListFilters; tag: Tag }) {
  const active = filters.tag === tag.slug;
  // Same-slug click toggles off, mirroring the channel/identity pattern.
  const href = buildHref(filters, { tag: active ? null : tag.slug });
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={[
        "group flex items-center gap-2 h-8 px-2 rounded-[var(--radius-md)]",
        "text-[12.5px] tracking-[-0.005em]",
        "transition-[background-color,color] duration-[var(--dur-fast)]",
        active
          ? "text-[var(--ink)]"
          : "text-[var(--ink-soft)] hover:bg-[var(--paper-deep)] hover:text-[var(--ink)]",
      ].join(" ")}
      style={
        active
          ? { backgroundColor: tintHex(tag.color, 0.16) }
          : undefined
      }
    >
      <span
        aria-hidden="true"
        className="flex-none w-2 h-2 rounded-full"
        style={{ backgroundColor: tag.color }}
      />
      <span className="flex-1 min-w-0 truncate">
        {tag.label_en}
        <span className="text-[var(--ink-faint)]"> · {tag.label_zh}</span>
      </span>
    </Link>
  );
}

// -----------------------------------------------------------------------------
// Section primitives
// -----------------------------------------------------------------------------

function SectionDivider() {
  return <div className="h-px bg-[var(--paper-shadow)] mx-3" />;
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 pt-3 pb-1.5 flex items-center justify-between gap-2">
      <span className="text-[9.5px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
        {children}
      </span>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Link primitives — each builds its own href off `filters`, toggling its
// own param on/off while preserving every other filter. Keeps the URL the
// single source of truth (per feedback_list_query_pattern).
// -----------------------------------------------------------------------------

function buildHref(
  filters: InboxListFilters,
  patch: Partial<Pick<InboxListFilters, "scope" | "channel" | "status" | "identity" | "tag">>,
): string {
  const next = {
    scope: filters.scope,
    channel: filters.channel,
    status: filters.status,
    identity: filters.identity,
    tag: filters.tag,
    ...patch,
  };
  const params = new URLSearchParams();
  if (next.scope !== "mine") params.set("scope", next.scope);
  if (next.channel) params.set("channel", next.channel);
  if (next.status) params.set("status", next.status);
  if (next.identity) params.set("identity", next.identity);
  if (next.tag) params.set("tag", next.tag);
  if (filters.q) params.set("q", filters.q);
  const qs = params.toString();
  return qs ? `/admin/inbox?${qs}` : "/admin/inbox";
}

function ScopeLink({
  filters,
  code,
  label,
  labelZh,
  count,
  icon,
}: {
  filters: InboxListFilters;
  code: InboxListFilters["scope"];
  label: string;
  labelZh: string;
  count: number;
  icon: React.ReactNode;
}) {
  const active = filters.scope === code && !filters.identity && !filters.channel && !filters.tag;
  // Clearing channel + identity when clicking a scope link mirrors the Gmail
  // "All Mail" UX — picking a scope is a reset, not a refinement.
  const href = buildHref(filters, { scope: code, channel: null, identity: null, tag: null });
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`group flex items-center gap-2.5 h-9 px-2.5 rounded-[var(--radius-md)]
                  text-[13px] tracking-[-0.005em]
                  transition-[background-color,color] duration-[var(--dur-fast)]
                  ${
                    active
                      ? "bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
                      : "text-[var(--ink-soft)] hover:bg-[var(--paper-deep)] hover:text-[var(--ink)]"
                  }`}
    >
      <span
        className={`flex-none w-4 h-4 ${active ? "text-[var(--cinnabar)]" : "text-[var(--ink-mute)] group-hover:text-[var(--ink-soft)]"}`}
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className="flex-1 truncate font-display tracking-[-0.005em]">
        {label}
      </span>
      <span className="text-[9.5px] tracking-[0.14em] uppercase text-[var(--ink-faint)]" aria-hidden="true">
        {labelZh}
      </span>
      <span
        className={`tabular-nums text-[10.5px] tracking-[0.02em] min-w-[22px] text-right
                    ${active ? "text-[var(--cinnabar-deep)]" : "text-[var(--ink-mute)]"}`}
      >
        {count.toLocaleString()}
      </span>
    </Link>
  );
}

function ChannelLink({
  filters,
  code,
  label,
  count,
  color,
}: {
  filters: InboxListFilters;
  code: NonNullable<InboxListFilters["channel"]>;
  label: string;
  count: number;
  color: string;
}) {
  const active = filters.channel === code;
  // Clicking the same channel again clears it; cross-filter compatible.
  const href = buildHref(filters, { channel: active ? null : code, identity: null });
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`group flex items-center gap-2.5 h-9 px-2.5 rounded-[var(--radius-md)]
                  text-[13px] tracking-[-0.005em]
                  transition-[background-color,color] duration-[var(--dur-fast)]
                  ${
                    active
                      ? "bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
                      : "text-[var(--ink-soft)] hover:bg-[var(--paper-deep)] hover:text-[var(--ink)]"
                  }`}
    >
      <span
        className="flex-none inline-block w-2.5 h-2.5 rounded-full"
        style={{ background: color }}
        aria-hidden="true"
      />
      <span className="flex-1 truncate font-display tracking-[-0.005em]">
        {label}
      </span>
      <span
        className={`tabular-nums text-[10.5px] tracking-[0.02em] min-w-[22px] text-right
                    ${active ? "text-[var(--cinnabar-deep)]" : "text-[var(--ink-mute)]"}`}
      >
        {count.toLocaleString()}
      </span>
    </Link>
  );
}

function IdentityLink({
  filters,
  code,
  label,
  labelZh,
  icon,
}: {
  filters: InboxListFilters;
  code: IdentityConfidence;
  label: string;
  labelZh: string;
  icon: React.ReactNode;
}) {
  const active = filters.identity === code;
  const href = buildHref(filters, { identity: active ? null : code });
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`group flex items-center gap-2.5 h-9 px-2.5 rounded-[var(--radius-md)]
                  text-[13px] tracking-[-0.005em]
                  transition-[background-color,color] duration-[var(--dur-fast)]
                  ${
                    active
                      ? "bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
                      : "text-[var(--ink-soft)] hover:bg-[var(--paper-deep)] hover:text-[var(--ink)]"
                  }`}
    >
      <span
        className={`flex-none w-4 h-4 ${active ? "text-[var(--cinnabar)]" : "text-[var(--ink-mute)] group-hover:text-[var(--ink-soft)]"}`}
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className="flex-1 truncate font-display tracking-[-0.005em]">
        {label}
      </span>
      <span className="text-[9.5px] tracking-[0.14em] uppercase text-[var(--ink-faint)]" aria-hidden="true">
        {labelZh}
      </span>
    </Link>
  );
}

// -----------------------------------------------------------------------------
// Icons
// -----------------------------------------------------------------------------

function TrayIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 9.5L3.5 4h9L14 9.5v3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />
      <path d="M2 9.5h3l1 1.5h4l1-1.5h3" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="6" r="2.6" />
      <path d="M3 13.5c.7-2.4 2.7-4 5-4s4.3 1.6 5 4" />
    </svg>
  );
}

function UnverifiedIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="5.6" />
      <path d="M6.5 6.4a1.6 1.6 0 0 1 3.1.5c0 1.1-1.6 1.3-1.6 2.4" />
      <path d="M8 11.5h.01" />
    </svg>
  );
}

function KnownIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="5.6" />
      <path d="M5.6 8.2l1.7 1.7 3.2-3.6" />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="6" cy="6" r="2.2" />
      <circle cx="11" cy="6.5" r="1.8" />
      <path d="M1.5 13c.5-2 2.2-3.2 4.5-3.2s4 1.2 4.5 3.2" />
      <path d="M11 9.5c1.6 0 3 .8 3.5 2.5" />
    </svg>
  );
}
