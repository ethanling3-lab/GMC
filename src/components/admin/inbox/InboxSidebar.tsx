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
import { INBOX_QUEUES, QUEUE_LABEL, type InboxQueue } from "@/lib/inbox/queue";

// Inbox sub-nav (left column of /admin/inbox). The lists staff work from sit
// on top; identity, tags and saved views stay one click away under Filters,
// which opens by itself when one of them is in use. Server-rendered: the
// active state is derived from the URL, not client state.

type Counts = Record<InboxQueue, number>;

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
    queue: filters.queue,
    scope: filters.scope,
    channel: filters.channel,
    status: filters.status,
    identity: filters.identity,
    tag: filters.tag,
    q: filters.q,
  });
  const filtersInUse =
    filters.queue === "all" || Boolean(filters.identity || filters.tag || filters.channel);
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

        <nav aria-label="Chat lists" className="px-2 pt-1 pb-2">
          {INBOX_QUEUES.map((code) => (
            <QueueLink key={code} filters={filters} code={code} count={counts[code]} />
          ))}
        </nav>

        <SectionDivider />

        <details className="group" open={filtersInUse}>
          <summary className="cursor-pointer list-none flex items-center justify-between gap-2 h-10 px-4 text-[13px] text-[var(--ink-soft)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] transition-[color] duration-[var(--dur-fast)]">
            <span>Filters · 筛选</span>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="text-[var(--ink-faint)] transition-transform duration-[var(--dur-fast)] group-open:rotate-180" aria-hidden="true">
              <path d="M4 6l4 4 4-4" />
            </svg>
          </summary>

        <nav aria-label="All chats" className="px-2 pb-1">
          <AllChatsLink filters={filters} />
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
        </details>
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
  patch: Partial<Pick<InboxListFilters, "queue" | "scope" | "channel" | "status" | "identity" | "tag">>,
): string {
  const next = {
    queue: filters.queue,
    scope: filters.scope,
    channel: filters.channel,
    status: filters.status,
    identity: filters.identity,
    tag: filters.tag,
    ...patch,
  };
  const params = new URLSearchParams();
  if (next.queue !== "needs_reply") params.set("queue", next.queue);
  if (next.scope !== "all") params.set("scope", next.scope);
  if (next.channel) params.set("channel", next.channel);
  if (next.status) params.set("status", next.status);
  if (next.identity) params.set("identity", next.identity);
  if (next.tag) params.set("tag", next.tag);
  if (filters.q && next.queue === filters.queue) params.set("q", filters.q);
  const qs = params.toString();
  return qs ? `/admin/inbox?${qs}` : "/admin/inbox";
}

function QueueLink({
  filters,
  code,
  count,
}: {
  filters: InboxListFilters;
  code: InboxQueue;
  count: number;
}) {
  const active = filters.queue === code;
  const urgent = code === "needs_reply" && count > 0;
  // Picking a list is a reset, not a refinement.
  const href = buildHref(filters, {
    queue: code,
    scope: "all",
    status: null,
    channel: null,
    identity: null,
    tag: null,
  });
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`group flex items-center gap-2 h-10 px-2.5 rounded-[var(--radius-md)]
                  text-[13.5px] tracking-[-0.005em]
                  focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]
                  transition-[background-color,color] duration-[var(--dur-fast)]
                  ${
                    active
                      ? "bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
                      : "text-[var(--ink-soft)] hover:bg-[var(--paper-deep)] hover:text-[var(--ink)]"
                  }`}
    >
      <span className={`flex-1 min-w-0 truncate ${code === "needs_reply" ? "font-medium" : ""}`}>
        {QUEUE_LABEL[code].en}
        <span className="ml-1.5 text-[11.5px] font-normal text-[var(--ink-faint)]">
          {QUEUE_LABEL[code].cn}
        </span>
      </span>
      <span
        className={
          urgent
            ? "inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full bg-[var(--cinnabar)] text-[11.5px] font-medium tabular-nums text-[var(--paper-warm)]"
            : `tabular-nums text-[11.5px] min-w-[22px] text-right ${active ? "text-[var(--cinnabar-deep)]" : "text-[var(--ink-mute)]"}`
        }
      >
        {count.toLocaleString()}
      </span>
    </Link>
  );
}

function AllChatsLink({ filters }: { filters: InboxListFilters }) {
  const active = filters.queue === "all" && !filters.q;
  return (
    <Link
      href={buildHref(filters, { queue: "all", scope: "all", status: null })}
      aria-current={active ? "page" : undefined}
      className={`flex items-center h-9 px-2.5 rounded-[var(--radius-md)] text-[13px]
                  focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]
                  transition-[background-color,color] duration-[var(--dur-fast)]
                  ${
                    active
                      ? "bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
                      : "text-[var(--ink-soft)] hover:bg-[var(--paper-deep)] hover:text-[var(--ink)]"
                  }`}
    >
      All chats
      <span className="ml-1.5 text-[11.5px] text-[var(--ink-faint)]">全部对话</span>
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
