import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase";
import type {
  CourseAssignmentKind,
  CourseAssignmentView,
  CourseCard,
  CourseDetail,
  CourseSubmissionStatus,
  CourseSubmissionType,
  MySubmissionView,
} from "@/lib/course-portal-types";

// Server-only read path for the /me/courses portal. A "course" is an event a
// participant is enrolled in. Everything here is scoped to one participant and
// only exposes participant-safe fields — no admin-internal scoring, no other
// participants' submissions.

// A participant "has" a course when an enrollment row links them to the event.
// We surface every enrollment (regardless of status) as a course card, the
// same set /me/enrollments already shows.

export async function loadSelfCourses(participantId: string): Promise<CourseCard[]> {
  const service = createSupabaseServiceClient();

  const { data: enrollments, error } = await service
    .from("enrollments")
    .select(
      "status, payment_status, event:events(id, slug, title_en, title_cn, start_date, end_date, venue, poster_url)",
    )
    .eq("participant_id", participantId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);

  type Row = {
    status: string;
    payment_status: string;
    event: {
      id: string;
      slug: string;
      title_en: string | null;
      title_cn: string | null;
      start_date: string | null;
      end_date: string | null;
      venue: string | null;
      poster_url: string | null;
    } | null;
  };

  // De-dupe by event (a participant could in theory have >1 enrollment row for
  // an event across history); keep the first (most recent) per event.
  const byEvent = new Map<string, Row>();
  for (const r of (enrollments ?? []) as unknown as Row[]) {
    if (!r.event) continue;
    if (!byEvent.has(r.event.id)) byEvent.set(r.event.id, r);
  }
  const eventIds = [...byEvent.keys()];
  if (eventIds.length === 0) return [];

  // Assignment counts per event (active only).
  const assignmentCount = new Map<string, number>();
  const assignmentIdsByEvent = new Map<string, string[]>();
  const { data: assignments } = await service
    .from("course_assignments")
    .select("id, event_id")
    .in("event_id", eventIds)
    .is("deleted_at", null)
    .eq("active", true);
  for (const a of (assignments ?? []) as Array<{ id: string; event_id: string }>) {
    assignmentCount.set(a.event_id, (assignmentCount.get(a.event_id) ?? 0) + 1);
    const arr = assignmentIdsByEvent.get(a.event_id) ?? [];
    arr.push(a.id);
    assignmentIdsByEvent.set(a.event_id, arr);
  }

  // How many of this participant's assignments are submitted, per event.
  const submittedCount = new Map<string, number>();
  const allAssignmentIds = [...assignmentIdsByEvent.values()].flat();
  if (allAssignmentIds.length > 0) {
    const { data: subs } = await service
      .from("course_submissions")
      .select("assignment_id, status")
      .eq("participant_id", participantId)
      .in("assignment_id", allAssignmentIds)
      .eq("status", "submitted");
    const assignmentToEvent = new Map<string, string>();
    for (const [eventId, ids] of assignmentIdsByEvent) {
      for (const id of ids) assignmentToEvent.set(id, eventId);
    }
    for (const s of (subs ?? []) as Array<{ assignment_id: string; status: string }>) {
      const eventId = assignmentToEvent.get(s.assignment_id);
      if (eventId) submittedCount.set(eventId, (submittedCount.get(eventId) ?? 0) + 1);
    }
  }

  // Recording grants this participant holds, bucketed by event.
  const recordingCount = new Map<string, number>();
  const { data: grants } = await service
    .from("event_recording_access")
    .select("recording:event_recordings(event_id, deleted_at)")
    .eq("participant_id", participantId)
    .is("revoked_at", null);
  for (const g of (grants ?? []) as unknown as Array<{
    recording: { event_id: string; deleted_at: string | null } | null;
  }>) {
    if (!g.recording || g.recording.deleted_at) continue;
    if (!byEvent.has(g.recording.event_id)) continue;
    recordingCount.set(
      g.recording.event_id,
      (recordingCount.get(g.recording.event_id) ?? 0) + 1,
    );
  }

  return eventIds.map((eventId) => {
    const r = byEvent.get(eventId)!;
    const ev = r.event!;
    return {
      event_id: ev.id,
      slug: ev.slug,
      title_en: ev.title_en,
      title_cn: ev.title_cn,
      start_date: ev.start_date,
      end_date: ev.end_date,
      venue: ev.venue,
      poster_url: ev.poster_url,
      enrollment_status: r.status,
      payment_status: r.payment_status,
      assignment_count: assignmentCount.get(eventId) ?? 0,
      submitted_count: submittedCount.get(eventId) ?? 0,
      recording_count: recordingCount.get(eventId) ?? 0,
    };
  });
}

