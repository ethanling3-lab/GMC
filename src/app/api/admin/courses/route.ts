import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { createCourse, listCourses, type CourseWriteInput } from "@/lib/courses/courses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/admin/courses — list (?include_inactive=1 for all). Read is
// open to any staff role the middleware lets through (calendar filters).
export async function GET(req: Request) {
  await requireAdmin();
  const includeInactive = new URL(req.url).searchParams.get("include_inactive") === "1";
  return NextResponse.json({ courses: await listCourses({ includeInactive }) });
}

// POST /api/admin/courses — create. Super Admin only.
export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin") {
    return NextResponse.json({ error: "forbidden", detail: "Only Super Admin manages courses." }, { status: 403 });
  }
  let raw: Record<string, unknown>;
  try {
    raw = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json", detail: "Request body must be JSON." }, { status: 400 });
  }
  const input: CourseWriteInput = {
    slug: String(raw.slug ?? ""),
    name_en: String(raw.name_en ?? ""),
    name_cn: String(raw.name_cn ?? ""),
    short_label: String(raw.short_label ?? ""),
    colour: String(raw.colour ?? ""),
    description: raw.description == null ? null : String(raw.description),
    active: raw.active === undefined ? true : Boolean(raw.active),
    sort_order: raw.sort_order === undefined ? 0 : Number(raw.sort_order),
  };
  const { course, error } = await createCourse(input, admin);
  if (error) {
    return NextResponse.json(
      { error: error.field, detail: error.message },
      { status: error.field === "slug_conflict" ? 409 : 400 },
    );
  }
  return NextResponse.json({ course }, { status: 201 });
}
