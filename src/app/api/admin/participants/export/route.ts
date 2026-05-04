import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import {
  applyParticipantFilters,
  applyRoleScope,
  parseFilters,
} from "@/lib/participants-query";
import {
  effectiveQualification,
  participantToClass,
} from "@/lib/grouping/types";
import type {
  GroupClass,
  GrowthDimension,
  StudentQualification,
  ZuZhangTier,
} from "@/lib/grouping/types";

export const dynamic = "force-dynamic";

// CSV columns post-M6.0:
//   * overall_score → derived qualification (computed with admin override)
//   * default_class → which group_class the algorithm would bucket them in
//   * zu_zhang_tier, zu_zhang_dimensions, goal_dimensions, has_special_contribution
//   * upgrade_potential, times_led_groups
// Old `overall_score` column is excluded from the export — soft-deprecated.

type RawRow = {
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
  student_qualification: StudentQualification | null;
  is_old_student: boolean | null;
  created_at: string;
  zu_zhang_tier: ZuZhangTier | null;
  zu_zhang_dimensions: GrowthDimension[] | null;
  goal_dimensions: GrowthDimension[] | null;
  has_special_contribution: boolean;
  upgrade_potential: string | null;
  times_led_groups: number;
};

type ExportRow = Omit<RawRow, "zu_zhang_dimensions" | "goal_dimensions"> & {
  qualification: StudentQualification | null;
  default_class: GroupClass;
  zu_zhang_dimensions: string;
  goal_dimensions: string;
};

const HEADER_TO_COLUMN: Readonly<Record<string, keyof ExportRow>> = {
  student_id: "region_id",
  name_en: "name_en",
  name_cn: "name_cn",
  region: "region",
  email: "email",
  phone: "phone",
  status: "status",
  motivation_tag: "motivation_tag",
  financial_score: "financial_score",
  influence_score: "influence_score",
  qualification: "qualification",
  default_class: "default_class",
  zu_zhang_tier: "zu_zhang_tier",
  zu_zhang_dimensions: "zu_zhang_dimensions",
  goal_dimensions: "goal_dimensions",
  has_special_contribution: "has_special_contribution",
  upgrade_potential: "upgrade_potential",
  times_led_groups: "times_led_groups",
  is_old_student: "is_old_student",
  created_at: "created_at",
};
const HEADERS = Object.keys(HEADER_TO_COLUMN) as readonly string[];

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
    lines.push(
      HEADERS.map((h) => escapeCell(r[HEADER_TO_COLUMN[h]])).join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}

export async function GET(req: Request) {
  const admin = await requireAdmin();
  const url = new URL(req.url);
  const filters = parseFilters(url.searchParams);

  // Optional ?ids=uuid,uuid,... — export only those rows (still scoped to role).
  const idsParam = url.searchParams.get("ids")?.trim();
  const selectedIds = idsParam
    ? idsParam
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : null;

  const supabase = await createSupabaseServerClient();

  const columns = [
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
    "student_qualification",
    "is_old_student",
    "created_at",
    "zu_zhang_tier",
    "zu_zhang_dimensions",
    "goal_dimensions",
    "has_special_contribution",
    "upgrade_potential",
    "times_led_groups",
  ].join(", ");

  let q = supabase.from("participants").select(columns);
  q = applyRoleScope(q, admin.role, admin.id, admin.region);
  if (selectedIds && selectedIds.length > 0) {
    q = q.in("id", selectedIds);
  } else {
    q = applyParticipantFilters(q, filters);
  }
  // Cap export at 10k to avoid runaway; admins can refine filters for larger sets.
  q = q.limit(10_000);

  const { data, error } = await q;
  if (error) {
    return NextResponse.json(
      { error: "Export failed", detail: error.message },
      { status: 500 },
    );
  }

  const exportRows: ExportRow[] = ((data ?? []) as unknown as RawRow[]).map((r) => {
    const qual = effectiveQualification({
      financial_score: r.financial_score,
      influence_score: r.influence_score,
      student_qualification_override: r.student_qualification,
    });
    const cls = participantToClass({
      financial_score: r.financial_score,
      influence_score: r.influence_score,
      student_qualification_override: r.student_qualification,
    });
    return {
      ...r,
      qualification: qual,
      default_class: cls,
      zu_zhang_dimensions: (r.zu_zhang_dimensions ?? []).join("|"),
      goal_dimensions: (r.goal_dimensions ?? []).join("|"),
    };
  });

  const csv = toCsv(exportRows);

  const stamp = new Date().toISOString().slice(0, 10);
  const parts = ["participants"];
  if (selectedIds && selectedIds.length > 0) {
    parts.push(`selected-${selectedIds.length}`);
  } else {
    if (filters.region) parts.push(filters.region.toLowerCase());
    if (filters.status) parts.push(filters.status);
  }
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
