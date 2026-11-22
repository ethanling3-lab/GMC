import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";
import { EVENT_TZ, isIsoDay, todayInEventTz } from "@/lib/check-in/day";
import {
  byDisplayNumber,
  loadDayCheckIns,
  loadDayExits,
  loadPaid,
  loadSeats,
} from "@/lib/check-in/check-in-query";
import { minutesBetween } from "@/lib/check-in/check-in-write";
import { groupNumber } from "@/lib/group-number";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/admin/events/[id]/check-in/export.xlsx?day=YYYY-MM-DD[&include_test=1]
//
// One workbook for one event day:
//   Attendance    — everyone expected, with Morning / Afternoon check-in times
//   Out of class  — every trip out during class, in order
//   Totals        — per person: trips, minutes, longest, flags
// Test-mode records are left out unless include_test=1.

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
    .select("id, slug, long_absence_minutes")
    .eq("id", eventId)
    .maybeSingle();
  if (!ev) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const longMin = (ev.long_absence_minutes as number | null) ?? 15;

  const [paid, allCheckIns, seats, allExits] = await Promise.all([
    loadPaid(supabase, eventId),
    loadDayCheckIns(supabase, eventId, day),
    loadSeats(supabase, eventId),
    loadDayExits(supabase, eventId, day),
  ]);
  const checkIns = includeTest ? allCheckIns : allCheckIns.filter((c) => !c.is_test);
  const exits = includeTest ? allExits : allExits.filter((e) => !e.is_test);
  const now = new Date().toISOString();

  // --- Attendance ------------------------------------------------------------
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

  // --- Out of class ------------------------------------------------------------
  const exitHeader = [
    "Group · 组",
    "Region ID",
    "Name · 姓名",
    "Session · 时段",
    "Out · 外出",
    "Back · 回来",
    "Minutes · 分钟",
    "No return scan · 未扫回",
    "Not checked in · 未签到",
  ];
  const exitRows = exits.map((e) => {
    const seat = seats.get(e.participant_id);
    const g = { group_no: seat?.group_no ?? null, table_no: seat?.table_no ?? null };
    return {
      "Group · 组": groupCell(g),
      "Region ID": e.region_id ?? "",
      "Name · 姓名": e.name_cn ?? e.name_en ?? "",
      "Session · 时段": e.session === "pm" ? "Afternoon · 下午" : "Morning · 早上",
      "Out · 外出": time(e.out_at),
      "Back · 回来": e.back_at ? time(e.back_at) : "Still out · 仍在外",
      "Minutes · 分钟": minutesBetween(e.out_at, e.back_at ?? now),
      "No return scan · 未扫回": e.closed_reason === "session_ended" ? "Yes" : "",
      "Not checked in · 未签到": e.not_checked_in ? "Yes" : "",
    };
  });

  // --- Totals --------------------------------------------------------------------
  type Total = {
    group: number | string;
    region_id: string;
    name: string;
    trips: number;
    minutes: number;
    longest: number;
    noReturn: number;
    long: number;
  };
  const totals = new Map<string, Total>();
  for (const e of exits) {
    const seat = seats.get(e.participant_id);
    const t =
      totals.get(e.enrollment_id) ??
      {
        group: groupCell({ group_no: seat?.group_no ?? null, table_no: seat?.table_no ?? null }),
        region_id: e.region_id ?? "",
        name: e.name_cn ?? e.name_en ?? "",
        trips: 0,
        minutes: 0,
        longest: 0,
        noReturn: 0,
        long: 0,
      };
    const m = minutesBetween(e.out_at, e.back_at ?? now);
    t.trips += 1;
    t.minutes += m;
    t.longest = Math.max(t.longest, m);
    if (e.closed_reason === "session_ended") t.noReturn += 1;
    if (m > longMin) t.long += 1;
    totals.set(e.enrollment_id, t);
  }
  const totalHeader = [
    "Group · 组",
    "Region ID",
    "Name · 姓名",
    "Trips · 次数",
    "Total minutes · 总分钟",
    "Longest · 最长",
    `Over ${longMin} min · 超时`,
    "No return scan · 未扫回",
  ];
  const totalRows = [...totals.values()]
    .sort((a, b) => b.minutes - a.minutes || b.trips - a.trips)
    .map((t) => ({
      "Group · 组": t.group,
      "Region ID": t.region_id,
      "Name · 姓名": t.name,
      "Trips · 次数": t.trips,
      "Total minutes · 总分钟": t.minutes,
      "Longest · 最长": t.longest,
      [`Over ${longMin} min · 超时`]: t.long || "",
      "No return scan · 未扫回": t.noReturn || "",
    }));

  const wb = XLSX.utils.book_new();
  const s1 = XLSX.utils.json_to_sheet(attendanceRows, { header: attendanceHeader });
  s1["!cols"] = [8, 8, 12, 16, 22, 12, 12, 14].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, s1, "签到 · Attendance");
  const s2 = XLSX.utils.json_to_sheet(exitRows, { header: exitHeader });
  s2["!cols"] = [8, 12, 16, 16, 10, 14, 10, 14, 14].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, s2, "外出 · Out of class");
  const s3 = XLSX.utils.json_to_sheet(totalRows, { header: totalHeader });
  s3["!cols"] = [8, 12, 16, 10, 14, 10, 12, 14].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, s3, "合计 · Totals");

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  await writeAuditLog({
    actor_id: admin.id,
    action: "check_in.exported",
    entity: "events",
    entity_id: eventId,
    metadata: { day, include_test: includeTest, people: attendanceRows.length, exits: exitRows.length },
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
