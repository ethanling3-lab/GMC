import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { normalizePhone } from "@/lib/whatsapp/phone";
import { TRANSFER_ELIGIBLE_OR, TRANSFER_EXCLUDED_STATUSES } from "./eligibility";

// Loader for "who has submitted their flight info, who hasn't" — feeds the
// pending-flights panel on the transfer-list detail page, the aggregate count
// on the overview, and the pre-generation confirm dialog.
//
// "Confirmed" means flight_info.confirmed_at IS NOT NULL — that's what the
// generator actually uses. A draft flight (entered but not confirmed) is
// surfaced separately so admin can chase the confirmation, not a brand-new
// submission. "needs_time" is a confirmed flight with no scheduled time: the
// generator can't place it, so it must not count as ready. "not_needed" is
// someone staff marked as not needing this transfer; a saved flight overrides it.

export type FlightStatus = "confirmed" | "needs_time" | "draft" | "missing" | "not_needed";

const CHASE_WEIGHT: Record<FlightStatus, number> = {
  needs_time: 3,
  missing: 2,
  draft: 1,
  confirmed: 0,
  not_needed: 0,
};

export type EnrolmentSubmission = {
  enrollment_id: string;
  participant_id: string;
  region_id: string | null;
  name: string;
  arrival: FlightStatus;
  departure: FlightStatus;
  /** Valid international number for a WhatsApp link, or null. */
  phone_e164: string | null;
  contacted_at: string | null;
  contacted_by: string | null;
  contact_note: string | null;
};

export type FlightSubmissionStatus = {
  total_enrolled: number;
  arrival: Record<FlightStatus, number>;
  departure: Record<FlightStatus, number>;
  enrolments: EnrolmentSubmission[];
};

type EnrolRow = {
  id: string;
  participant: {
    id: string;
    region_id: string | null;
    region: string | null;
    phone: string | null;
    name_en: string | null;
    name_cn: string | null;
  } | null;
};

type FollowupRow = {
  enrollment_id: string;
  contacted_at: string | null;
  contacted_by: string | null;
  contact_note: string | null;
  arrival_not_needed: boolean;
  departure_not_needed: boolean;
};

type FlightRow = {
  enrollment_id: string;
  direction: "arrival" | "departure";
  confirmed_at: string | null;
  scheduled_at: string | null;
};

export async function loadFlightSubmissionStatus(
  supabase: SupabaseClient,
  eventId: string,
): Promise<FlightSubmissionStatus> {
  const { data: enrolRows } = await supabase
    .from("enrollments")
    .select(
      "id, participant:participants!inner(id, region_id, region, phone, name_en, name_cn)",
    )
    .eq("event_id", eventId)
    .or(TRANSFER_ELIGIBLE_OR)
    .not("status", "in", TRANSFER_EXCLUDED_STATUSES)
    .returns<EnrolRow[]>();

  const enrolments = enrolRows ?? [];
  const enrollmentIds = enrolments.map((e) => e.id);

  const flightByEnrolDir = new Map<string, FlightStatus>();
  if (enrollmentIds.length > 0) {
    const { data: flightRows } = await supabase
      .from("flight_info")
      .select("enrollment_id, direction, confirmed_at, scheduled_at")
      .in("enrollment_id", enrollmentIds)
      .returns<FlightRow[]>();
    for (const f of flightRows ?? []) {
      const key = `${f.enrollment_id}:${f.direction}`;
      flightByEnrolDir.set(
        key,
        !f.confirmed_at ? "draft" : f.scheduled_at ? "confirmed" : "needs_time",
      );
    }
  }

  // Follow-ups are staff-only and read on the server, after the page's role check.
  const followups = new Map<string, FollowupRow>();
  const staffNames = new Map<string, string>();
  if (enrollmentIds.length > 0) {
    const service = createSupabaseServiceClient();
    const { data: followupRows } = await service
      .from("flight_followups")
      .select(
        "enrollment_id, contacted_at, contacted_by, contact_note, arrival_not_needed, departure_not_needed",
      )
      .in("enrollment_id", enrollmentIds)
      .returns<FollowupRow[]>();
    for (const f of followupRows ?? []) followups.set(f.enrollment_id, f);
    const staffIds = [
      ...new Set(
        (followupRows ?? [])
          .map((f) => f.contacted_by)
          .filter((x): x is string => Boolean(x)),
      ),
    ];
    if (staffIds.length > 0) {
      const { data: staff } = await service
        .from("admins")
        .select("id, name_en, name_cn")
        .in("id", staffIds);
      for (const a of staff ?? []) staffNames.set(a.id, a.name_en || a.name_cn || "Staff");
    }
  }

  const status: FlightSubmissionStatus = {
    total_enrolled: enrolments.length,
    arrival: { confirmed: 0, needs_time: 0, draft: 0, missing: 0, not_needed: 0 },
    departure: { confirmed: 0, needs_time: 0, draft: 0, missing: 0, not_needed: 0 },
    enrolments: [],
  };

  for (const e of enrolments) {
    const followup = followups.get(e.id);
    const arrival =
      flightByEnrolDir.get(`${e.id}:arrival`) ??
      (followup?.arrival_not_needed ? "not_needed" : "missing");
    const departure =
      flightByEnrolDir.get(`${e.id}:departure`) ??
      (followup?.departure_not_needed ? "not_needed" : "missing");
    const phone = normalizePhone(e.participant?.phone, e.participant?.region);
    status.arrival[arrival] += 1;
    status.departure[departure] += 1;
    status.enrolments.push({
      enrollment_id: e.id,
      participant_id: e.participant?.id ?? "",
      region_id: e.participant?.region_id ?? null,
      name:
        e.participant?.name_en ||
        e.participant?.name_cn ||
        e.id.slice(0, 8),
      arrival,
      departure,
      phone_e164: phone.ok ? phone.e164 : null,
      contacted_at: followup?.contacted_at ?? null,
      contacted_by: followup?.contacted_by
        ? (staffNames.get(followup.contacted_by) ?? "Staff")
        : null,
      contact_note: followup?.contact_note ?? null,
    });
  }

  // Sort: people who need a time first, then the most to chase, then region_id, name.
  status.enrolments.sort((a, b) => {
    const aTime = a.arrival === "needs_time" || a.departure === "needs_time";
    const bTime = b.arrival === "needs_time" || b.departure === "needs_time";
    if (aTime !== bTime) return aTime ? -1 : 1;
    const aMissing = CHASE_WEIGHT[a.arrival] + CHASE_WEIGHT[a.departure];
    const bMissing = CHASE_WEIGHT[b.arrival] + CHASE_WEIGHT[b.departure];
    if (aMissing !== bMissing) return bMissing - aMissing;
    const ar = a.region_id ?? "zz";
    const br = b.region_id ?? "zz";
    if (ar !== br) return ar.localeCompare(br);
    return a.name.localeCompare(b.name);
  });

  return status;
}
