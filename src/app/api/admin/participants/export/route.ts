import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import {
  applyParticipantFilters,
  applyRoleScope,
  parseFilters,
} from "@/lib/participants-query";

export const dynamic = "force-dynamic";

type ExportRow = {
  region_id: string | null;
  name_en: string | null;
  name_cn: string | null;
  region: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  motivation_tag: string | null;
  financial_score: number | null;
  influence_score: number | null;
  overall_score: number | null;
  is_old_student: boolean | null;
  created_at: string;
};

const HEADERS = [
  "region_id",
  "name_en",
  "name_cn",
  "region",
  "email",
  "phone",
  "status",
  "motivation_tag",
  "financial_score",
  "influence_score",
  "overall_score",
  "is_old_student",
  "created_at",
] as const;

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows: ExportRow[]): string {
  const lines: string[] = [];
  lines.push(HEADERS.join(","));
  for (const r of rows) {
    lines.push(HEADERS.map((h) => escapeCell((r as Record<string, unknown>)[h])).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

export async function GET(req: Request) {
  const admin = await requireAdmin();
  const url = new URL(req.url);
  const filters = parseFilters(url.searchParams);

  const supabase = await createSupabaseServerClient();

  const columns =
    "region_id, name_en, name_cn, region, email, phone, status, motivation_tag, financial_score, influence_score, overall_score, is_old_student, created_at";

  let q = supabase.from("participants").select(columns);
  q = applyRoleScope(q, admin.role, admin.id, admin.region);
  q = applyParticipantFilters(q, filters);
  // Cap export at 10k to avoid runaway; admins can refine filters for larger sets.
  q = q.limit(10_000);

  const { data, error } = await q;
  if (error) {
    return NextResponse.json(
      { error: "Export failed", detail: error.message },
      { status: 500 },
    );
  }

  const csv = toCsv((data ?? []) as ExportRow[]);

  const stamp = new Date().toISOString().slice(0, 10);
  const parts = ["participants"];
  if (filters.region) parts.push(filters.region.toLowerCase());
  if (filters.status) parts.push(filters.status);
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
