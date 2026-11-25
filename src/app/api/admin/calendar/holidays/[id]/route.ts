import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { deleteHoliday, updateHoliday, type HolidayInput } from "@/lib/calendar/holiday-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const forbidden = () =>
  NextResponse.json({ error: "forbidden", detail: "Only Super Admin manages holidays." }, { status: 403 });

// PATCH /api/admin/calendar/holidays/:id — edit. Super Admin only.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin") return forbidden();
  const { id } = await params;
  let raw: Record<string, unknown>;
  try {
    raw = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json", detail: "Request body must be JSON." }, { status: 400 });
  }
  const patch: Partial<HolidayInput> = {};
  if (raw.date !== undefined) patch.date = String(raw.date);
  if (raw.name_en !== undefined) patch.name_en = String(raw.name_en);
  if (raw.name_cn !== undefined) patch.name_cn = raw.name_cn == null ? null : String(raw.name_cn);
  if (raw.regions !== undefined) patch.regions = Array.isArray(raw.regions) ? raw.regions.map(String) : [];
  if (raw.estimated !== undefined) patch.estimated = Boolean(raw.estimated);
  const { holiday, error, notFound } = await updateHoliday(id, patch, admin);
  if (notFound) return NextResponse.json({ error: "not_found", detail: "Holiday not found." }, { status: 404 });
  if (error) return NextResponse.json({ error: error.field, detail: error.message }, { status: error.field === "duplicate" ? 409 : 400 });
  return NextResponse.json({ holiday });
}

// DELETE /api/admin/calendar/holidays/:id — Super Admin only.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin") return forbidden();
  const { id } = await params;
  const { notFound } = await deleteHoliday(id, admin);
  if (notFound) return NextResponse.json({ error: "not_found", detail: "Holiday not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
