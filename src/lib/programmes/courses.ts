import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase";
import type { AdminContext } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";
import { todayInEventTz } from "@/lib/check-in/day";
import type { Course, CourseOption, CourseRuns, ProgrammeCourse } from "./course-types";

// Course lists under each programme (migration 079). Service client +
// audit; writes are role-checked in the API routes. Course names are
// shared, so renaming a course renames it in every programme.

const COURSE_COLS = "id, name_cn, name_en, subtitle_cn, subtitle_en, active";

type LinkRow = {
  id: string;
  programme_id: string;
  course_id: string;
  section_cn: string;
  section_en: string;
  sort_order: number;
};

const MISSING_TABLE = new Set(["42P01", "PGRST205"]);

type OrderRow = { id: string; section_cn: string; sort_order: number };

async function loadOrder(programmeId: string): Promise<OrderRow[]> {
  const supabase = createSupabaseServiceClient();
  const { data } = await supabase
    .from("programme_courses")
    .select("id, section_cn, sort_order")
    .eq("programme_id", programmeId)
    .order("sort_order", { ascending: true })
    .returns<OrderRow[]>();
  return data ?? [];
}

/** Rewrite sort_order as 10, 20, 30 … in this order, keeping each
 *  section's courses together (sections in first-appearance order). */
async function saveOrder(rows: OrderRow[]): Promise<void> {
  const sections: string[] = [];
  for (const r of rows) if (!sections.includes(r.section_cn)) sections.push(r.section_cn);
  const ordered = sections.flatMap((s) => rows.filter((r) => r.section_cn === s));
  const supabase = createSupabaseServiceClient();
  await Promise.all(
    ordered.map((r, k) =>
      r.sort_order === (k + 1) * 10
        ? Promise.resolve()
        : supabase.from("programme_courses").update({ sort_order: (k + 1) * 10 }).eq("id", r.id).then(() => undefined),
    ),
  );
}

/** Move one course to the end of its (possibly new) section. */
async function placeAtSectionEnd(programmeId: string, linkId: string, sectionCn: string): Promise<void> {
  const rows = (await loadOrder(programmeId)).filter((r) => r.id !== linkId);
  const me: OrderRow = { id: linkId, section_cn: sectionCn, sort_order: -1 };
  let at = -1;
  rows.forEach((r, i) => {
    if (r.section_cn === sectionCn) at = i;
  });
  if (at === -1) rows.push(me);
  else rows.splice(at + 1, 0, me);
  await saveOrder(rows);
}

const NO_RUNS: CourseRuns = { next: null, upcoming: 0, past: 0 };

/** Each course's runs (non-archived events). A run is upcoming until its
 *  last day has passed (Singapore time). */
async function courseRuns(courseIds: string[]): Promise<Map<string, CourseRuns>> {
  const out = new Map<string, CourseRuns>();
  if (courseIds.length === 0) return out;
  const supabase = createSupabaseServiceClient();
  const { data } = await supabase
    .from("events")
    .select("id, course_id, start_date, end_date, title_cn, title_en")
    .in("course_id", courseIds)
    .neq("status", "archived")
    .order("start_date", { ascending: true })
    .returns<Array<{ id: string; course_id: string; start_date: string | null; end_date: string | null; title_cn: string | null; title_en: string | null }>>();
  const today = todayInEventTz();
  for (const e of data ?? []) {
    const r = out.get(e.course_id) ?? { ...NO_RUNS };
    const last = e.end_date ?? e.start_date;
    if (last && last < today) r.past += 1;
    else {
      r.upcoming += 1;
      if (!r.next && e.start_date) r.next = { id: e.id, start_date: e.start_date, title: e.title_cn || e.title_en || "" };
    }
    out.set(e.course_id, r);
  }
  return out;
}

/** A programme's courses in brochure order, with event counts and the
 *  other programmes that include each one. [] before migration 079. */
export async function listProgrammeCourses(programmeId: string): Promise<ProgrammeCourse[]> {
  const supabase = createSupabaseServiceClient();
  const { data: links, error } = await supabase
    .from("programme_courses")
    .select("id, programme_id, course_id, section_cn, section_en, sort_order")
    .eq("programme_id", programmeId)
    .order("sort_order", { ascending: true })
    .returns<LinkRow[]>();
  if (error) {
    if (MISSING_TABLE.has(error.code ?? "")) return [];
    throw new Error(`listProgrammeCourses: ${error.message}`);
  }
  const ids = [...new Set((links ?? []).map((l) => l.course_id))];
  if (ids.length === 0) return [];

  const [{ data: courses }, { data: others }, counts] = await Promise.all([
    supabase.from("courses").select(COURSE_COLS).in("id", ids).returns<Course[]>(),
    supabase
      .from("programme_courses")
      .select("course_id, programme_id, programmes(id, name_cn, sort_order)")
      .in("course_id", ids)
      .neq("programme_id", programmeId)
      .returns<Array<{ course_id: string; programme_id: string; programmes: { id: string; name_cn: string; sort_order: number } | null }>>(),
    courseRuns(ids),
  ]);
  const byId = new Map((courses ?? []).map((c) => [c.id, c]));
  const alsoIn = new Map<string, Array<{ id: string; name_cn: string; sort_order: number }>>();
  for (const o of others ?? []) {
    if (!o.programmes) continue;
    alsoIn.set(o.course_id, [...(alsoIn.get(o.course_id) ?? []), o.programmes]);
  }
  return (links ?? [])
    .filter((l) => byId.has(l.course_id))
    .map((l) => ({
      link_id: l.id,
      section_cn: l.section_cn,
      section_en: l.section_en,
      sort_order: l.sort_order,
      course: byId.get(l.course_id)!,
      runs: counts.get(l.course_id) ?? NO_RUNS,
      also_in: (alsoIn.get(l.course_id) ?? [])
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(({ id, name_cn }) => ({ id, name_cn })),
    }));
}

