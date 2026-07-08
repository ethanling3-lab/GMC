import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase";

// Scoped read path for the /me portal. Explicitly enumerates the
// participant-safe fields — EXCLUDES every admin-internal column:
//   financial_score, influence_score, zu_zhang_*, face_archetype_suggested,
//   face_type, parameter_framework, cs_notes, cs_evaluation,
//   recommended_courses, forbidden_courses, interaction_notes,
//   suggested_group_leader_notes, course_needs, motivation_tag,
//   energy_profile, health_status, family_situation, sub_region,
//   has_special_contribution, times_led_groups, conflict pairs etc.
//
// Every /me page MUST read through this helper rather than touching the
// participants table directly. That's the participant-privacy contract.

export type SelfProfile = {
  id: string;
  region_id: string | null;
  name_en: string | null;
  name_cn: string | null;
  email: string | null;
  phone: string | null;
  region: string | null;
  language_fluency: "en" | "cn" | "both" | null;
  gender: string | null;
  birth_date: string | null;
  occupation: string | null;
  industry: string | null;
  dharma_name: string | null;
  religion: string | null;
  training_level: string | null;
  is_old_student: boolean;
  front_photo_url: string | null;
  attended_courses: Array<{
    course_name: string;
    date?: string | null;
  }>;
};

export async function loadSelfProfile(participantId: string): Promise<SelfProfile | null> {
  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from("participants")
    .select(
      "id, region_id, name_en, name_cn, email, phone, region, language_fluency, gender, birth_date, occupation, industry, dharma_name, religion, training_level, is_old_student, front_photo_url, attended_courses",
    )
    .eq("id", participantId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as SelfProfile & {
    attended_courses: SelfProfile["attended_courses"] | null;
  };
  return {
    ...row,
    attended_courses: Array.isArray(row.attended_courses) ? row.attended_courses : [],
  };
}

// Self enrollments — pulls the participant's own enrollment rows joined
// to event for the table render.
export type SelfEnrollmentRow = {
  enrollment_id: string;
  status: string;
  payment_status: string;
  payment_method: string | null;
  amount_paid: number | string | null;
  paid_at: string | null;
  created_at: string;
  event: {
    id: string;
    slug: string;
    title_en: string | null;
    title_cn: string | null;
    start_date: string | null;
    end_date: string | null;
    venue: string | null;
    price: number | string | null;
  };
};

export async function loadSelfEnrollments(participantId: string): Promise<SelfEnrollmentRow[]> {
  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from("enrollments")
    .select(
      "id, status, payment_status, payment_method, amount_paid, paid_at, created_at, event:events(id, slug, title_en, title_cn, start_date, end_date, venue, price)",
    )
    .eq("participant_id", participantId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Array<{
    id: string;
    status: string;
    payment_status: string;
    payment_method: string | null;
    amount_paid: number | string | null;
    paid_at: string | null;
    created_at: string;
    event: SelfEnrollmentRow["event"] | null;
  }>)
    .filter((r) => r.event !== null)
    .map((r) => ({
      enrollment_id: r.id,
      status: r.status,
      payment_status: r.payment_status,
      payment_method: r.payment_method,
      amount_paid: r.amount_paid,
      paid_at: r.paid_at,
      created_at: r.created_at,
      event: r.event!,
    }));
}

// Self flight info — flight_info rows for the participant's enrollments.
export type SelfFlightRow = {
  id: string;
  enrollment_id: string;
  event_title: string | null;
  direction: "arrival" | "departure";
  flight_number: string | null;
  airline: string | null;
  iata: string | null;
  scheduled_at: string | null;
  terminal: string | null;
  confirmed: boolean;
};

export async function loadSelfFlights(participantId: string): Promise<SelfFlightRow[]> {
  const service = createSupabaseServiceClient();
  // Build the (enrollment → event) lookup first so we can label rows.
  const { data: enrollments } = await service
    .from("enrollments")
    .select("id, event:events(id, title_en, title_cn)")
    .eq("participant_id", participantId);
  const enrollmentIdToEvent = new Map<string, { title_en: string | null; title_cn: string | null } | null>();
  for (const e of (enrollments ?? []) as unknown as Array<{
    id: string;
    event: { title_en: string | null; title_cn: string | null } | null;
  }>) {
    enrollmentIdToEvent.set(e.id, e.event);
  }
  const enrollmentIds = [...enrollmentIdToEvent.keys()];
  if (enrollmentIds.length === 0) return [];

  const { data: flights } = await service
    .from("flight_info")
    .select(
      "id, enrollment_id, direction, flight_number, airline, iata, scheduled_at, terminal, confirmed",
    )
    .in("enrollment_id", enrollmentIds)
    .order("scheduled_at", { ascending: true, nullsFirst: false });

  return ((flights ?? []) as unknown as Array<{
    id: string;
    enrollment_id: string;
    direction: "arrival" | "departure";
    flight_number: string | null;
    airline: string | null;
    iata: string | null;
    scheduled_at: string | null;
    terminal: string | null;
    confirmed: boolean;
  }>).map((f) => {
    const ev = enrollmentIdToEvent.get(f.enrollment_id) ?? null;
    return {
      ...f,
      event_title: ev ? ev.title_en ?? ev.title_cn : null,
    };
  });
}

// Self recordings — recordings the participant has been granted access to.
export type SelfRecordingRow = {
  id: string;
  event_id: string;
  event_title: string | null;
  title_en: string | null;
  title_cn: string | null;
  duration_seconds: number | null;
  granted_at: string;
};

export async function loadSelfRecordings(participantId: string): Promise<SelfRecordingRow[]> {
  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from("event_recording_access")
    .select(
      "granted_at, recording:event_recordings(id, event_id, title_en, title_cn, duration_seconds, deleted_at, event:events(title_en, title_cn))",
    )
    .eq("participant_id", participantId)
    .is("revoked_at", null)
    .order("granted_at", { ascending: false });
  if (error) throw new Error(error.message);

  type RawRow = {
    granted_at: string;
    recording: {
      id: string;
      event_id: string;
      title_en: string | null;
      title_cn: string | null;
      duration_seconds: number | null;
      deleted_at: string | null;
      event: { title_en: string | null; title_cn: string | null } | null;
    } | null;
  };

  return ((data ?? []) as unknown as RawRow[])
    .filter((r) => r.recording !== null && !r.recording.deleted_at)
    .map((r) => ({
      id: r.recording!.id,
      event_id: r.recording!.event_id,
      event_title: r.recording!.event?.title_en ?? r.recording!.event?.title_cn ?? null,
      title_en: r.recording!.title_en,
      title_cn: r.recording!.title_cn,
      duration_seconds: r.recording!.duration_seconds,
      granted_at: r.granted_at,
    }));
}
