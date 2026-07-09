import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { normalizeGroupReportSchema } from "@/lib/group-report-schema";
import type {
  GroupReportFillData,
  GroupReportMember,
  LeaderGroupReportItem,
} from "@/lib/group-report-portal-types";

// Server-only read/gate path for the leader-facing group report. A participant
// "leads" a group when their event_seat_assignments.role is zu_zhang/fu_zu_zhang
// for that group, OR they are event_groups.leader_participant_id. Group reports
// are only fillable when the group's event has an active template.
//
// These tables have no participant-self RLS policy, so we use the service-role
// client (as participant-guard / participant-self already do) and always scope
// by the authenticated participant_id.

const LEADER_ROLES = ["zu_zhang", "fu_zu_zhang"];

export async function isGroupLeaderOfGroup(
  participantId: string,
  groupId: string,
): Promise<boolean> {
  const service = createSupabaseServiceClient();

  const { data: seat } = await service
    .from("event_seat_assignments")
    .select("id")
    .eq("group_id", groupId)
    .eq("participant_id", participantId)
    .in("role", LEADER_ROLES)
    .limit(1)
    .maybeSingle();
  if (seat) return true;

  const { data: grp } = await service
    .from("event_groups")
    .select("id")
    .eq("id", groupId)
    .eq("leader_participant_id", participantId)
    .limit(1)
    .maybeSingle();
  return !!grp;
}

// Groups this participant leads whose event has an active template, with fill
// status. Used by /me/group to list "reports to fill".
export async function loadLeaderGroupReports(
  participantId: string,
): Promise<LeaderGroupReportItem[]> {
  const service = createSupabaseServiceClient();

  // Group ids led via seat role.
  const { data: seats } = await service
    .from("event_seat_assignments")
    .select("group_id")
    .eq("participant_id", participantId)
    .in("role", LEADER_ROLES);
  const groupIds = new Set<string>();
  for (const s of (seats ?? []) as Array<{ group_id: string | null }>) {
    if (s.group_id) groupIds.add(s.group_id);
  }
  // Group ids led via denormalized leader pointer.
  const { data: ledGroups } = await service
    .from("event_groups")
    .select("id")
    .eq("leader_participant_id", participantId);
  for (const g of (ledGroups ?? []) as Array<{ id: string }>) groupIds.add(g.id);

  if (groupIds.size === 0) return [];

  const { data: groups } = await service
    .from("event_groups")
    .select("id, group_no, event_id, event:events(id, title_en, title_cn, group_report_template_id)")
    .in("id", [...groupIds]);

  type Row = {
    id: string;
    group_no: number;
    event_id: string;
    event: { id: string; title_en: string | null; title_cn: string | null; group_report_template_id: string | null } | null;
  };
  const rows = ((groups ?? []) as unknown as Row[]).filter(
    (r) => r.event && r.event.group_report_template_id,
  );
  if (rows.length === 0) return [];

  // Submission statuses.
  const { data: subs } = await service
    .from("group_report_submissions")
    .select("group_id, status")
    .in(
      "group_id",
      rows.map((r) => r.id),
    );
  const statusByGroup = new Map<string, "draft" | "submitted">();
  for (const s of (subs ?? []) as Array<{ group_id: string; status: "draft" | "submitted" }>) {
    statusByGroup.set(s.group_id, s.status);
  }

  return rows
    .map((r) => ({
      group_id: r.id,
      group_no: r.group_no,
      event_id: r.event_id,
      event_title: r.event!.title_cn ?? r.event!.title_en ?? null,
      status: statusByGroup.get(r.id) ?? null,
    }))
    .sort((a, b) => a.group_no - b.group_no);
}

// Full fill data for one group, leadership-gated. Returns null when the caller
// doesn't lead the group or the event has no active template.
export async function loadGroupReportForFill(
  participantId: string,
  groupId: string,
): Promise<GroupReportFillData | null> {
  if (!(await isGroupLeaderOfGroup(participantId, groupId))) return null;

  const service = createSupabaseServiceClient();

  const { data: groupRow } = await service
    .from("event_groups")
    .select("id, group_no, event_id, event:events(id, title_en, title_cn, group_report_template_id)")
    .eq("id", groupId)
    .maybeSingle();
  if (!groupRow) return null;
  const group = groupRow as unknown as {
    id: string;
    group_no: number;
    event_id: string;
    event: { id: string; title_en: string | null; title_cn: string | null; group_report_template_id: string | null } | null;
  };
  if (!group.event || !group.event.group_report_template_id) return null;

  const { data: tpl } = await service
    .from("group_report_templates")
    .select("schema")
    .eq("id", group.event.group_report_template_id)
    .is("deleted_at", null)
    .maybeSingle();
  const schema = normalizeGroupReportSchema((tpl as { schema: unknown } | null)?.schema);

  // Members of the group — privacy-scoped (region_id + name + role only).
  const { data: seats } = await service
    .from("event_seat_assignments")
    .select("participant_id, role, participant:participants(id, region_id, name_en, name_cn)")
    .eq("group_id", groupId);
  type SeatRow = {
    participant_id: string;
    role: string;
    participant: { id: string; region_id: string | null; name_en: string | null; name_cn: string | null } | null;
  };
  const roleOrder: Record<string, number> = { zu_zhang: 0, fu_zu_zhang: 1, pai_zhang: 2, participant: 3 };
  const members: GroupReportMember[] = ((seats ?? []) as unknown as SeatRow[])
    .filter((s) => s.participant)
    .map((s) => ({
      participant_id: s.participant_id,
      region_id: s.participant!.region_id,
      name_en: s.participant!.name_en,
      name_cn: s.participant!.name_cn,
      role: s.role,
    }))
    .sort((a, b) => {
      const ra = roleOrder[a.role] ?? 99;
      const rb = roleOrder[b.role] ?? 99;
      if (ra !== rb) return ra - rb;
      return (a.region_id ?? "").localeCompare(b.region_id ?? "");
    });

  const { data: subRow } = await service
    .from("group_report_submissions")
    .select("status, group_answers, member_answers, submitted_at")
    .eq("event_id", group.event_id)
    .eq("group_id", groupId)
    .maybeSingle();
  const submission = subRow
    ? {
        status: (subRow as { status: "draft" | "submitted" }).status,
        group_answers: ((subRow as { group_answers: Record<string, unknown> }).group_answers) ?? {},
        member_answers: ((subRow as { member_answers: Record<string, Record<string, unknown>> }).member_answers) ?? {},
        submitted_at: (subRow as { submitted_at: string | null }).submitted_at,
      }
    : null;

  return {
    group: { id: group.id, group_no: group.group_no, event_id: group.event_id },
    event: { id: group.event.id, title_en: group.event.title_en, title_cn: group.event.title_cn },
    schema,
    members,
    submission,
  };
}
