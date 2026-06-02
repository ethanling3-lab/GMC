import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase";

// Volunteer recruit helpers — read paths for the /me/recruit dashboard.

export type RecentRecruit = {
  enrollment_id: string;
  status: string;
  payment_status: string;
  created_at: string;
  lead: {
    participant_id: string;
    name_cn: string | null;
    name_en: string | null;
    phone: string | null;
    email: string | null;
  } | null;
  event: {
    id: string;
    slug: string;
    title_en: string | null;
    title_cn: string | null;
  } | null;
};

// Eligibility: has at least one past-paid enrollment.
export async function isEligibleVolunteer(participantId: string): Promise<boolean> {
  const service = createSupabaseServiceClient();
  const { count } = await service
    .from("enrollments")
    .select("id", { count: "exact", head: true })
    .eq("participant_id", participantId)
    .in("status", ["paid", "approved"]);
  return (count ?? 0) > 0;
}

// Recent recruits — leads this volunteer has added via /me/recruit.
// Identified by participants.referrer_id pointing at the volunteer.
export async function loadRecentRecruits(volunteerId: string): Promise<RecentRecruit[]> {
  const service = createSupabaseServiceClient();

  // Find lead participants where referrer_id = volunteerId.
  const { data: leadIds } = await service
    .from("participants")
    .select("id")
    .eq("referrer_id", volunteerId)
    .limit(200);
  const ids = (leadIds ?? []).map((r) => (r as { id: string }).id);
  if (ids.length === 0) return [];

  const { data, error } = await service
    .from("enrollments")
    .select(
      "id, status, payment_status, created_at, participant_id, participant:participants(id, name_cn, name_en, phone, email), event:events(id, slug, title_en, title_cn)",
    )
    .eq("recruited_via_portal", true)
    .in("participant_id", ids)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);

  return ((data ?? []) as unknown as Array<{
    id: string;
    status: string;
    payment_status: string;
    created_at: string;
    participant_id: string;
    participant: {
      id: string;
      name_cn: string | null;
      name_en: string | null;
      phone: string | null;
      email: string | null;
    } | null;
    event: {
      id: string;
      slug: string;
      title_en: string | null;
      title_cn: string | null;
    } | null;
  }>).map((row) => ({
    enrollment_id: row.id,
    status: row.status,
    payment_status: row.payment_status,
    created_at: row.created_at,
    lead: row.participant
      ? {
          participant_id: row.participant.id,
          name_cn: row.participant.name_cn,
          name_en: row.participant.name_en,
          phone: row.participant.phone,
          email: row.participant.email,
        }
      : null,
    event: row.event,
  }));
}

// Active events open for registration — used by the Add-lead form's
// event-chip picker. Defaults to events with status='open'.
export type OpenEventOption = {
  id: string;
  slug: string;
  title_en: string | null;
  title_cn: string | null;
  start_date: string | null;
  price: number | string | null;
};

export async function loadOpenEvents(): Promise<OpenEventOption[]> {
  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from("events")
    .select("id, slug, title_en, title_cn, start_date, price")
    .eq("status", "open")
    .order("start_date", { ascending: true, nullsFirst: false })
    .limit(20);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as OpenEventOption[];
}
