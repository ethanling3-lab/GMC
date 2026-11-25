import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { removeProgrammeCourse, updateProgrammeCourse, type CourseNames } from "@/lib/programmes/courses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WRITE_ROLES = new Set(["super_admin", "regional_lead"]);
const forbidden = () =>
  NextResponse.json({ error: "forbidden", detail: "Only Super Admin edits programme courses." }, { status: 403 });

type Ctx = { params: Promise<{ id: string; linkId: string }> };

// PATCH — { section_cn?, section_en?, move?: "up"|"down", names?: {...} }.
// Names are shared: renaming changes the course in every programme.
export async function PATCH(req: Request, { params }: Ctx) {
  const admin = await requireAdmin();
  if (!WRITE_ROLES.has(admin.role)) return forbidden();
  const { id, linkId } = await params;
  const raw = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!raw) return NextResponse.json({ error: "invalid_json", detail: "Request body must be JSON." }, { status: 400 });
  const n = raw.names as Record<string, unknown> | undefined;
  const names: Partial<CourseNames> | undefined = n
    ? {
        ...(n.name_cn !== undefined ? { name_cn: String(n.name_cn) } : {}),
        ...(n.name_en !== undefined ? { name_en: n.name_en == null ? null : String(n.name_en) } : {}),
        ...(n.subtitle_cn !== undefined ? { subtitle_cn: n.subtitle_cn == null ? null : String(n.subtitle_cn) } : {}),
        ...(n.subtitle_en !== undefined ? { subtitle_en: n.subtitle_en == null ? null : String(n.subtitle_en) } : {}),
      }
    : undefined;
  const { error, notFound } = await updateProgrammeCourse(
    id,
    linkId,
    {
      section_cn: raw.section_cn === undefined ? undefined : String(raw.section_cn),
      section_en: raw.section_en === undefined ? undefined : String(raw.section_en),
      move: raw.move === "up" || raw.move === "down" ? raw.move : undefined,
      names,
    },
    admin,
  );
  if (notFound) return NextResponse.json({ error: "not_found", detail: "Course not in this programme." }, { status: 404 });
  if (error) return NextResponse.json({ error: error.field, detail: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

// DELETE — remove the course from this programme (the name stays).
export async function DELETE(_req: Request, { params }: Ctx) {
  const admin = await requireAdmin();
  if (!WRITE_ROLES.has(admin.role)) return forbidden();
  const { id, linkId } = await params;
  const { notFound } = await removeProgrammeCourse(id, linkId, admin);
  if (notFound) return NextResponse.json({ error: "not_found", detail: "Course not in this programme." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
