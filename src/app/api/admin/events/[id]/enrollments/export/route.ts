import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import type { EnrollmentStatus } from "@/lib/enrollments-shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUS_VALUES: readonly string[] = [
  "pending_approval",
  "approved",
  "rejected",
  "paid",
  "cancelled",
];

const HEADERS = [
  "student_id",
  "name_en",
  "name_cn",
  "region",
  "email",
  "phone",
  "status",
  "payment_status",
  "payment_method",
  "amount_paid",
  "registered_at",
  "confirmed_at",
  "approved_at",
  "paid_at",
] as const;

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

type RouteCtx = { params: Promise<{ id: string }> };

type EnrollmentExportRow = {
  status: string;
  payment_status: string | null;
  payment_method: string | null;
  amount_paid: number | string | null;
  created_at: string | null;
  confirmed_at: string | null;
  approved_at: string | null;
  paid_at: string | null;
  participant: {
    region_id: string | null;
    name_en: string | null;
    name_cn: string | null;
    region: string | null;
    email: string | null;
    phone: string | null;
  } | null;
};

export async function GET(req: Request, { params }: RouteCtx) {
  await requireAdmin();
  const { id: eventId } = await params;

  const url = new URL(req.url);
  const statusRaw = url.searchParams.get("status");
  const status: EnrollmentStatus | null =
    statusRaw && STATUS_VALUES.includes(statusRaw)
      ? (statusRaw as EnrollmentStatus)
      : null;
  const q = url.searchParams.get("q")?.trim() || "";

  const supabase = await createSupabaseServerClient();

  // Load the event for a tidy filename + to confirm the id exists.
  const { data: event, error: eventErr } = await supabase
    .from("events")
    .select("id, slug")
    .eq("id", eventId)
    .maybeSingle();
  if (eventErr) {
    return NextResponse.json({ error: eventErr.message }, { status: 500 });
  }
  if (!event) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // When q is set, resolve matching participant ids first, then scope the
  // enrolments by those ids. Two small queries are simpler and more reliable
  // than a nested-or on a foreign table.
  let participantIds: string[] | null = null;
  if (q) {
    const needle = `%${q.replace(/[%_]/g, "\\$&")}%`;
    const { data: pRows, error: pErr } = await supabase
      .from("participants")
      .select("id")
      .or(
        [
          `name_en.ilike.${needle}`,
          `name_cn.ilike.${needle}`,
          `region_id.ilike.${needle}`,
          `email.ilike.${needle}`,
          `phone.ilike.${needle}`,
        ].join(","),
      )
      .limit(5000);
    if (pErr) {
      return NextResponse.json({ error: pErr.message }, { status: 500 });
    }
    participantIds = (pRows ?? []).map((r) => r.id as string);
    if (participantIds.length === 0) {
      return csvResponse([], eventId, event.slug, status, q);
    }
  }

  let query = supabase
    .from("enrollments")
    .select(
      "status, payment_status, payment_method, amount_paid, created_at, confirmed_at, approved_at, paid_at, participant:participants(region_id, name_en, name_cn, region, email, phone)",
    )
    .eq("event_id", eventId)
    .order("created_at", { ascending: false })
    .limit(10_000);
  if (status) query = query.eq("status", status);
  if (participantIds) query = query.in("participant_id", participantIds);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return csvResponse(
    (data ?? []) as unknown as EnrollmentExportRow[],
    eventId,
    event.slug,
    status,
    q,
  );
}

function csvResponse(
  rows: EnrollmentExportRow[],
  eventId: string,
  slug: string | null,
  status: EnrollmentStatus | null,
  q: string,
): NextResponse {
  const lines: string[] = [HEADERS.join(",")];
  for (const r of rows) {
    const p = r.participant;
    lines.push(
      [
        escapeCell(p?.region_id),
        escapeCell(p?.name_en),
        escapeCell(p?.name_cn),
        escapeCell(p?.region),
        escapeCell(p?.email),
        escapeCell(p?.phone),
        escapeCell(r.status),
        escapeCell(r.payment_status),
        escapeCell(r.payment_method),
        escapeCell(r.amount_paid),
        escapeCell(r.created_at),
        escapeCell(r.confirmed_at),
        escapeCell(r.approved_at),
        escapeCell(r.paid_at),
      ].join(","),
    );
  }
  const csv = lines.join("\r\n") + "\r\n";

  const stamp = new Date().toISOString().slice(0, 10);
  const parts = ["enrollments", slug ?? eventId];
  if (status) parts.push(status);
  if (q) parts.push("q");
  parts.push(stamp);
  const filename = `${parts.join("-")}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
