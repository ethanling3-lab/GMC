import Link from "next/link";
import type {
  ConversationListRow,
  InboxListFilters,
} from "@/lib/inbox/inbox-query";
import { InboxListItem } from "./InboxListItem";
import { InboxSearch } from "./InboxSearch";
import { SelectionShell } from "./selection/SelectionShell";
import { SaveViewButton } from "./SaveViewButton";
import { QUEUE_LABEL } from "@/lib/inbox/queue";

// Conversation list pane — used in TWO places:
//   1. `inbox/@list/default.tsx` (the persistent xl+ middle column, rendered
//      via the @list parallel slot defined at inbox/layout.tsx)
//   2. `inbox/page.tsx` as the inline fallback at narrow widths (<xl)
// Both render paths fetch their own data; the view itself is pure
// presentation + URL-link-building.
//
// `compact` collapses the chrome (lighter header, no card framing, no big
// header card) for the persistent-column use. The fallback uses the
// full-bleed default.

type Props = {
  filters: InboxListFilters;
  rows: ConversationListRow[];
  compact?: boolean;
  /** Current request pathname, forwarded to InboxListItem so the active
   * row can highlight. Server-supplied via the `x-pathname` middleware
   * header in the @list slot's page.tsx — avoids `usePathname()` in a
   * client child that would hydration-mismatch in Next 16. */
  activePath?: string;
};

