import Link from "next/link";
import type {
  ConversationListRow,
  InboxListFilters,
} from "@/lib/inbox/inbox-query";
import { InboxListItem } from "./InboxListItem";
import { InboxSearch } from "./InboxSearch";

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
      <div className="flex flex-col h-full">
        {/* Sticky toolbar: status tabs + active-filter strip only.
            Search lives INSIDE the scroll below (WhatsApp pattern). */}
        <div className="flex-none px-3 pt-2.5 pb-2 border-b border-[var(--paper-shadow)] bg-[var(--paper-warm)]">
          <div
            role="tablist"
            aria-label="Status"
            className="-mx-1 flex items-center gap-0.5 overflow-x-auto"
          >
            <StatusTab filters={filters} code={null} label="Any" />
            <StatusTab filters={filters} code="open" label="Open" />
            <StatusTab filters={filters} code="pending" label="Pending" />
            <StatusTab filters={filters} code="snoozed" label="Snoozed" />
            <StatusTab filters={filters} code="closed" label="Closed" />
          </div>
          <ActiveFilterStrip filters={filters} count={rows.length} compact />
        </div>

        {/* Scroll area: search header + thread list. Search scrolls away
            when user scrolls down through threads (WhatsApp pattern). */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="px-3 pt-3 pb-2">
            <InboxSearch initialQ={filters.q} />
          </div>
          {rows.length === 0 ? (
            <EmptyState filters={filters} compact />
          ) : (
            <ul className="flex flex-col">
              {rows.map((row) => (
                <InboxListItem
                  key={row.id}
                  row={row}
                  activePath={activePath}
                  compact
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  // Non-compact (used in <xl fallback inside inbox/page.tsx)
  return (
    <div className="min-w-0">
      <div className="rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)] p-4 mb-5">
        <div className="flex flex-wrap items-center gap-2">
          <FilterLabel>Status · 状态</FilterLabel>
          <StatusFilter filters={filters} code={null} label="Any" />
          <StatusFilter filters={filters} code="open" label="Open" />
          <StatusFilter filters={filters} code="pending" label="Pending" />
          <StatusFilter filters={filters} code="snoozed" label="Snoozed" />
          <StatusFilter filters={filters} code="closed" label="Closed" />
          <span aria-hidden="true" className="flex-1" />
          <InboxSearch initialQ={filters.q} />
        </div>
        <ActiveFilterStrip filters={filters} count={rows.length} />
      </div>

      {rows.length === 0 ? (
        <EmptyState filters={filters} compact={false} />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rows.map((row) => (
            <InboxListItem key={row.id} row={row} activePath={activePath} />
          ))}
        </ul>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Internal primitives (moved from inbox/page.tsx so both render paths share)
// -----------------------------------------------------------------------------

function FilterLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)] mr-1">
      {children}
    </span>
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
  const href = makeHref(filters, { status: code });
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={[
        "inline-flex items-center rounded-[var(--radius-pill)] border tracking-[0.04em] h-7 px-2.5 text-[11px]",
        "transition-[background-color,border-color,color] duration-[var(--dur-fast)]",
        active
          ? "border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
          : "border-[var(--paper-shadow)] bg-transparent text-[var(--ink-mute)] hover:text-[var(--ink)] hover:border-[var(--cinnabar)]/20",
      ].join(" ")}
    >
      {label}
    </Link>
  );
}

// Text-only tab variant — compact-mode equivalent. WhatsApp-style: no border,
// underline + cinnabar text when active. Sits in an overflow-x scroll row so
// it never breaks the column width.
function StatusTab({
  filters,
  code,
  label,
}: {
  filters: InboxListFilters;
  code: InboxListFilters["status"] | null;
  label: string;
}) {
  const active = filters.status === code;
  const href = makeHref(filters, { status: code });
  return (
    <Link
      href={href}
      role="tab"
      aria-selected={active}
      className={[
        "flex-none inline-flex items-center h-7 px-2 text-[11.5px] tracking-[-0.005em]",
        "transition-[color,box-shadow] duration-[var(--dur-fast)]",
        active
          ? "text-[var(--cinnabar-deep)] shadow-[inset_0_-2px_0_var(--cinnabar)]"
          : "text-[var(--ink-mute)] hover:text-[var(--ink)]",
      ].join(" ")}
    >
      {label}
    </Link>
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

  if (filters.lifecycle) {
    chips.push({
      label: compact ? filters.lifecycle : `Lifecycle: ${filters.lifecycle}`,
      href: makeHref(filters, { lifecycle: null }),
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
      href: makeHref(filters, { q: "" }),
    });
  }

  if (chips.length === 0) {
    return (
      <div
        className={
          compact
            ? "mt-1.5 text-[10px] tracking-[0.1em] uppercase text-[var(--ink-faint)] tabular-nums"
            : "mt-2 text-[10.5px] tracking-[0.14em] uppercase text-[var(--ink-faint)]"
        }
      >
        {count.toLocaleString()} thread{count === 1 ? "" : "s"}
        {compact ? "" : ` · scope · ${filters.scope}`}
      </div>
    );
  }

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
    </div>
  );
}

function makeHref(
  filters: InboxListFilters,
  patch: Partial<Pick<InboxListFilters, "scope" | "channel" | "status" | "lifecycle" | "tag" | "q">>,
): string {
  const next = {
    scope: filters.scope,
    channel: filters.channel,
    status: filters.status,
    lifecycle: filters.lifecycle,
    tag: filters.tag,
    q: filters.q,
    ...patch,
  };
  const params = new URLSearchParams();
  if (next.scope !== "mine") params.set("scope", next.scope);
  if (next.channel) params.set("channel", next.channel);
  if (next.status) params.set("status", next.status);
  if (next.lifecycle) params.set("lifecycle", next.lifecycle);
  if (next.tag) params.set("tag", next.tag);
  if (next.q) params.set("q", next.q);
  const qs = params.toString();
  return qs ? `/admin/inbox?${qs}` : "/admin/inbox";
}

function EmptyState({
  filters,
  compact,
}: {
  filters: InboxListFilters;
  compact: boolean;
}) {
  const reason =
    filters.q
      ? `No conversations match "${filters.q}".`
      : filters.lifecycle
        ? `No conversations from participants with status "${filters.lifecycle}".`
        : filters.channel
          ? `No ${filters.channel} conversations in this scope.`
          : filters.scope === "mine"
            ? "No conversations assigned to you yet."
            : filters.scope === "unassigned"
              ? "Nothing in the unassigned queue."
              : "No conversations yet. Once WhatsApp or LINE is wired to the webhooks, threads will land here.";
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