// Full course detail for one event, gated on the participant being enrolled.
// Returns null when the participant has no enrollment for the event (the page
// then 404s — don't leak course existence).
export async function loadCourseDetail(
  participantId: string,
  eventId: string,
): Promise<CourseDetail | null> {
  const service = createSupabaseServiceClient();

  const { data: enrollment } = await service
    .from("enrollments")
    .select("id")
    .eq("participant_id", participantId)
    .eq("event_id", eventId)
    .limit(1)
    .maybeSingle();
  if (!enrollment) return null;

  const { data: eventRaw } = await service
    .from("events")
    .select(
      "id, slug, title_en, title_cn, start_date, end_date, venue, poster_url, body_en, body_cn",
    )
    .eq("id", eventId)
    .maybeSingle();
  if (!eventRaw) return null;
  const event = eventRaw as CourseDetail["event"];

  // Assignments for the event + this participant's submission (if any).
  const { data: assignmentsRaw } = await service
    .from("course_assignments")
    .select(
      "id, title_en, title_cn, description_en, description_cn, kind, submission_type, due_at",
    )
    .eq("event_id", eventId)
    .is("deleted_at", null)
    .eq("active", true)
    .order("created_at", { ascending: true });

  const assignmentRows = (assignmentsRaw ?? []) as Array<{
    id: string;
    title_en: string | null;
    title_cn: string | null;
    description_en: string | null;
    description_cn: string | null;
    kind: CourseAssignmentKind;
    submission_type: CourseSubmissionType;
    due_at: string | null;
  }>;

  const mineByAssignment = new Map<string, MySubmissionView>();
  if (assignmentRows.length > 0) {
    const { data: subs } = await service
      .from("course_submissions")
      .select("id, assignment_id, status, text_body, submitted_at")
      .eq("participant_id", participantId)
      .in(
        "assignment_id",
        assignmentRows.map((a) => a.id),
      );
    const subRows = (subs ?? []) as Array<{
      id: string;
      assignment_id: string;
      status: CourseSubmissionStatus;
      text_body: string | null;
      submitted_at: string | null;
    }>;
    const fileMap = new Map<string, MySubmissionView["files"]>();
    if (subRows.length > 0) {
      const { data: files } = await service
        .from("course_submission_files")
        .select("id, submission_id, storage_path, filename, mime_type, byte_size")
        .in(
          "submission_id",
          subRows.map((s) => s.id),
        )
        .order("created_at", { ascending: true });
      for (const f of (files ?? []) as Array<{
        id: string;
        submission_id: string;
        storage_path: string;
        filename: string;
        mime_type: string | null;
        byte_size: number | null;
      }>) {
        const arr = fileMap.get(f.submission_id) ?? [];
        arr.push({
          id: f.id,
          storage_path: f.storage_path,
          filename: f.filename,
          mime_type: f.mime_type,
          byte_size: f.byte_size,
        });
        fileMap.set(f.submission_id, arr);
      }
    }
    for (const s of subRows) {
      mineByAssignment.set(s.assignment_id, {
        id: s.id,
        status: s.status,
        text_body: s.text_body,
        submitted_at: s.submitted_at,
        files: fileMap.get(s.id) ?? [],
      });
    }
  }

  const assignments: CourseAssignmentView[] = assignmentRows.map((a) => ({
    ...a,
    mine: mineByAssignment.get(a.id) ?? null,
  }));

  // Recordings for this event the participant has been granted.
  const { data: grantRows } = await service
    .from("event_recording_access")
    .select(
      "recording:event_recordings(id, event_id, title_en, title_cn, duration_seconds, deleted_at)",
    )
    .eq("participant_id", participantId)
    .is("revoked_at", null);
  const recordings = ((grantRows ?? []) as unknown as Array<{
    recording: {
      id: string;
      event_id: string;
      title_en: string | null;
      title_cn: string | null;
      duration_seconds: number | null;
      deleted_at: string | null;
    } | null;
  }>)
    .filter((g) => g.recording && !g.recording.deleted_at && g.recording.event_id === eventId)
    .map((g) => ({
      id: g.recording!.id,
      title_en: g.recording!.title_en,
      title_cn: g.recording!.title_cn,
      duration_seconds: g.recording!.duration_seconds,
    }));

  return { event, assignments, recordings };
}

// Gate helper shared by the /me/assignments API routes: confirm the
// participant is enrolled in the event that owns the assignment, and return
// the assignment's submission_type + event_id. Returns null when the
// assignment doesn't exist, is inactive, or the participant isn't enrolled.
export async function resolveSubmittableAssignment(
  participantId: string,
  assignmentId: string,
): Promise<{ eventId: string; submissionType: CourseSubmissionType } | null> {
  const service = createSupabaseServiceClient();
  const { data: assignment } = await service
    .from("course_assignments")
    .select("id, event_id, submission_type, active, deleted_at")
    .eq("id", assignmentId)
    .maybeSingle();
  if (!assignment) return null;
  const a = assignment as {
    event_id: string;
    submission_type: CourseSubmissionType;
    active: boolean;
    deleted_at: string | null;
  };
  if (!a.active || a.deleted_at) return null;

  const { data: enrollment } = await service
    .from("enrollments")
    .select("id")
    .eq("participant_id", participantId)
    .eq("event_id", a.event_id)
    .limit(1)
    .maybeSingle();
  if (!enrollment) return null;

  return { eventId: a.event_id, submissionType: a.submission_type };
}
