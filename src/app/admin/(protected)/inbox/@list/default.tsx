import { headers } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { loadConversations, parseFilters } from "@/lib/inbox/inbox-query";
import { ConversationListView } from "@/components/admin/inbox/ConversationListView";

// Persistent conversation list — renders in the `@list` slot consumed by
// inbox/layout.tsx. Stays mounted as the user soft-navigates between the
// inbox root and individual threads, so the list doesn't refetch / lose
// scroll on every thread open.
//
// Filter state comes from searchParams (URL is the source of truth);
// active-thread highlight is handled inside InboxListItem via usePathname.

export const dynamic = "force-dynamic";

type SlotProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function InboxListSlot({ searchParams }: SlotProps) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const filters = parseFilters(admin, sp);
  const hdrs = await headers();
  const activePath = hdrs.get("x-pathname") ?? undefined;

  const supabase = await createSupabaseServerClient();
  const rows = await loadConversations(supabase, filters);

  return (
    <ConversationListView
      filters={filters}
      rows={rows}
      compact
      activePath={activePath}
    />
  );
}
