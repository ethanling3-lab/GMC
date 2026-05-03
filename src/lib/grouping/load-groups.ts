import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GroupMemberRole, SeatingMode } from "./types";

// Loader for the GroupBuilder UI. Mode-aware:
//   tables   → groups[] with hydrated members + roles + rationale
//   cushions → ranked seat list (ordered by row → seat) with role tags
//
// Both modes also surface the event's pinning + group_size policy so the
// page can render constraint chips and the generate button knows the
// k-target window.

export type GroupBuilderEvent = {
  id: string;
  slug: string;
  title_en: string | null;
  title_cn: string | null;
  seating_mode: SeatingMode;
  group_size_min: number;
  group_size_max: number;
};

export type GroupBuilderMember = {
  // event_seat_assignments.id — the row-level identity used by drag-drop.
  assignment_id: string;
  participant_id: string;
  region_id: string | null;
  name_en: string | null;
  name_cn: string | null;
  is_old_student: boolean;
  overall_score: number | null;
  influence_score: number | null;
  pinned_group_no: number | null;
  role: GroupMemberRole;
};

export type GroupBuilderGroup = {
  id: string;
  group_no: number;
  rationale_en: string | null;
  rationale_cn: string | null;
  leader_participant_id: string | null;
  members: GroupBuilderMember[];
};

export type GroupBuilderCushion = {
  shape_id: string;
  x_pct: number;
  y_pct: number;
  // assignment may be null if the cushion is empty (no participant seated).
  assignment_id: string | null;
  participant_id: string | null;
  region_id: string | null;
  name_en: string | null;
  name_cn: string | null;
  is_old_student: boolean | null;
  role: GroupMemberRole | null;
};

export type GroupBuilderData = {
  event: GroupBuilderEvent;
  // Tables-mode payload.
  groups: GroupBuilderGroup[];
  // Cushion-mode payload.
  cushions: GroupBuilderCushion[];
  // Total approved + paid enrolments (used by the generate button + the
  // empty-state copy).
  enrolment_count: number;
};

type EventRow = {
  id: string;
  slug: string;
  title_en: string | null;
  title_cn: string | null;
  seating_mode: SeatingMode;
  group_size_min: number;
  group_size_max: number;
};

type GroupRow = {
  id: string;
  group_no: number;
  rationale_en: string | null;
  rationale_cn: string | null;
  leader_participant_id: string | null;
};

type AssignmentRow = {
  id: string;
  group_id: string | null;
  shape_id: string | null;
  participant_id: string;
  role: GroupMemberRole;
};

type ParticipantRow = {
  id: string;
  region_id: string | null;
  name_en: string | null;
  name_cn: string | null;
  is_old_student: boolean;
  overall_score: number | null;
  influence_score: number | null;
};

type EnrollmentPin = {
  participant_id: string;
  pinned_group_no: number | null;
};

type CushionShape = {
  id: string;
  x_pct: number;
  y_pct: number;
};

