import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  EventCohortFilter,
  EnrollmentStatusForBroadcast,
} from "./types";

// Loads the (participant, enrollment) pairs for an event-cohort audience.
// Returns a flat list keyed on enrollment so the sender can interpolate
// per-enrollment tokens (${amount_due}, ${payment_link}).
//
// Filters supported:
//   - enrollment_statuses: [] = all (composer default is ['approved', 'paid'])
//   - language: filters on participants.language_fluency
//   - tag_slug: filters on conversations.tags (the inbox tag taxonomy)
//
// Drops rows with no enrollment + no participant (FK should make this
// unreachable, but defensive). Caller adds the channel-address resolution
// downstream via collectAddresses().

export type EventCohortRow = {
  participant_id: string;
  enrollment_id: string;
  name_cn: string | null;
  name_en: string | null;
  region_id: string | null;
  region: string | null;
  email: string | null;
  phone: string | null;
  language_fluency: "en" | "cn" | "both" | null;
};

export async function loadEventCohort(
  service: SupabaseClient,
  filter: EventCohortFilter,
): Promise<EventCohortRow[]> {
  // If tag_slug is set, first collect the set of participant_ids whose
  // conversations carry that tag — same two-query pattern as inbox-query.ts.
  let participantIdsForTag: Set<string> | null = null;
  if (filter.tag_slug) {
    const { data: convRows, error: convErr } = await service
      .from("conversations")
      .select("participant_id")
      .contains("tags", [filter.tag_slug])
      .limit(5000);
    if (convErr) throw new Error(convErr.message);
    participantIdsForTag = new Set((convRows ?? []).map((r) => r.participant_id as string));
    if (participantIdsForTag.size === 0) return [];
  }

  let q = service
    .from("enrollments")
    .select(
      "id, participant_id, status, participant:participants(id, name_cn, name_en, region_id, region, email, phone, language_fluency)",
    )
    .eq("event_id", filter.event_id)
    .limit(5000);

  const statuses = filter.enrollment_statuses;
  if (statuses.length > 0) {
    q = q.in("status", statuses as EnrollmentStatusForBroadcast[]);
  }

  if (filter.language) {
    // Filter via the joined participants row.
    q = q.eq("participant.language_fluency", filter.language);
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  const rows: EventCohortRow[] = [];
  for (const e of (data ?? []) as unknown as Array<{
    id: string;
    participant_id: string;
    status: string;
    participant: {
      id: string;
      name_cn: string | null;
      name_en: string | null;
      region_id: string | null;
      region: string | null;
      email: string | null;
      phone: string | null;
      language_fluency: "en" | "cn" | "both" | null;
    } | null;
  }>) {
    if (!e.participant) continue;
    if (filter.language && e.participant.language_fluency !== filter.language) continue;
    if (participantIdsForTag && !participantIdsForTag.has(e.participant_id)) continue;
    rows.push({
      participant_id: e.participant_id,
      enrollment_id: e.id,
      name_cn: e.participant.name_cn,
      name_en: e.participant.name_en,
      region_id: e.participant.region_id,
      region: e.participant.region,
      email: e.participant.email,
      phone: e.participant.phone,
      language_fluency: e.participant.language_fluency,
    });
  }

  return rows;
}
