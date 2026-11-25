import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { updateCourse, type CourseWriteInput } from "@/lib/courses/courses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// PATCH /api/admin/courses/:id — partial update (slug immutable; set
// active=false to deactivate). Super Admin only.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin") {
    return NextResponse.json({ error: "forbidden", detail: "Only Super Admin manages courses." }, { status: 403 });
  }
  const { id } = await params;
  let raw: Record<string, unknown>;
  try {
    raw = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json", detail: "Request body must be JSON." }, { status: 400 });
  }
  const patch: Partial<Omit<CourseWriteInput, "slug">> = {};
  if (raw.name_en !== undefined) patch.name_en = String(raw.name_en);
  if (raw.name_cn !== undefined) patch.name_cn = String(raw.name_cn);
  if (raw.short_label !== undefined) patch.short_label = String(raw.short_label);
  if (raw.colour !== undefined) patch.colour = String(raw.colour);
  if (raw.description !== undefined) patch.description = raw.description == null ? null : String(raw.description);
  if (raw.active !== undefined) patch.active = Boolean(raw.active);
  if (raw.sort_order !== undefined) patch.sort_order = Number(raw.sort_order);

  const { course, error, notFound } = await updateCourse(id, patch, admin);
  if (notFound) return NextResponse.json({ error: "not_found", detail: "Course not found." }, { status: 404 });
  if (error) {
    return NextResponse.json(
      { error: error.field, detail: error.message },
      { status: error.field === "slug_conflict" ? 409 : 400 },
    );
  }
  return NextResponse.json({ course });
}