/** Number of courses per programme, for the Programmes list. */
export async function courseCountsByProgramme(): Promise<Map<string, number>> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("programme_courses")
    .select("programme_id")
    .returns<Array<{ programme_id: string }>>();
  const out = new Map<string, number>();
  if (error) return out;
  for (const r of data ?? []) out.set(r.programme_id, (out.get(r.programme_id) ?? 0) + 1);
  return out;
}

/** Every course name, for "pick an existing course". */
export async function listCourses(): Promise<Course[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.from("courses").select(COURSE_COLS).order("name_cn").returns<Course[]>();
  if (error) {
    if (MISSING_TABLE.has(error.code ?? "")) return [];
    throw new Error(`listCourses: ${error.message}`);
  }
  return data ?? [];
}

/** Course choices for the event editor, each with the programmes that
 *  include it. Courses in no programme still appear (marked by an empty
 *  list), so an event linked to one keeps showing it. */
export async function listCourseOptions(): Promise<CourseOption[]> {
  const supabase = createSupabaseServiceClient();
  const [courses, { data: links }] = await Promise.all([
    listCourses(),
    supabase
      .from("programme_courses")
      .select("course_id, programmes(name_cn, sort_order)")
      .returns<Array<{ course_id: string; programmes: { name_cn: string; sort_order: number } | null }>>(),
  ]);
  const progs = new Map<string, Array<{ name_cn: string; sort_order: number }>>();
  for (const l of links ?? []) if (l.programmes) progs.set(l.course_id, [...(progs.get(l.course_id) ?? []), l.programmes]);
  return courses.map((c) => ({
    id: c.id,
    name_cn: c.name_cn,
    name_en: c.name_en,
    programmes: (progs.get(c.id) ?? []).sort((a, b) => a.sort_order - b.sort_order).map((p) => p.name_cn),
  }));
}

export type CourseNames = { name_cn: string; name_en?: string | null; subtitle_cn?: string | null; subtitle_en?: string | null };
export type CourseError = { field: string; message: string };

function cleanNames(n: Partial<CourseNames>) {
  const out: Record<string, string | null> = {};
  if (n.name_cn !== undefined) out.name_cn = n.name_cn.trim();
  for (const k of ["name_en", "subtitle_cn", "subtitle_en"] as const) {
    if (n[k] !== undefined) out[k] = n[k]?.trim() || null;
  }
  return out;
}

function checkNames(n: Partial<CourseNames>, partial: boolean): CourseError | null {
  if (!partial || n.name_cn !== undefined) {
    const v = (n.name_cn ?? "").trim();
    if (v.length < 1 || v.length > 120) return { field: "name_cn", message: "Chinese course name is required (max 120 characters)." };
  }
  if ((n.name_en ?? "").length > 200) return { field: "name_en", message: "English name is too long." };
  return null;
}

/** Add a course to a programme: an existing course (course_id) or a new
 *  name (created, or reused if that Chinese name already exists). */