export function ConversationListView({
  filters,
  rows,
  compact = false,
  activePath,
}: Props) {
  if (compact) {
    return (
      // `w-full min-w-0` is load-bearing, not defensive styling.
      //
      // The parent is the fixed 320px `@list` aside in inbox/layout.tsx, which
      // is `display:flex`. A flex item defaults to `min-width:auto`, so without
      // these this div sized to its max-content width — measured at 1053px
      // against a 320px column — and the aside's `overflow-hidden` silently
      // chopped 733px off the right. Every `truncate` and `min-w-0` further
      // down was correct and did nothing, because nothing above them bounded
      // the width: names, timestamps and the identity chip were all rendered,
      // just off-screen. Removing this reintroduces the clipping.
      <div className="flex flex-col h-full w-full min-w-0">
        {/* Sticky toolbar: which list this is + active-filter strip.
            Search lives INSIDE the scroll below (WhatsApp pattern). */}
        <div className="flex-none px-3 pt-2.5 pb-2 border-b border-[var(--paper-shadow)] bg-[var(--paper-warm)]">
          <ListTitle filters={filters} count={rows.length} />
          <ActiveFilterStrip filters={filters} count={rows.length} compact />
        </div>

        {/* Scroll area: search header + thread list. Search scrolls away
            when user scrolls down through threads (WhatsApp pattern). */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="px-3 pt-3 pb-2">
            <InboxSearch initialQ={filters.q} />
          </div>
          <SelectionShell rowIds={rows.map((r) => r.id)} compact>
            {rows.length === 0 ? (
              <EmptyState filters={filters} compact />
            ) : (
              <ul className="flex flex-col">
                {rows.map((row) => (
                  <InboxListItem
                    key={row.id}
                    row={row}
                    activePath={activePath}
                    filterQuery={filtersToQuery(filters)}
                    compact
                  />
                ))}
              </ul>
            )}
          </SelectionShell>
        </div>
      </div>
    );
  }

  // Non-compact (used in <xl fallback inside inbox/page.tsx)
  return (
    <div className="min-w-0">
      <div className="rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)] p-4 mb-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ListTitle filters={filters} count={rows.length} />
          <InboxSearch initialQ={filters.q} />
        </div>
        <ActiveFilterStrip filters={filters} count={rows.length} />
      </div>

      <SelectionShell rowIds={rows.map((r) => r.id)} compact={false}>
        {rows.length === 0 ? (
          <EmptyState filters={filters} compact={false} />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {rows.map((row) => (
              <InboxListItem
                key={row.id}
                row={row}
                activePath={activePath}
                filterQuery={filtersToQuery(filters)}
              />
            ))}
          </ul>
        )}
      </SelectionShell>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Internal primitives (moved from inbox/page.tsx so both render paths share)
// -----------------------------------------------------------------------------

function ListTitle({ filters, count }: { filters: InboxListFilters; count: number }) {
  const label =
    filters.queue === "all"
      ? filters.q
        ? { en: "Search results", cn: "搜索结果" }
        : { en: "All chats", cn: "全部对话" }
      : QUEUE_LABEL[filters.queue];
  return (
    <h2 className="flex items-baseline gap-2 font-display text-[16px] leading-tight tracking-[-0.01em] text-[var(--ink)]">
      {label.en} · {label.cn}
      <span className="font-sans text-[12px] tabular-nums text-[var(--ink-faint)]">
        {count.toLocaleString()}
      </span>
    </h2>
  );
}

function ActiveFilterStrip({
  filters,
  count,
  compact = false,
}: {
  filters: InboxListFilters;
  count: number;
  compact?: boolean;
}) {
  const chips: Array<{ label: string; href: string }> = [];

  if (filters.identity) {
    chips.push({
      label: compact ? filters.identity : `Identity: ${filters.identity}`,
      href: makeHref(filters, { identity: null }),
    });
  }
  if (filters.channel) {
    chips.push({
      label: compact ? filters.channel : `Channel: ${filters.channel}`,
      href: makeHref(filters, { channel: null }),
    });
  }
  if (filters.tag) {
    chips.push({
      label: compact ? `#${filters.tag}` : `Tag: ${filters.tag}`,
      href: makeHref(filters, { tag: null }),
    });
  }
  if (filters.q) {
    chips.push({
      label: compact ? `"${filters.q}"` : `Search: "${filters.q}"`,
      href: makeHref(filters, { q: "", queue: "needs_reply" }),
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className={compact ? "mt-2 flex flex-wrap items-center gap-1" : "mt-3 flex flex-wrap items-center gap-1.5"}>
      {!compact ? (
        <span className="text-[9.5px] tracking-[0.22em] uppercase text-[var(--ink-faint)] mr-1">
          Active filters
        </span>
      ) : null}
      {chips.map((chip) => (
        <Link
          key={chip.label}
          href={chip.href}
          className={[
            "inline-flex items-center gap-1 rounded-[var(--radius-pill)]",
            "border border-[var(--cinnabar)]/30 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]",
            "hover:bg-[var(--cinnabar)] hover:text-[var(--paper-warm)] hover:border-[var(--cinnabar)]",
            "transition-[background-color,color,border-color] duration-[var(--dur-fast)]",
            compact ? "h-5 px-1.5 text-[10px]" : "h-6 px-2 text-[10.5px]",
          ].join(" ")}
        >
          <span className="truncate max-w-[120px]">{chip.label}</span>
          <svg width="8" height="8" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <path d="M2 2l5 5M7 2l-5 5" />
          </svg>
        </Link>
      ))}
      <span
        className={
          compact
            ? "ml-1 text-[10px] tracking-[0.02em] text-[var(--ink-mute)] tabular-nums"
            : "ml-2 text-[10.5px] tracking-[0.04em] text-[var(--ink-mute)]"
        }
      >
        · {count.toLocaleString()}
      </span>
      <SaveViewButton
        compact={compact}
        filters={{
          queue: filters.queue,
          scope: filters.scope,
          channel: filters.channel,
          status: filters.status,
          identity: filters.identity,
          tag: filters.tag,
          q: filters.q,
        }}
      />
    </div>
  );
}

/**
 * The active filters as a query string, `""` when everything is at default.
 *
 * Split out of makeHref because two different base paths need it: the filter
 * links (/admin/inbox) and the per-thread links (/admin/inbox/<id>). The thread
 * links used to be built bare, so opening a thread from another list dropped the
 * query and the list silently reverted to the default — the @list slot reads
 * the URL on every navigation.
 */
export function filtersToQuery(
  filters: InboxListFilters,
  patch: Partial<Pick<InboxListFilters, "queue" | "scope" | "channel" | "status" | "identity" | "tag" | "q">> = {},
): string {
  const next = {
    queue: filters.queue,
    scope: filters.scope,
    channel: filters.channel,
    status: filters.status,
    identity: filters.identity,
    tag: filters.tag,
    q: filters.q,
    ...patch,
  };
  const params = new URLSearchParams();
  if (next.queue !== "needs_reply" && !next.q) params.set("queue", next.queue);
  if (next.scope !== "all") params.set("scope", next.scope);
  if (next.channel) params.set("channel", next.channel);
  if (next.status) params.set("status", next.status);
  if (next.identity) params.set("identity", next.identity);
  if (next.tag) params.set("tag", next.tag);
  if (next.q) params.set("q", next.q);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

function makeHref(
  filters: InboxListFilters,
  patch: Partial<Pick<InboxListFilters, "queue" | "scope" | "channel" | "status" | "identity" | "tag" | "q">>,
): string {
  return `/admin/inbox${filtersToQuery(filters, patch)}`;
}

function EmptyState({
  filters,
  compact,
}: {
  filters: InboxListFilters;
  compact: boolean;
}) {
  const reason = filters.q
    ? `No chats match "${filters.q}".`
    : filters.identity || filters.tag || filters.channel
      ? "No chats match these filters. Remove a filter to see more."
      : filters.queue === "needs_reply"
        ? "All caught up. Chats that need a person will appear here."
        : filters.queue === "ai"
          ? "The AI isn't handling any chats right now."
          : filters.queue === "waiting"
            ? "No chats are waiting on a customer."
            : filters.queue === "done"
              ? "Chats you mark as done will appear here."
              : "No chats yet. New WhatsApp messages will appear here.";
  return (
    <div
      className={
        compact
          ? "h-full flex items-center justify-center px-4 py-8 text-center"
          : "rounded-[var(--radius-lg)] border border-dashed border-[var(--paper-shadow)] bg-[var(--paper)]/60 px-8 py-12 text-center"
      }
    >
      <div>
        {!compact ? (
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full border border-[var(--paper-shadow)] bg-[var(--paper-warm)] text-[var(--cinnabar)] shadow-[var(--shadow-paper-1)] mb-4">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7l-3 3v-3H5a2 2 0 0 1-2-2z" />
            </svg>
          </div>
        ) : null}
        <div
          className={
            compact
              ? "text-[12.5px] text-[var(--ink-mute)] leading-[1.6] max-w-[28ch] mx-auto"
              : "text-[14px] text-[var(--ink-soft)] leading-[1.65] max-w-[52ch] mx-auto"
          }
        >
          {reason}
        </div>
      </div>
    </div>
  );
}
