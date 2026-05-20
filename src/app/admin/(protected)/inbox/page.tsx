import type { Metadata } from "next";
import { createSupabaseServerClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import {
  loadChannelCounts,
  loadConversations,
  loadStatusCounts,
  parseFilters,
} from "@/lib/inbox/inbox-query";
import { ConversationListView } from "@/components/admin/inbox/ConversationListView";
import { InboxSidebar } from "@/components/admin/inbox/InboxSidebar";

export const metadata: Metadata = { title: "Inbox" };
export const dynamic = "force-dynamic";

// /admin/inbox renders TWO different things depending on viewport:
//
//   xl+ (≥1280px): a "Pick a conversation" empty state in the children area.
//                  The conversation list lives in the persistent `@list`
//                  slot (see inbox/layout.tsx) and stays mounted across
//                  thread navigation.
//
//   <xl:           the list renders INLINE inside the page (the @list slot
//                  is hidden via CSS at this breakpoint). The thread page
//                  remains a separate route.
//
// Both branches read the same searchParams + URL state.

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function InboxRootPage({ searchParams }: PageProps) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const filters = parseFilters(admin, sp);

  const supabase = await createSupabaseServerClient();
  const [rows, scopeCounts, channelCounts] = await Promise.all([
    loadConversations(supabase, filters),
    loadStatusCounts(supabase, { admin_id: admin.id, channel: filters.channel }),
    loadChannelCounts(supabase, { admin_id: admin.id, scope: filters.scope }),
  ]);

  return (
    <div className="h-full flex flex-col">
      {/* xl+: persistent list is in the @list slot — show a picker hint here. */}
      <div className="hidden xl:flex flex-1 min-h-0 items-center justify-center">
        <ConversationPicker count={rows.length} />
      </div>

      {/* <xl: render the full inbox-list page inline. Own scroll container. */}
      <div className="xl:hidden flex-1 min-h-0 overflow-y-auto">
        <div className="px-6 md:px-10 py-10">
          <div className="flex items-end justify-between gap-6 flex-wrap mb-6">
            <div>
              <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
                <span className="w-5 h-px bg-current" />
                Inbox · 收件箱
              </div>
              <h1 className="mt-3 font-display text-[28px] md:text-[32px] leading-[1.05] tracking-[-0.015em] text-[var(--ink)]">
                Every conversation, one place.
              </h1>
            </div>
          </div>

          {/* Sub-nav fallback for <lg (the @sidebar slot column hides below lg). */}
          <div className="lg:hidden mb-5">
            <InboxSidebar
              filters={filters}
              counts={{
                mine: scopeCounts.mine,
                unassigned: scopeCounts.unassigned,
                all: scopeCounts.all,
                channels: channelCounts,
              }}
            />
          </div>

          <ConversationListView filters={filters} rows={rows} />
        </div>
      </div>
    </div>
  );
}

function ConversationPicker({ count }: { count: number }) {
  return (
    <div className="text-center px-8 max-w-[44ch]">
      <div className="inline-flex items-center justify-center w-14 h-14 rounded-full border border-[var(--paper-shadow)] bg-[var(--paper-warm)] text-[var(--cinnabar)] shadow-[var(--shadow-paper-1)] mb-5">
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8l-4 4v-4H5a2 2 0 0 1-2-2z" />
        </svg>
      </div>
      <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
        <span className="w-5 h-px bg-current" />
        Inbox · 收件箱
      </div>
      <h2 className="mt-3 font-display text-[24px] leading-[1.1] tracking-[-0.01em] text-[var(--ink)]">
        Pick a conversation
      </h2>
      <p className="mt-2 text-[13.5px] text-[var(--ink-soft)] leading-[1.65]">
        {count > 0
          ? `${count.toLocaleString()} thread${count === 1 ? "" : "s"} in the current view — choose one on the left to open it here.`
          : "Nothing in the current view. Adjust the sub-nav filters on the left, or wait for new conversations to land."}
      </p>
    </div>
  );
}
