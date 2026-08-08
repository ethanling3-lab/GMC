import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Resolves group_id → table_no for every group seated at a numbered table.
//
// The read direction matters. Always resolve group_id → table_no, NEVER
// assignment.shape_id → table_no: manual pairing via the inspector's group
// <select> writes only `event_floor_plan_shapes.group_id` and leaves
// `event_seat_assignments.shape_id` null/stale. Only auto-place writes both.
// `shapes.group_id` is the authoritative pairing.
//
// Returned as a Map rather than nesting another PostgREST `!inner` embed into
// each caller's query — same reasoning already commented in check-in-query.ts:
// one small extra round trip beats widening four list queries. The two genuine
// single-row lookups (check-in-write) do use a nested embed instead.
//
// Requires a client that can read event_floor_plan_shapes — RLS on that table
// is admin-only (migration 021), so participant-scoped callers such as
// group-report-portal MUST pass the service client.

export type TableNoScope =
  // Every group in one event. The common case.
  | { eventId: string }
  // Specific groups, possibly spanning events — group-report-portal fetches
  // groups by id and never has an event_id to filter on.
  | { groupIds: string[] };

export async function tableNoByGroupId(
  client: SupabaseClient,
  scope: TableNoScope,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();

  if ("groupIds" in scope && scope.groupIds.length === 0) return out;

  let query = client
    .from("event_floor_plan_shapes")
    .select("group_id, table_no")
    .not("group_id", "is", null)
    .not("table_no", "is", null);

  query =
    "eventId" in scope
      ? query.eq("event_id", scope.eventId)
      : // Covered by the partial index event_floor_plan_shapes_group_idx
        // on (group_id) where group_id is not null (migration 021).
        query.in("group_id", scope.groupIds);

  const { data, error } = await query;
  if (error || !data) {
    // Non-fatal by design: a missing table number degrades every surface to
    // the group's own number, which is exactly the unplaced-group fallback.
    // Never block a check-in or a portal page on this.
    if (error) {
      console.error("tableNoByGroupId failed", error.message);
    }
    return out;
  }

  for (const row of data as { group_id: string; table_no: number }[]) {
    // First write wins. A group paired to two shapes is a pre-existing data
    // bug the editor now guards against; picking deterministically here beats
    // letting the last row silently win.
    if (!out.has(row.group_id)) out.set(row.group_id, row.table_no);
  }
  return out;
}
