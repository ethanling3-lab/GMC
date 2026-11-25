import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { createHoliday } from "@/lib/calendar/holiday-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/admin/calendar/holidays — add a public holiday. Super Admin only.
export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin") {
    return NextResponse.json({ error: "forbidden", detail: "Only Super Admin manages holidays." }, { status: 403 });
  }
  let raw: Record<string, unknown>;
  try {
    raw = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json", detail: "Request body must be JSON." }, { status: 400 });
  }
  const { holiday, error } = await createHoliday(
    {
      date: String(raw.date ?? ""),
      name_en: String(raw.name_en ?? ""),
      name_cn: raw.name_cn == null ? null : String(raw.name_cn),
      regions: Array.isArray(raw.regions) ? raw.regions.map(String) : [],
      estimated: Boolean(raw.estimated),
    },
    admin,
  );
  if (error) return NextResponse.json({ error: error.field, detail: error.message }, { status: error.field === "duplicate" ? 409 : 400 });
  return NextResponse.json({ holiday }, { status: 201 });
}
