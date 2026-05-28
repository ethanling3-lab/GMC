import { createSupabaseServerClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import {
  loadChannelCounts,
  loadStatusCounts,
  parseFilters,
} from "@/lib/inbox/inbox-query";
import { listTags } from "@/lib/inbox/tags";
import { listSavedViewsForAdmin } from "@/lib/inbox/saved-views";
import { InboxSidebar } from "@/components/admin/inbox/InboxSidebar";

// Inbox sub-nav — parallel slot scoped to the inbox layout. Lives at the
// inbox level (not the (protected) level) so it unmounts cleanly when the
// user navigates off /admin/inbox/*. No client-side persistence guard
// needed; the layout itself is the lifetime boundary.
//
// `default.tsx` rather than `page.tsx` because every URL under
// /admin/inbox/* (list AND thread) should render the same sidebar — no
// route-specific page needed.

export const dynamic = "force-dynamic";

type SlotProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function InboxSidebarSlot({ searchParams }: SlotProps) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const filters = parseFilters(admin, sp);

  const supabase = await createSupabaseServerClient();
  const [scopeCounts, channelCounts, tags, savedViews] = await Promise.all([
    loadStatusCounts(supabase, { admin_id: admin.id, channel: filters.channel }),
    loadChannelCounts(supabase, { admin_id: admin.id, scope: filters.scope }),
    listTags(),
    listSavedViewsForAdmin(admin),
  ]);

  return (
    <div className="w-full h-full p-3 overflow-y-auto">
      <InboxSidebar
        filters={filters}
        counts={{
          mine: scopeCounts.mine,
          unassigned: scopeCounts.unassigned,
          all: scopeCounts.all,
          channels: channelCounts,
        }}
        tags={tags}
        savedViews={savedViews}
      />
    </div>
  );
}
