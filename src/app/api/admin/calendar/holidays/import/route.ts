import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { importHolidayYear } from "@/lib/calendar/holiday-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/admin/calendar/holidays/import { year } — pre-fill a year's
// MY / Johor / SG public holidays. Existing rows are kept. Super Admin only.
export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin") {
    return NextResponse.json({ error: "forbidden", detail: "Only Super Admin manages holidays." }, { status: 403 });
  }
  const raw = (await req.json().catch(() => ({}))) as { year?: unknown };
  const year = Number(raw.year);
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    return NextResponse.json({ error: "year", detail: "Pick a year between 2020 and 2100." }, { status: 400 });
  }
  return NextResponse.json(await importHolidayYear(year, admin));
}
