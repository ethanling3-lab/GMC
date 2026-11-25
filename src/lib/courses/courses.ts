import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase";
import type { AdminContext } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";
import {
  validateColour,
  validateCourseName,
  validateCourseSlug,
  validateShortLabel,
  type Course,
} from "./types";

// Server lib for the course catalogue (migration 075). Service client +
// audit log; Super Admin only (checked in the API routes). Courses are
// never hard deleted (events reference them) — they're deactivated.
// `slug` is immutable after creation.

const COLUMNS =
  "id, slug, name_en, name_cn, short_label, colour, description, active, sort_order, created_at, updated_at";

export type CourseWriteInput = {
  slug: string;
  name_en: string;
  name_cn: string;
  short_label: string;
  colour: string;
  description?: string | null;
  active?: boolean;
  sort_order?: number;
};

export type CourseValidationError = {
  field: "slug" | "name_en" | "name_cn" | "short_label" | "colour" | "slug_conflict";
  message: string;
};

function validateInput(
  input: Partial<CourseWriteInput>,
  { partial = false }: { partial?: boolean } = {},
): CourseValidationError | null {
  const check = (
    field: CourseValidationError["field"],
    present: boolean,
    err: () => string | null,
  ): CourseValidationError | null => {
    if (partial && !present) return null;
    const message = err();
    return message ? { field, message } : null;
  };
  return (
    check("slug", input.slug !== undefined, () => validateCourseSlug(input.slug ?? ""))
    ?? check("name_en", input.name_en !== undefined, () => validateCourseName(input.name_en ?? "", "English name"))
    ?? check("name_cn", input.name_cn !== undefined, () => validateCourseName(input.name_cn ?? "", "Chinese name"))
    ?? check("short_label", input.short_label !== undefined, () => validateShortLabel(input.short_label ?? ""))
    ?? check("colour", input.colour !== undefined, () => validateColour(input.colour ?? ""))
  );
}

export async function listCourses(
  { includeInactive = false }: { includeInactive?: boolean } = {},
): Promise<Course[]> {
  const supabase = createSupabaseServiceClient();
  let q = supabase
    .from("courses")
    .select(COLUMNS)
    .order("sort_order", { ascending: true })
    .order("name_en", { ascending: true });
  if (!includeInactive) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw new Error(`listCourses failed: ${error.message}`);
  return (data ?? []) as Course[];
}

export async function getCourseById(id: string): Promise<Course | null> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.from("courses").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(`getCourseById failed: ${error.message}`);
  return (data as Course | null) ?? null;
}

export async function createCourse(
  input: CourseWriteInput,
  admin: AdminContext,
): Promise<{ course?: Course; error?: CourseValidationError }> {
  const err = validateInput(input);
  if (err) return { error: err };
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("courses")
    .insert({
      slug: input.slug.trim(),
      name_en: input.name_en.trim(),
      name_cn: input.name_cn.trim(),
      short_label: input.short_label.trim(),
      colour: input.colour,
      description: input.description?.trim() || null,
      active: input.active ?? true,
      sort_order: input.sort_order ?? 0,
      created_by: admin.id,
      updated_by: admin.id,
    })
    .select(COLUMNS)
    .single();
  if (error) {
    if (error.code === "23505") {
      return { error: { field: "slug_conflict", message: `Slug "${input.slug}" is already in use.` } };
    }
    throw new Error(`createCourse failed: ${error.message}`);
  }
  const course = data as Course;
  await writeAuditLog({
    actor_id: admin.id,
    action: "course.created",
    entity: "course",
    entity_id: course.id,
    after: { slug: course.slug, name_en: course.name_en, name_cn: course.name_cn },
  });
  return { course };
}

export async function updateCourse(
  id: string,
  input: Partial<Omit<CourseWriteInput, "slug">>,
  admin: AdminContext,
): Promise<{ course?: Course; error?: CourseValidationError; notFound?: boolean }> {
  const err = validateInput(input, { partial: true });
  if (err) return { error: err };
  const existing = await getCourseById(id);
  if (!existing) return { notFound: true };

  const patch: Record<string, unknown> = { updated_by: admin.id, updated_at: new Date().toISOString() };
  if (input.name_en !== undefined) patch.name_en = input.name_en.trim();
  if (input.name_cn !== undefined) patch.name_cn = input.name_cn.trim();
  if (input.short_label !== undefined) patch.short_label = input.short_label.trim();
  if (input.colour !== undefined) patch.colour = input.colour;
  if (input.description !== undefined) patch.description = input.description?.trim() || null;
  if (input.active !== undefined) patch.active = input.active;
  if (input.sort_order !== undefined) patch.sort_order = input.sort_order;

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.from("courses").update(patch).eq("id", id).select(COLUMNS).single();
  if (error) throw new Error(`updateCourse failed: ${error.message}`);
  const course = data as Course;
  const action =
    input.active === true && !existing.active
      ? "course.reactivated"
      : input.active === false && existing.active
        ? "course.deactivated"
        : "course.updated";
  await writeAuditLog({
    actor_id: admin.id,
    action,
    entity: "course",
    entity_id: id,
    before: { name_en: existing.name_en, name_cn: existing.name_cn, active: existing.active },
    after: { name_en: course.name_en, name_cn: course.name_cn, active: course.active },
  });
  return { course };
}
