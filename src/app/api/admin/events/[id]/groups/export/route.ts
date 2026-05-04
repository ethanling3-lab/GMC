import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createSupabaseServerClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";
import { loadGroupBuilder } from "@/lib/grouping/load-groups";
import {
  GROUP_CLASS_LABEL,
  GROWTH_DIMENSION_LABEL,
  STUDENT_QUALIFICATION_LABEL,
  ZU_ZHANG_TIER_LABEL,
} from "@/lib/grouping/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/admin/events/[id]/groups/export
//
// Returns a single XLSX file with one flat sheet listing every member
// across every group. Admin filters/sorts in Excel — no per-group tabs.
// Mirrors the in-page table sort: group_no asc → role (zu_zhang first)
// → region_id asc.

type RouteCtx = { params: Promise<{ id: string }> };

const ROLE_LABEL: Record<string, string> = {
  zu_zhang: "组长 · Leader",
  fu_zu_zhang: "副组长 · Aux",
  pai_zhang: "排长 · Row",
  participant: "Participant",
};

const ROLE_ORDER: Record<string, number> = {
  zu_zhang: 0,
  fu_zu_zhang: 1,
  pai_zhang: 2,
  participant: 3,
};

export async function GET(_req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (
    admin.role !== "super_admin"
    && admin.role !== "regional_lead"
    && admin.role !== "instructor"
  ) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id: eventId } = await params;
  const supabase = await createSupabaseServerClient();
  const data = await loadGroupBuilder(supabase, eventId);
  if ("error" in data) {
    return NextResponse.json({ error: data.error }, { status: 404 });
  }

  type Row = Record<string, string | number>;
  const rows: Row[] = [];
  for (const g of data.groups) {
    const sorted = [...g.members].sort((a, b) => {
      const ra = ROLE_ORDER[a.role] ?? 99;
      const rb = ROLE_ORDER[b.role] ?? 99;
      if (ra !== rb) return ra - rb;
      return (a.region_id ?? "").localeCompare(b.region_id ?? "");
    });
    for (const m of sorted) {
      const tierLabel = m.zu_zhang_tier
        ? ZU_ZHANG_TIER_LABEL[m.zu_zhang_tier].short_cn
        : "";
      const qualLabel = m.qualification
        ? `${STUDENT_QUALIFICATION_LABEL[m.qualification].cn} · ${STUDENT_QUALIFICATION_LABEL[m.qualification].en}`
        : "";
      const primaryGoal = m.goal_dimensions[0];
      const secondaryGoal = m.goal_dimensions[1];
      rows.push({
        "Group #": g.group_no,
        Class: `${GROUP_CLASS_LABEL[g.group_class].cn} · ${GROUP_CLASS_LABEL[g.group_class].en}`,
        Role: ROLE_LABEL[m.role] ?? m.role,
        "Region ID": m.region_id ?? "",
        "Name EN": m.name_en ?? "",
        "Name CN": m.name_cn ?? "",
        Tier: tierLabel,
        Grade: m.zu_zhang_grade ?? "",
        Financial: m.financial_score ?? "",
        Influence: m.influence_score ?? "",
        Qualification: qualLabel,
        Motivation: m.motivation_tag ?? "",
        Old: m.is_old_student ? "Yes" : "",
        "Primary Goal": primaryGoal ? GROWTH_DIMENSION_LABEL[primaryGoal].cn : "",
        "Secondary Goal": secondaryGoal ? GROWTH_DIMENSION_LABEL[secondaryGoal].cn : "",
        Pinned:
          m.pinned_group_no != null && m.pinned_group_no === g.group_no
            ? "Yes"
            : m.pinned_group_no != null
              ? `→ #${m.pinned_group_no}`
              : "",
        "Family Partners": m.family_partner_region_ids.join(" / "),
      });
    }
  }

  const sheet = XLSX.utils.json_to_sheet(rows, {
    header: [
      "Group #",
      "Class",
      "Role",
      "Region ID",
      "Name EN",
      "Name CN",
      "Tier",
      "Grade",
      "Financial",
      "Influence",
      "Qualification",
      "Motivation",
      "Old",
      "Primary Goal",
      "Secondary Goal",
      "Pinned",
      "Family Partners",
    ],
  });
  // Reasonable starting column widths (XLSX still autosizes when admin
  // double-clicks the column edge in Excel).
  sheet["!cols"] = [
    { wch: 8 }, { wch: 22 }, { wch: 14 }, { wch: 10 }, { wch: 22 },
    { wch: 14 }, { wch: 6 }, { wch: 6 }, { wch: 9 }, { wch: 9 },
    { wch: 22 }, { wch: 12 }, { wch: 5 }, { wch: 12 }, { wch: 12 },
    { wch: 8 }, { wch: 28 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Groups");
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  await writeAuditLog({
    actor_id: admin.id,
    action: "groups.exported_xlsx",
    entity: "events",
    entity_id: eventId,
    metadata: {
      group_count: data.groups.length,
      row_count: rows.length,
    },
  });

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const filename = `groups-${data.event.slug}-${today}.xlsx`;
  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
