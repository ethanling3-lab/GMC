import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";
import { loadGroupBuilder } from "@/lib/grouping/load-groups";
import { normalizeGroupReportSchema } from "@/lib/group-report-schema";
import { formatAnswerValue, fieldHeader } from "@/lib/group-report-answers";
import type { CustomField } from "@/lib/event-form-schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

const ROLE_LABEL: Record<string, string> = {
  zu_zhang: "组长 · Leader",
  fu_zu_zhang: "副组长 · Aux",
  pai_zhang: "排长 · Row",
  participant: "Participant",
};
const ROLE_ORDER: Record<string, number> = { zu_zhang: 0, fu_zu_zhang: 1, pai_zhang: 2, participant: 3 };

// Build a list of unique column headers for a set of answerable fields.
function headerPlan(fields: CustomField[]): Array<{ field: CustomField; header: string }> {
  const seen = new Set<string>();
  const plan: Array<{ field: CustomField; header: string }> = [];
  for (const f of fields) {
    if (f.type === "section_header") continue;
    let h = fieldHeader(f);
    if (seen.has(h)) h = `${h} [${f.id}]`;
    seen.add(h);
    plan.push({ field: f, header: h });
  }
  return plan;
}

export async function GET(_req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (
    admin.role !== "super_admin" &&
    admin.role !== "regional_lead" &&
    admin.role !== "instructor"
  ) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id: eventId } = await params;

  const service = createSupabaseServiceClient();

  // Event + its active template.
  const { data: eventRow } = await service
    .from("events")
    .select("id, slug, group_report_template_id")
    .eq("id", eventId)
    .maybeSingle();
  if (!eventRow) return NextResponse.json({ error: "event_not_found" }, { status: 404 });
  const ev = eventRow as { id: string; slug: string; group_report_template_id: string | null };
  if (!ev.group_report_template_id) {
    return NextResponse.json({ error: "no_template" }, { status: 400 });
  }

  const { data: tplRow } = await service
    .from("group_report_templates")
    .select("schema")
    .eq("id", ev.group_report_template_id)
    .maybeSingle();
  const schema = normalizeGroupReportSchema((tplRow as { schema: unknown } | null)?.schema);

  // Groups + members.
  const groupData = await loadGroupBuilder(service, eventId);
  if ("error" in groupData) {
    return NextResponse.json({ error: groupData.error }, { status: 404 });
  }

  // Submissions keyed by group_id.
  const { data: subs } = await service
    .from("group_report_submissions")
    .select("group_id, status, group_answers, member_answers, submitted_at")
    .eq("event_id", eventId);
  type Sub = {
    group_id: string;
    status: string;
    group_answers: Record<string, unknown>;
    member_answers: Record<string, Record<string, unknown>>;
    submitted_at: string | null;
  };
  const subByGroup = new Map<string, Sub>();
  for (const s of (subs ?? []) as unknown as Sub[]) subByGroup.set(s.group_id, s);

  const groupPlan = headerPlan(schema.group_section.fields);
  const memberPlan = headerPlan(schema.member_section.fields);

  // --- Sheet 1: group summaries (one row per group) ---
  const summaryHeader = ["Group #", "Leader", "Status", "Submitted at", ...groupPlan.map((p) => p.header)];
  const summaryRows: Array<Record<string, string | number>> = [];
  for (const g of groupData.groups) {
    const sub = subByGroup.get(g.id);
    const groupAnswers = (sub?.group_answers ?? {}) as Record<string, unknown>;
    const leader =
      g.members.find((m) => m.role === "zu_zhang") ??
      g.members.find((m) => m.participant_id === g.leader_participant_id);
    const row: Record<string, string | number> = {
      "Group #": g.group_no,
      Leader: leader ? (leader.name_cn ?? leader.name_en ?? leader.region_id ?? "") : "",
      Status: sub?.status === "submitted" ? "Submitted" : sub ? "Draft" : "Not started",
      "Submitted at": sub?.submitted_at ? new Date(sub.submitted_at).toISOString().slice(0, 16).replace("T", " ") : "",
    };
    for (const p of groupPlan) row[p.header] = formatAnswerValue(p.field, groupAnswers, "zh");
    summaryRows.push(row);
  }

  // --- Sheet 2: member answers (one row per group member) ---
  const memberHeader = ["Group #", "Region ID", "Name", "Role", ...memberPlan.map((p) => p.header)];
  const memberRows: Array<Record<string, string | number>> = [];
  for (const g of groupData.groups) {
    const sub = subByGroup.get(g.id);
    const memberAnswersMap = (sub?.member_answers ?? {}) as Record<string, Record<string, unknown>>;
    const sorted = [...g.members].sort((a, b) => {
      const ra = ROLE_ORDER[a.role] ?? 99;
      const rb = ROLE_ORDER[b.role] ?? 99;
      if (ra !== rb) return ra - rb;
      return (a.region_id ?? "").localeCompare(b.region_id ?? "");
    });
    for (const m of sorted) {
      const ans = (memberAnswersMap[m.participant_id] ?? {}) as Record<string, unknown>;
      const row: Record<string, string | number> = {
        "Group #": g.group_no,
        "Region ID": m.region_id ?? "",
        Name: m.name_cn ?? m.name_en ?? "",
        Role: ROLE_LABEL[m.role] ?? m.role,
      };
      for (const p of memberPlan) row[p.header] = formatAnswerValue(p.field, ans, "zh");
      memberRows.push(row);
    }
  }

  const wb = XLSX.utils.book_new();
  const summarySheet = XLSX.utils.json_to_sheet(summaryRows, { header: summaryHeader });
  summarySheet["!cols"] = summaryHeader.map((h, i) => ({ wch: i < 4 ? [8, 18, 12, 16][i] : 28 }));
  XLSX.utils.book_append_sheet(wb, summarySheet, "汇总 · Summary");

  const memberSheet = XLSX.utils.json_to_sheet(memberRows, { header: memberHeader });
  memberSheet["!cols"] = memberHeader.map((h, i) => ({ wch: i < 4 ? [8, 12, 18, 14][i] : 28 }));
  XLSX.utils.book_append_sheet(wb, memberSheet, "组员 · Members");

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  await writeAuditLog({
    actor_id: admin.id,
    action: "group_report.exported_xlsx",
    entity: "events",
    entity_id: eventId,
    metadata: { group_count: groupData.groups.length, member_rows: memberRows.length },
  });

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const filename = `group-reports-${ev.slug}-${today}.xlsx`;
  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
