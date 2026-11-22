import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// If `slug` is an event's old address, returns its current slug. A live event
// using that slug always wins, and a missing record simply returns null.
export async function currentEventSlug(
  service: SupabaseClient,
  slug: string,
): Promise<string | null> {
  const { data: live } = await service
    .from("events")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (live) return null;

  const { data } = await service
    .from("event_slug_redirects")
    .select("event:events!inner(slug)")
    .eq("old_slug", slug)
    .maybeSingle();
  const event = (data as unknown as { event: { slug: string } | null } | null)?.event;
  return event?.slug ?? null;
}
