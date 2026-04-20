import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Mints (or reuses) the participant's `region_id` — the human-readable
// student ID like SG042 / MY017. Per GMC's policy this only happens once
// an admin approves the registration, so callers wire it into the
// approve / mark_paid / manual-create-as-approved transitions, NOT into
// public /register.
//
// The heavy lifting lives in the SQL function `assign_region_id`
// (migration 012) which holds a per-country transaction advisory lock
// across both the max-lookup AND the participant update — so two
// concurrent admin approvals in the same country can't compute the same
// number. The function is idempotent: returning students keep their
// existing ID, no-ops are free.

/**
 * Ensures the participant has a region_id, assigning one if missing.
 * Returns the resolved id, or null if the participant doesn't exist.
 * Failures are returned as null + logged — never throw — so a missing
 * student-ID assignment doesn't block the underlying approval transaction
 * from completing. (We'd rather an admin sees "participant approved but ID
 * missing, click again" than the whole approve action fail.)
 */
export async function ensureRegionId(
  client: SupabaseClient,
  participantId: string,
): Promise<string | null> {
  const { data, error } = await client.rpc("assign_region_id", {
    p_participant_id: participantId,
  });
  if (error) {
    console.warn("[region-id] assign failed", participantId, error.message);
    return null;
  }
  if (typeof data === "string" && data.length > 0) return data;
  return null;
}
