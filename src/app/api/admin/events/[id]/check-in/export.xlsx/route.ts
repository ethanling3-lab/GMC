import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";
import { EVENT_TZ, isIsoDay, todayInEventTz } from "@/lib/check-in/day";
import {
  byDisplayNumber,
  loadDayCheckIns,
  loadPaid,
  loadSeats,
} from "@/lib/check-in/check-in-query";
import { groupNumber } from "@/lib/group-number";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/admin/events/[id]/check-in/export.xlsx?day=YYYY-MM-DD[&include_test=1]
//
// One event day's attendance: everyone expected, with Morning and Afternoon
// check-in times. Test-mode records are left out unless include_test=1.

type RouteCtx = { params: Promise<{ id: string }> };

const ALLOWED_ROLES = new Set(["super_admin", "regional_lead", "customer_service", "instructor"]);

function time(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: EVENT_TZ,
  });
}

function groupCell(g: { group_no: number | null; table_no: number | null }): number | string {
  return groupNumber(g).no ?? "";
}

export async function GET(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (!ALLOWED_ROLES.has(admin.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id: eventId } = await params;
  const url = new URL(req.url);
  const dayParam = url.searchParams.get("day");
  const day = isIsoDay(dayParam) ? dayParam : todayInEventTz();
  const includeTest = url.searchParams.get("include_test") === "1";

  const supabase = createSupabaseServiceClient();
  const { data: ev } = await supabase
    .from("events")
    .select("id, slug")
    .eq("id", eventId)
    .maybeSingle();
  if (!ev) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const [paid, allCheckIns, seats] = await Promise.all([
    loadPaid(supabase, eventId),
    loadDayCheckIns(supabase, eventId, day),
    loadSeats(supabase, eventId),
  ]);
  const checkIns = includeTest ? allCheckIns : allCheckIns.filter((c) => !c.is_test);

  type Person = {
    enrollment_id: string;
    participant_id: string;
    region_id: string | null;
    name_cn: string | null;
    name_en: string | null;
  };
  const people = new Map<string, Person>();
  for (const p of paid) people.set(p.enrollment_id, p);
  // Unpaid people the desk let in aren't in `paid` — add them.
  for (const c of checkIns) {
    if (!people.has(c.enrollment_id)) people.set(c.enrollment_id, c);
  }
  const am = new Map<string, (typeof checkIns)[number]>();
  const pm = new Map<string, (typeof checkIns)[number]>();
  for (const c of checkIns) (c.session === "pm" ? pm : am).set(c.enrollment_id, c);

  const withSeat = [...people.values()].map((p) => {
    const seat = seats.get(p.participant_id);
    return { ...p, group_no: seat?.group_no ?? null, table_no: seat?.table_no ?? null, seat_no: seat?.seat_no ?? null };
  });
  withSeat.sort((a, b) => {
    const g = byDisplayNumber(a, b);
    if (g !== 0) return g;
    const sa = a.seat_no ?? Number.POSITIVE_INFINITY;
    const sb = b.seat_no ?? Number.POSITIVE_INFINITY;
    if (sa !== sb) return sa - sb;
    return (a.region_id ?? "").localeCompare(b.region_id ?? "");
  });

  const attendanceHeader = [
    "Group · 组",
    "Seat · 座位",
    "Region ID",
    "Name · 姓名",
    "English name",
    "Morning · 早上",
    "Afternoon · 下午",
    "Unpaid let in · 未付款放行",
  ];
  const attendanceRows = withSeat.map((p) => {
    const a = am.get(p.enrollment_id) ?? null;
    const b = pm.get(p.enrollment_id) ?? null;
    return {
      "Group · 组": groupCell(p),
      "Seat · 座位": p.seat_no ?? "",
      "Region ID": p.region_id ?? "",
      "Name · 姓名": p.name_cn ?? p.name_en ?? "",
      "English name": p.name_cn ? p.name_en ?? "" : "",
      "Morning · 早上": a ? time(a.checked_in_at) : "",
      "Afternoon · 下午": b ? time(b.checked_in_at) : "",
      "Unpaid let in · 未付款放行": a?.unpaid_override || b?.unpaid_override ? "Yes" : "",
    };
  });

  const wb = XLSX.utils.book_new();
  const s1 = XLSX.utils.json_to_sheet(attendanceRows, { header: attendanceHeader });
  s1["!cols"] = [8, 8, 12, 16, 22, 12, 12, 14].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, s1, "签到 · Attendance");

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  await writeAuditLog({
    actor_id: admin.id,
    action: "check_in.exported",
    entity: "events",
    entity_id: eventId,
    metadata: { day, include_test: includeTest, people: attendanceRows.length },
  });

  const filename = `check-in-${ev.slug as string}-${day}${includeTest ? "-with-test" : ""}.xlsx`;
  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
