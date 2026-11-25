import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { addProgrammeCourse } from "@/lib/programmes/courses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WRITE_ROLES = new Set(["super_admin", "regional_lead"]);

// POST /api/admin/programmes/:id/courses — add a course to the programme:
// { course_id } for an existing course, or { name_cn, name_en?, subtitle_cn?,
// subtitle_en? } for a new one; plus { section_cn, section_en }.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!WRITE_ROLES.has(admin.role)) {
    return NextResponse.json({ error: "forbidden", detail: "Only Super Admin edits programme courses." }, { status: 403 });
  }
  const { id } = await params;
  const raw = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!raw) return NextResponse.json({ error: "invalid_json", detail: "Request body must be JSON." }, { status: 400 });
  const str = (v: unknown) => (v == null ? null : String(v));
  const { link_id, error } = await addProgrammeCourse(
    id,
    {
      course_id: typeof raw.course_id === "string" && raw.course_id ? raw.course_id : undefined,
      names: {
        name_cn: String(raw.name_cn ?? ""),
        name_en: str(raw.name_en),
        subtitle_cn: str(raw.subtitle_cn),
        subtitle_en: str(raw.subtitle_en),
      },
      section_cn: String(raw.section_cn ?? ""),
      section_en: String(raw.section_en ?? ""),
    },
    admin,
  );
  if (error) return NextResponse.json({ error: error.field, detail: error.message }, { status: error.field === "duplicate" ? 409 : 400 });
  return NextResponse.json({ link_id }, { status: 201 });
}
