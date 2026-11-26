import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { sgDay, validUntilDay } from "@/lib/pricing/tiers";
import { listProgrammeCourses } from "./courses";

// "My programme · 我的配套" on /me/programme (Ethan, 2026-11-26).
// One course list per programme — everyone sees the current list (no
// yearly versions). For each included course the member sees whether they
// attended, are registered, or when the next run is.
//
// Evidence of "attended" is the same as pricing's 复训 rule: a check-in at
// a run of the course, or an attended-courses entry linked to the course.
// Members only ever see events that are public (open / planned / closed).

const PUBLIC_STATUSES = ["open", "planned", "closed"];

export type MemberCourseState =
  | { kind: "attended"; date: string | null }
  | { kind: "registered"; date: string | null; event_id: string }
  | { kind: "open"; date: string; slug: string }
  | { kind: "planned"; date: string; tentative: boolean }
  | { kind: "closed"; date: string }
  | { kind: "none" };

export type MemberProgrammeCourse = {
  id: string;
  name_cn: string;
  name_en: string | null;
  subtitle_cn: string | null;
  state: MemberCourseState;
  /** Attended before AND there's an upcoming run to register for again. */
  again: { date: string; slug: string } | null;
};

export type MemberProgramme = {
  name_cn: string;
  name_en: string;
  started: string | null;
  valid_until: string | null;
  expired: boolean;
  sections: Array<{ section_cn: string; section_en: string; courses: MemberProgrammeCourse[] }>;
  attended_count: number;
  total: number;
};

type AttendedEntry = { course_id?: string | null; date?: string | null };

export async function loadMemberProgramme(participantId: string): Promise<MemberProgramme | null> {
  const service = createSupabaseServiceClient();
  const { data: p } = await service
    .from("participants")
    .select("programme_id, programme_started_at, programme_expires_at, attended_courses, programmes(name_cn, name_en)")
    .eq("id", participantId)
    .maybeSingle();
  const row = p as unknown as {
    programme_id: string | null;
    programme_started_at: string | null;
    programme_expires_at: string | null;
    attended_courses: AttendedEntry[] | null;
    programmes: { name_cn: string; name_en: string } | Array<{ name_cn: string; name_en: string }> | null;
  } | null;
  if (!row?.programme_id) return null;
  const prog = Array.isArray(row.programmes) ? row.programmes[0] : row.programmes;
  if (!prog) return null;

  const list = await listProgrammeCourses(row.programme_id);
  const courseIds = list.map((pc) => pc.course.id);
  const today = sgDay();

  // All public runs of these courses.
  const { data: runsRaw } = courseIds.length
    ? await service
        .from("events")
        .select("id, slug, course_id, status, start_date, end_date, dates_tentative")
        .in("course_id", courseIds)
        .in("status", PUBLIC_STATUSES)
        .order("start_date", { ascending: true })
    : { data: [] };
  type Run = { id: string; slug: string; course_id: string; status: string; start_date: string | null; end_date: string | null; dates_tentative: boolean | null };
  const runs = (runsRaw ?? []) as Run[];

  // Their check-ins and live registrations on any run of these courses
  // (also draft/archived runs, since past runs may since be archived).
  const { data: allRunsRaw } = courseIds.length
    ? await service.from("events").select("id, course_id, start_date, end_date").in("course_id", courseIds)
    : { data: [] };
  const allRuns = new Map(((allRunsRaw ?? []) as Array<{ id: string; course_id: string; start_date: string | null; end_date: string | null }>).map((r) => [r.id, r]));
  const runIds = [...allRuns.keys()];
  const [{ data: checks }, { data: enrs }] = runIds.length
    ? await Promise.all([
        service.from("check_ins").select("event_id").eq("participant_id", participantId).in("event_id", runIds),
        service.from("enrollments").select("event_id, status").eq("participant_id", participantId).in("event_id", runIds).not("status", "in", "(rejected,cancelled)"),
      ])
    : [{ data: [] }, { data: [] }];

  const attended = new Map<string, string | null>(); // course → latest date
  for (const c of (checks ?? []) as Array<{ event_id: string }>) {
    const r = allRuns.get(c.event_id);
    if (!r) continue;
    const prev = attended.get(r.course_id);
    if (prev === undefined || (r.start_date && (!prev || r.start_date > prev))) attended.set(r.course_id, r.start_date);
  }
  for (const a of row.attended_courses ?? []) {
    if (a?.course_id && courseIds.includes(a.course_id) && !attended.has(a.course_id)) attended.set(a.course_id, a.date ?? null);
  }

  // Upcoming registration = a live enrolment on a run that hasn't ended.
  const registered = new Map<string, { date: string | null; event_id: string }>();
  for (const e of (enrs ?? []) as Array<{ event_id: string }>) {
    const r = allRuns.get(e.event_id);
    if (!r) continue;
    const last = r.end_date ?? r.start_date;
    if (last && last < today) continue;
    const prev = registered.get(r.course_id);
    if (!prev || (r.start_date && prev.date && r.start_date < prev.date)) registered.set(r.course_id, { date: r.start_date, event_id: r.id });
  }

  const nextRun = (courseId: string) =>
    runs.find((r) => r.course_id === courseId && r.start_date && (r.end_date ?? r.start_date) >= today) ?? null;

  const sections: MemberProgramme["sections"] = [];
  for (const pc of [...list].sort((a, b) => a.sort_order - b.sort_order)) {
    const cid = pc.course.id;
    const nxt = nextRun(cid);
    let state: MemberCourseState;
    const reg = registered.get(cid);
    if (reg) state = { kind: "registered", date: reg.date, event_id: reg.event_id };
    else if (attended.has(cid)) state = { kind: "attended", date: attended.get(cid) ?? null };
    else if (nxt?.status === "open") state = { kind: "open", date: nxt.start_date!, slug: nxt.slug };
    else if (nxt?.status === "planned") state = { kind: "planned", date: nxt.start_date!, tentative: Boolean(nxt.dates_tentative) };
    else if (nxt?.status === "closed") state = { kind: "closed", date: nxt.start_date! };
    else state = { kind: "none" };
    const again = state.kind === "attended" && nxt?.status === "open" ? { date: nxt.start_date!, slug: nxt.slug } : null;

    const course: MemberProgrammeCourse = {
      id: cid,
      name_cn: pc.course.name_cn,
      name_en: pc.course.name_en,
      subtitle_cn: pc.course.subtitle_cn,
      state,
      again,
    };
    const sec = sections.find((s) => s.section_cn === pc.section_cn);
    if (sec) sec.courses.push(course);
    else sections.push({ section_cn: pc.section_cn, section_en: pc.section_en, courses: [course] });
  }

  const validUntil = validUntilDay(row.programme_expires_at);
  return {
    name_cn: prog.name_cn,
    name_en: prog.name_en,
    started: row.programme_started_at ? validUntilDay(row.programme_started_at) : null,
    valid_until: validUntil,
    expired: Boolean(validUntil && validUntil < today),
    sections,
    attended_count: [...new Set(courseIds)].filter((id) => attended.has(id)).length,
    total: new Set(courseIds).size,
  };
}