export async function loadGroupBuilder(
  supabase: SupabaseClient,
  eventId: string,
): Promise<GroupBuilderData | { error: string }> {
  const { data: event, error: evErr } = await supabase
    .from("events")
    .select(
      "id, slug, title_en, title_cn, seating_mode, group_size_min, group_size_max",
    )
    .eq("id", eventId)
    .maybeSingle<EventRow>();
  if (evErr) return { error: evErr.message };
  if (!event) return { error: "event_not_found" };

  // Counts + assignments + groups in parallel — none depend on each other.
  const [groupsRes, assignmentsRes, enrolPinsRes, enrolCountRes] = await Promise.all([
    supabase
      .from("event_groups")
      .select("id, group_no, rationale_en, rationale_cn, leader_participant_id")
      .eq("event_id", eventId)
      .order("group_no", { ascending: true })
      .returns<GroupRow[]>(),
    supabase
      .from("event_seat_assignments")
      .select("id, group_id, shape_id, participant_id, role")
      .eq("event_id", eventId)
      .returns<AssignmentRow[]>(),
    supabase
      .from("enrollments")
      .select("participant_id, pinned_group_no")
      .eq("event_id", eventId)
      .in("status", ["approved", "paid"])
      .returns<EnrollmentPin[]>(),
    supabase
      .from("enrollments")
      .select("id", { count: "exact", head: true })
      .eq("event_id", eventId)
      .in("status", ["approved", "paid"]),
  ]);
  if (groupsRes.error) return { error: groupsRes.error.message };
  if (assignmentsRes.error) return { error: assignmentsRes.error.message };
  if (enrolPinsRes.error) return { error: enrolPinsRes.error.message };

  const groups = groupsRes.data ?? [];
  const assignments = assignmentsRes.data ?? [];
  const pinByPid = new Map(
    (enrolPinsRes.data ?? []).map((e) => [e.participant_id, e.pinned_group_no]),
  );

  const allParticipantIds = Array.from(
    new Set(assignments.map((a) => a.participant_id)),
  );
  let participantById = new Map<string, ParticipantRow>();
  if (allParticipantIds.length > 0) {
    const { data: parts, error: pErr } = await supabase
      .from("participants")
      .select(
        "id, region_id, name_en, name_cn, is_old_student, overall_score, influence_score",
      )
      .in("id", allParticipantIds)
      .returns<ParticipantRow[]>();
    if (pErr) return { error: pErr.message };
    participantById = new Map((parts ?? []).map((p) => [p.id, p]));
  }

  // Tables payload.
  const builderGroups: GroupBuilderGroup[] = groups.map((g) => {
    const groupAssignments = assignments.filter((a) => a.group_id === g.id);
    const members: GroupBuilderMember[] = groupAssignments
      .map((a) => {
        const p = participantById.get(a.participant_id);
        return {
          assignment_id: a.id,
          participant_id: a.participant_id,
          region_id: p?.region_id ?? null,
          name_en: p?.name_en ?? null,
          name_cn: p?.name_cn ?? null,
          is_old_student: p?.is_old_student ?? false,
          overall_score: p?.overall_score ?? null,
          influence_score: p?.influence_score ?? null,
          pinned_group_no: pinByPid.get(a.participant_id) ?? null,
          role: a.role,
        };
      })
      .sort((a, b) => roleOrder(a.role) - roleOrder(b.role));
    return {
      id: g.id,
      group_no: g.group_no,
      rationale_en: g.rationale_en,
      rationale_cn: g.rationale_cn,
      leader_participant_id: g.leader_participant_id,
      members,
    };
  });

  // Cushion payload — needs the cushion shapes too. Cheap to load even
  // in table mode (returns []), so we don't branch.
  let cushions: GroupBuilderCushion[] = [];
  if (event.seating_mode === "cushions") {
    const { data: shapes, error: shErr } = await supabase
      .from("event_floor_plan_shapes")
      .select("id, x_pct, y_pct")
      .eq("event_id", eventId)
      .eq("kind", "cushion")
      .order("y_pct", { ascending: true })
      .order("x_pct", { ascending: true })
      .returns<CushionShape[]>();
    if (shErr) return { error: shErr.message };
    const shapeAssignments = new Map(
      assignments
        .filter((a) => a.shape_id != null)
        .map((a) => [a.shape_id!, a]),
    );
    cushions = (shapes ?? []).map((s) => {
      const a = shapeAssignments.get(s.id);
      const p = a ? participantById.get(a.participant_id) : null;
      return {
        shape_id: s.id,
        x_pct: s.x_pct,
        y_pct: s.y_pct,
        assignment_id: a?.id ?? null,
        participant_id: a?.participant_id ?? null,
        region_id: p?.region_id ?? null,
        name_en: p?.name_en ?? null,
        name_cn: p?.name_cn ?? null,
        is_old_student: p?.is_old_student ?? null,
        role: a?.role ?? null,
      };
    });
  }

  return {
    event,
    groups: builderGroups,
    cushions,
    enrolment_count: enrolCountRes.count ?? 0,
  };
}

function roleOrder(r: GroupMemberRole): number {
  switch (r) {
    case "zu_zhang": return 0;
    case "fu_zu_zhang": return 1;
    case "pai_zhang": return 2;
    default: return 3;
  }
}
