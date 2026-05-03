import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Loader for "who has submitted their flight info, who hasn't" — feeds the
// pending-flights panel on the transfer-list detail page, the aggregate count
// on the overview, and the pre-generation confirm dialog.
//
// "Confirmed" means flight_info.confirmed_at IS NOT NULL — that's what the
// generator actually uses. A draft flight (entered but not confirmed) is
// surfaced separately so admin can chase the confirmation, not a brand-new
// submission.

export type FlightStatus = "confirmed" | "draft" | "missing";

export type EnrolmentSubmission = {
  enrollment_id: string;
  participant_id: string;
  region_id: string | null;
  name: string;
  arrival: FlightStatus;
  departure: FlightStatus;
};

export type FlightSubmissionStatus = {
  total_enrolled: number;
  arrival: { confirmed: number; draft: number; missing: number };
  departure: { confirmed: number; draft: number; missing: number };
  enrolments: EnrolmentSubmission[];
};

type EnrolRow = {
  id: string;
  participant: {
    id: string;
    region_id: string | null;
    name_en: string | null;
    name_cn: string | null;
  } | null;
};

type FlightRow = {
  enrollment_id: string;
  direction: "arrival" | "departure";
  confirmed_at: string | null;
};

export async function loadFlightSubmissionStatus(
  supabase: SupabaseClient,
  eventId: string,
): Promise<FlightSubmissionStatus> {
  const { data: enrolRows } = await supabase
    .from("enrollments")
    .select(
      "id, participant:participants!inner(id, region_id, name_en, name_cn)",
    )
    .eq("event_id", eventId)
    .in("status", ["approved", "paid"])
    .returns<EnrolRow[]>();

  const enrolments = enrolRows ?? [];
  const enrollmentIds = enrolments.map((e) => e.id);

  const flightByEnrolDir = new Map<string, FlightStatus>();
  if (enrollmentIds.length > 0) {
    const { data: flightRows } = await supabase
      .from("flight_info")
      .select("enrollment_id, direction, confirmed_at")
      .in("enrollment_id", enrollmentIds)
      .returns<FlightRow[]>();
    for (const f of flightRows ?? []) {
      const key = `${f.enrollment_id}:${f.direction}`;
      flightByEnrolDir.set(
        key,
        f.confirmed_at ? "confirmed" : "draft",
      );
    }
  }

  const status: FlightSubmissionStatus = {
    total_enrolled: enrolments.length,
    arrival: { confirmed: 0, draft: 0, missing: 0 },
    departure: { confirmed: 0, draft: 0, missing: 0 },
    enrolments: [],
  };

  for (const e of enrolments) {
    const arrival = flightByEnrolDir.get(`${e.id}:arrival`) ?? "missing";
    const departure = flightByEnrolDir.get(`${e.id}:departure`) ?? "missing";
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
    });
  }

  // Sort: missing arrivals first (most chaseable), then by region_id, then name.
  status.enrolments.sort((a, b) => {
    const aMissing = (a.arrival === "missing" ? 2 : a.arrival === "draft" ? 1 : 0) +
      (a.departure === "missing" ? 2 : a.departure === "draft" ? 1 : 0);
    const bMissing = (b.arrival === "missing" ? 2 : b.arrival === "draft" ? 1 : 0) +
      (b.departure === "missing" ? 2 : b.departure === "draft" ? 1 : 0);
    if (aMissing !== bMissing) return bMissing - aMissing;
    const ar = a.region_id ?? "zz";
    const br = b.region_id ?? "zz";
    if (ar !== br) return ar.localeCompare(br);
    return a.name.localeCompare(b.name);
  });

  return status;
}
