import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Capacity counted as "anything occupying a seat" — pending_approval +
// approved + paid. Cancelled and rejected don't count. The same rule applies
// to public registrations and admin manual enrolments.
const ACTIVE_STATUSES = ["pending_approval", "approved", "paid"] as const;

export async function countActiveEnrollments(
  client: SupabaseClient,
  eventId: string,
): Promise<number> {
  const { count, error } = await client
    .from("enrollments")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId)
    .in("status", ACTIVE_STATUSES as readonly string[]);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export type CapacityCheck = {
  capacity: number | null;
  current: number;
  full: boolean;
  remaining: number | null;
};

export async function checkCapacity(
  client: SupabaseClient,
  eventId: string,
  capacity: number | null,
): Promise<CapacityCheck> {
  const current = await countActiveEnrollments(client, eventId);
  const remaining = capacity === null ? null : Math.max(0, capacity - current);
  const full = capacity !== null && current >= capacity;
  return { capacity, current, full, remaining };
}

/** Convenience for the simple "is it full" branch. */
export async function isEventFull(
  client: SupabaseClient,
  eventId: string,
  capacity: number | null,
): Promise<boolean> {
  if (capacity === null) return false;
  const current = await countActiveEnrollments(client, eventId);
  return current >= capacity;
}