export async function addProgrammeCourse(
  programmeId: string,
  input: { course_id?: string; names?: CourseNames; section_cn: string; section_en: string },
  admin: AdminContext,
): Promise<{ link_id?: string; error?: CourseError }> {
  const supabase = createSupabaseServiceClient();
  let courseId = input.course_id;
  if (!courseId) {
    const names = input.names ?? { name_cn: "" };
    const err = checkNames(names, false);
    if (err) return { error: err };
    const { data: existing } = await supabase
      .from("courses")
      .select("id")
      .eq("name_cn", names.name_cn.trim())
      .maybeSingle<{ id: string }>();
    if (existing) courseId = existing.id;
    else {
      const { data: created, error } = await supabase
        .from("courses")
        .insert({ ...cleanNames(names), created_by: admin.id, updated_by: admin.id })
        .select("id")
        .single<{ id: string }>();
      if (error) throw new Error(`create course: ${error.message}`);
      courseId = created.id;
    }
  }

  const { data: last } = await supabase
    .from("programme_courses")
    .select("sort_order")
    .eq("programme_id", programmeId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ sort_order: number }>();
  const sectionCn = input.section_cn.trim().slice(0, 60);
  const { data: link, error } = await supabase
    .from("programme_courses")
    .insert({
      programme_id: programmeId,
      course_id: courseId,
      section_cn: sectionCn,
      section_en: input.section_en.trim().slice(0, 80),
      sort_order: (last?.sort_order ?? 0) + 10,
    })
    .select("id")
    .single<{ id: string }>();
  if (error) {
    if (error.code === "23505") return { error: { field: "duplicate", message: "This programme already includes that course." } };
    throw new Error(`add programme course: ${error.message}`);
  }
  // New courses go to the end of their section, not the end of the list.
  await placeAtSectionEnd(programmeId, link.id, sectionCn);
  await writeAuditLog({
    actor_id: admin.id,
    action: "programme.course_added",
    entity: "programme",
    entity_id: programmeId,
    after: { course_id: courseId, section_cn: input.section_cn },
  });
  return { link_id: link.id };
}

/** Edit a listed course: its section (this programme only), its position,
 *  or its names (shared — renames it in every programme). */
export async function updateProgrammeCourse(
  programmeId: string,
  linkId: string,
  patch: { section_cn?: string; section_en?: string; move?: "up" | "down"; names?: Partial<CourseNames> },
  admin: AdminContext,
): Promise<{ error?: CourseError; notFound?: boolean }> {
  const supabase = createSupabaseServiceClient();
  const { data: link } = await supabase
    .from("programme_courses")
    .select("id, programme_id, course_id, section_cn, section_en, sort_order")
    .eq("id", linkId)
    .eq("programme_id", programmeId)
    .maybeSingle<LinkRow>();
  if (!link) return { notFound: true };

  if (patch.names) {
    const err = checkNames(patch.names, true);
    if (err) return { error: err };
    const { error } = await supabase
      .from("courses")
      .update({ ...cleanNames(patch.names), updated_by: admin.id, updated_at: new Date().toISOString() })
      .eq("id", link.course_id);
    if (error) {
      if (error.code === "23505") return { error: { field: "name_cn", message: "Another course already has that Chinese name." } };
      throw new Error(`rename course: ${error.message}`);
    }
  }

  const linkPatch: Record<string, unknown> = {};
  if (patch.section_cn !== undefined) linkPatch.section_cn = patch.section_cn.trim().slice(0, 60);
  if (patch.section_en !== undefined) linkPatch.section_en = patch.section_en.trim().slice(0, 80);
  if (Object.keys(linkPatch).length > 0) {
    const { error } = await supabase.from("programme_courses").update(linkPatch).eq("id", linkId);
    if (error) throw new Error(`update programme course: ${error.message}`);
    // A course moved to another section goes to the end of that section.
    if (linkPatch.section_cn !== undefined && linkPatch.section_cn !== link.section_cn) {
      await placeAtSectionEnd(programmeId, linkId, linkPatch.section_cn as string);
    }
  }

  if (patch.move) {
    // Swap with the neighbour in the same section; sections stay together.
    const list = await loadOrder(programmeId);
    const i = list.findIndex((r) => r.id === linkId);
    if (i >= 0) {
      const sec = list[i].section_cn;
      const step = patch.move === "up" ? -1 : 1;
      let j = i + step;
      while (j >= 0 && j < list.length && list[j].section_cn !== sec) j += step;
      if (j >= 0 && j < list.length) {
        [list[i], list[j]] = [list[j], list[i]];
        await saveOrder(list);
      }
    }
  }

  await writeAuditLog({
    actor_id: admin.id,
    action: "programme.course_updated",
    entity: "programme",
    entity_id: programmeId,
    before: { course_id: link.course_id, section_cn: link.section_cn },
    after: { ...linkPatch, move: patch.move ?? null, names: patch.names ?? null },
  });
  return {};
}

/** Remove a course from a programme. The course name stays (other
 *  programmes or events may use it). */
export async function removeProgrammeCourse(
  programmeId: string,
  linkId: string,
  admin: AdminContext,
): Promise<{ notFound?: boolean }> {
  const supabase = createSupabaseServiceClient();
  const { data: link } = await supabase
    .from("programme_courses")
    .select("id, course_id, section_cn")
    .eq("id", linkId)
    .eq("programme_id", programmeId)
    .maybeSingle<{ id: string; course_id: string; section_cn: string }>();
  if (!link) return { notFound: true };
  const { error } = await supabase.from("programme_courses").delete().eq("id", linkId);
  if (error) throw new Error(`remove programme course: ${error.message}`);
  await writeAuditLog({
    actor_id: admin.id,
    action: "programme.course_removed",
    entity: "programme",
    entity_id: programmeId,
    before: { course_id: link.course_id, section_cn: link.section_cn },
  });
  return {};
}
