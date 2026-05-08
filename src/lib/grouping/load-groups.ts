import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  effectiveQualification,
  participantToClass,
  scoreToQualification,
} from "./types";
import { computeRosterShortfalls } from "./balance";
import type {
  GroupClass,
  GroupingZuZhang,
  GroupMemberRole,
  GrowthDimension,
  RosterShortfall,
  SeatingMode,
  StudentQualification,
  ZuZhangTier,
} from "./types";
import type { MotivationTag } from "@/lib/participants-query";

// Loader for the GroupBuilder UI. Mode-aware:
//   tables   → groups[] with hydrated members + roles + rationale + class
//   cushions → ranked seat list (ordered by row → seat) with role tags
//
// Both modes also surface the event's pinning + group_size policy so the
// page can render constraint chips and the generate button knows the
// k-target window.
//
// M6.0 additions:
//   * GroupBuilderGroup gets group_class.
//   * GroupBuilderMember gets zu_zhang_tier, zu_zhang_dimensions,
//     goal_dimensions, qualification (computed from override / max),
//     plus the participant's effective_class (so the UI can flag
//     mismatches between member class and group class).

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
  // enrollments.id — needed for inline-pin from the row context menu.
  enrollment_id: string | null;
  participant_id: string;
  region_id: string | null;
  name_en: string | null;
  name_cn: string | null;
  is_old_student: boolean;
  influence_score: number | null;
  financial_score: number | null;
  pinned_group_no: number | null;
  role: GroupMemberRole;

  // M6.0 fields surfaced for chip rendering.
  zu_zhang_tier: ZuZhangTier | null;
  // Effective grade (per-event override ?? participant global). Null if
  // ungraded; renders as a plain tier badge instead of a tier+grade pill.
  zu_zhang_grade: number | null;
  zu_zhang_dimensions: GrowthDimension[];
  goal_dimensions: GrowthDimension[];
  qualification: StudentQualification | null;
  // Both override-aware (for what the algorithm uses) and raw computed
  // (for "this person was overridden from X" display in the detail row).
  qualification_override: StudentQualification | null;
  qualification_computed: StudentQualification | null;
  effective_class: GroupClass;

  // Pass 1 detail-row fields.
  motivation_tag: MotivationTag | null;
  has_special_contribution: boolean;
  times_led_groups: number;
  // Region IDs of family-link partners enrolled in the same event
  // (resolved from participant_family_links + the legacy
  // family_of_participant_id column). Used by the detail row + xlsx
  // export.
  family_partner_region_ids: string[];
  // M6.4 grouping signals (migration 030).
  energy_profile: "high" | "medium" | "quiet" | null;
  language_fluency: "en" | "cn" | "both" | null;
  // Region IDs of conflict-pair partners enrolled in the same event.
  conflict_partner_region_ids: string[];
};

export type GroupBuilderGroup = {
  id: string;
  group_no: number;
  group_class: GroupClass;
  // Pass 2 — admin-curated name overrides (null = auto-format).
  name_en: string | null;
  name_cn: string | null;
  // Pass 2 — true = group survives Regenerate runs intact.
  locked: boolean;
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
  // Pass 1 visibility surfaces — computed against the CURRENT roster +
  // member distribution so the page mirrors what the next generate run
  // would see. Empty arrays / zeroed maps when no enrolments yet.
  roster_shortfalls: RosterShortfall[];
  member_count_by_class: Record<GroupClass, number>;
  k_by_class: Record<GroupClass, number>;
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
  group_class: GroupClass;
  name_en: string | null;
  name_cn: string | null;
  locked: boolean;
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
  influence_score: number | null;
  financial_score: number | null;
  zu_zhang_tier: ZuZhangTier | null;
  zu_zhang_grade: number | null;
  zu_zhang_dimensions: GrowthDimension[] | null;
  zu_zhang_core_traits: string[] | null;
  goal_dimensions: GrowthDimension[] | null;
  student_qualification: StudentQualification | null;
  motivation_tag: MotivationTag | null;
  has_special_contribution: boolean | null;
  times_led_groups: number | null;
  family_of_participant_id: string | null;
  energy_profile: "high" | "medium" | "quiet" | null;
  language_fluency: "en" | "cn" | "both" | null;
};

type EnrollmentPin = {
  id: string;
  participant_id: string;
  pinned_group_no: number | null;
  zu_zhang_grade_for_event: number | null;
  zu_zhang_tier_for_event: ZuZhangTier | null;
  serving_as_zu_zhang: boolean | null;
};

type FamilyLinkRow = { a_id: string; b_id: string };

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
      .select(
        "id, group_no, group_class, name_en, name_cn, locked, rationale_en, rationale_cn, leader_participant_id",
      )
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
      .select(
        "id, participant_id, pinned_group_no, zu_zhang_grade_for_event, zu_zhang_tier_for_event, serving_as_zu_zhang",
      )
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
  const enrolByPid = new Map(
    (enrolPinsRes.data ?? []).map((e) => [e.participant_id, e]),
  );

  const allParticipantIds = Array.from(
    new Set(assignments.map((a) => a.participant_id)),
  );
  let participantById = new Map<string, ParticipantRow>();
  if (allParticipantIds.length > 0) {
    const { data: parts, error: pErr } = await supabase
      .from("participants")
      .select(
        `id, region_id, name_en, name_cn, is_old_student,
         influence_score, financial_score,
         zu_zhang_tier, zu_zhang_grade,
         zu_zhang_dimensions, zu_zhang_core_traits,
         goal_dimensions, student_qualification,
         motivation_tag, has_special_contribution, times_led_groups,
         family_of_participant_id,
         energy_profile, language_fluency`,
      )
      .in("id", allParticipantIds)
      .returns<ParticipantRow[]>();
    if (pErr) return { error: pErr.message };
    participantById = new Map((parts ?? []).map((p) => [p.id, p]));
  }

  // Build family adjacency from BOTH the legacy single-edge column and
  // the multi-edge participant_family_links table. Mirrors the algorithm
  // loader (src/lib/grouping/load.ts) so the detail row shows the same
  // family chain the algorithm would respect. Resolves to region_ids for
  // display.
  //
  // Chunked into 100-id batches so a single `.or(a.in.(...),b.in.(...))`
  // URL never overflows PostgREST's ~8 KB request line limit. With 306+
  // UUIDs in one .or() clause, the URL hit ~12 KB and the fetch fell
  // over with `TypeError: fetch failed`.
  const familyAdj = new Map<string, Set<string>>();
  const conflictAdj = new Map<string, Set<string>>();
  if (allParticipantIds.length > 0) {
    const CHUNK = 100;
    const seenLink = new Set<string>();
    const seenConflict = new Set<string>();
    for (let i = 0; i < allParticipantIds.length; i += CHUNK) {
      const chunk = allParticipantIds.slice(i, i + CHUNK);

      const linkAResp = await supabase
        .from("participant_family_links")
        .select("a_id, b_id")
        .in("a_id", chunk)
        .returns<FamilyLinkRow[]>();
      if (linkAResp.error) return { error: linkAResp.error.message };
      const linkBResp = await supabase
        .from("participant_family_links")
        .select("a_id, b_id")
        .in("b_id", chunk)
        .returns<FamilyLinkRow[]>();
      if (linkBResp.error) return { error: linkBResp.error.message };
      for (const l of [...(linkAResp.data ?? []), ...(linkBResp.data ?? [])]) {
        const key = `${l.a_id}|${l.b_id}`;
        if (seenLink.has(key)) continue;
        seenLink.add(key);
        if (!familyAdj.has(l.a_id)) familyAdj.set(l.a_id, new Set());
        if (!familyAdj.has(l.b_id)) familyAdj.set(l.b_id, new Set());
        familyAdj.get(l.a_id)!.add(l.b_id);
        familyAdj.get(l.b_id)!.add(l.a_id);
      }

      // Same shape for conflict pairs (migration 030).
      const confAResp = await supabase
        .from("participant_conflict_pairs")
        .select("a_id, b_id")
        .in("a_id", chunk)
        .returns<FamilyLinkRow[]>();
      if (confAResp.error) return { error: confAResp.error.message };
      const confBResp = await supabase
        .from("participant_conflict_pairs")
        .select("a_id, b_id")
        .in("b_id", chunk)
        .returns<FamilyLinkRow[]>();
      if (confBResp.error) return { error: confBResp.error.message };
      for (const l of [...(confAResp.data ?? []), ...(confBResp.data ?? [])]) {
        const key = `${l.a_id}|${l.b_id}`;
        if (seenConflict.has(key)) continue;
        seenConflict.add(key);
        if (!conflictAdj.has(l.a_id)) conflictAdj.set(l.a_id, new Set());
        if (!conflictAdj.has(l.b_id)) conflictAdj.set(l.b_id, new Set());
        conflictAdj.get(l.a_id)!.add(l.b_id);
        conflictAdj.get(l.b_id)!.add(l.a_id);
      }
    }
  }
  // Fold in legacy single-edge column.
  for (const p of participantById.values()) {
    if (p.family_of_participant_id && p.family_of_participant_id !== p.id) {
      if (!familyAdj.has(p.id)) familyAdj.set(p.id, new Set());
      if (!familyAdj.has(p.family_of_participant_id)) {
        familyAdj.set(p.family_of_participant_id, new Set());
      }
      familyAdj.get(p.id)!.add(p.family_of_participant_id);
      familyAdj.get(p.family_of_participant_id)!.add(p.id);
    }
  }
  // Resolve partner IDs → region_ids (only for partners enrolled in
  // this event; out-of-event partners aren't actionable from this page).
  function partnerRegionIds(pid: string): string[] {
    const partners = familyAdj.get(pid);
    if (!partners) return [];
    const out: string[] = [];
    for (const otherId of partners) {
      const other = participantById.get(otherId);
      if (!other) continue; // partner not enrolled in this event
      if (other.region_id) out.push(other.region_id);
    }
    return out.sort();
  }

  function conflictPartnerRegionIds(pid: string): string[] {
    const partners = conflictAdj.get(pid);
    if (!partners) return [];
    const out: string[] = [];
    for (const otherId of partners) {
      const other = participantById.get(otherId);
      if (!other) continue;
      if (other.region_id) out.push(other.region_id);
    }
    return out.sort();
  }

  // Tables payload.
  const builderGroups: GroupBuilderGroup[] = groups.map((g) => {
    const groupAssignments = assignments.filter((a) => a.group_id === g.id);
    const members: GroupBuilderMember[] = groupAssignments
      .map((a) => {
        const p = participantById.get(a.participant_id);
        const qualification = p
          ? effectiveQualification({
              financial_score: p.financial_score,
              influence_score: p.influence_score,
              student_qualification_override: p.student_qualification,
            })
          : null;
        const effective_class = p
          ? participantToClass({
              financial_score: p.financial_score,
              influence_score: p.influence_score,
              student_qualification_override: p.student_qualification,
            })
          : "growth";
        const enrol = enrolByPid.get(a.participant_id);
        const computedQ = p
          ? scoreToQualification(
              Math.max(p.financial_score ?? 0, p.influence_score ?? 0) || null,
            )
          : null;
        return {
          assignment_id: a.id,
          enrollment_id: enrol?.id ?? null,
          participant_id: a.participant_id,
          region_id: p?.region_id ?? null,
          name_en: p?.name_en ?? null,
          name_cn: p?.name_cn ?? null,
          is_old_student: p?.is_old_student ?? false,
          influence_score: p?.influence_score ?? null,
          financial_score: p?.financial_score ?? null,
          pinned_group_no: enrol?.pinned_group_no ?? null,
          role: a.role,
          zu_zhang_tier: p?.zu_zhang_tier ?? null,
          // Effective grade = per-event override ?? participant global.
          zu_zhang_grade:
            enrol?.zu_zhang_grade_for_event ?? p?.zu_zhang_grade ?? null,
          zu_zhang_dimensions: p?.zu_zhang_dimensions ?? [],
          goal_dimensions: p?.goal_dimensions ?? [],
          qualification,
          qualification_override: p?.student_qualification ?? null,
          qualification_computed: computedQ,
          effective_class,
          motivation_tag: p?.motivation_tag ?? null,
          has_special_contribution: p?.has_special_contribution ?? false,
          times_led_groups: p?.times_led_groups ?? 0,
          family_partner_region_ids: p ? partnerRegionIds(p.id) : [],
          energy_profile: p?.energy_profile ?? null,
          language_fluency: p?.language_fluency ?? null,
          conflict_partner_region_ids: p ? conflictPartnerRegionIds(p.id) : [],
        };
      })
      .sort((a, b) => roleOrder(a.role) - roleOrder(b.role));
    return {
      id: g.id,
      group_no: g.group_no,
      group_class: g.group_class,
      name_en: g.name_en,
      name_cn: g.name_cn,
      locked: g.locked,
      rationale_en: g.rationale_en,
      rationale_cn: g.rationale_cn,
      leader_participant_id: g.leader_participant_id,
      members,
    };
  });

  // Cushion payload — needs the cushion shapes too.
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

  // Pre-generate visibility surfaces. Build a roster + class demand
  // from the CURRENT enrolment + curation state — same shape as what
  // src/lib/grouping/load.ts produces for the algorithm — then call the
  // existing computeRosterShortfalls helper. This way the page mirrors
  // exactly what the next generate run would see, even if the page
  // hasn't been generated yet.
  const memberCountByClass: Record<GroupClass, number> = {
    strategic: 0,
    key: 0,
    growth: 0,
    maintenance: 0,
  };
  const kByClass: Record<GroupClass, number> = {
    strategic: 0,
    key: 0,
    growth: 0,
    maintenance: 0,
  };
  let rosterShortfalls: RosterShortfall[] = [];
  if ((enrolPinsRes.data ?? []).length > 0) {
    // Need participant qualification + zu_zhang fields for every
    // enrolled participant — even those not yet assigned to groups.
    const enrolPids = (enrolPinsRes.data ?? []).map((e) => e.participant_id);
    const missingPids = enrolPids.filter((id) => !participantById.has(id));
    if (missingPids.length > 0) {
      const { data: extra, error: xErr } = await supabase
        .from("participants")
        .select(
          `id, region_id, name_en, name_cn, is_old_student,
           influence_score, financial_score,
           zu_zhang_tier, zu_zhang_grade,
           zu_zhang_dimensions, zu_zhang_core_traits,
           goal_dimensions, student_qualification,
           motivation_tag, has_special_contribution, times_led_groups,
           family_of_participant_id`,
        )
        .in("id", missingPids)
        .returns<ParticipantRow[]>();
      if (xErr) return { error: xErr.message };
      for (const p of extra ?? []) participantById.set(p.id, p);
    }

    // Bucket enrolled members by their effective class.
    for (const e of enrolPinsRes.data ?? []) {
      const p = participantById.get(e.participant_id);
      if (!p) continue;
      const cls = participantToClass({
        financial_score: p.financial_score,
        influence_score: p.influence_score,
        student_qualification_override: p.student_qualification,
      });
      memberCountByClass[cls] += 1;
    }

    // k per class — same formula as balance.ts (regular capacity =
    // group_size_max - 2 to reserve seats for the leader pair).
    const regularCapacity = Math.max(1, event.group_size_max - 2);
    for (const cls of ["strategic", "key", "growth", "maintenance"] as GroupClass[]) {
      if (memberCountByClass[cls] === 0) continue;
      kByClass[cls] = Math.ceil(memberCountByClass[cls] / regularCapacity);
    }

    // Build the curated 组长 roster the algorithm would consume.
    const roster: GroupingZuZhang[] = [];
    for (const e of enrolPinsRes.data ?? []) {
      if (!e.serving_as_zu_zhang) continue;
      const p = participantById.get(e.participant_id);
      if (!p) continue;
      const tier = e.zu_zhang_tier_for_event ?? p.zu_zhang_tier;
      if (!tier) continue;
      const grade = e.zu_zhang_grade_for_event ?? p.zu_zhang_grade;
      roster.push({
        participant_id: p.id,
        region_id: p.region_id,
        tier,
        grade,
        dimensions: p.zu_zhang_dimensions ?? [],
        core_traits: (p.zu_zhang_core_traits ?? []) as never,
        is_main:
          tier === "key_recruitment"
          || tier === "recruitment"
          || tier === "maintenance",
        is_auxiliary: tier === "auxiliary",
      });
    }
    rosterShortfalls = computeRosterShortfalls(roster, kByClass);
  }

  return {
    event,
    groups: builderGroups,
    cushions,
    enrolment_count: enrolCountRes.count ?? 0,
    roster_shortfalls: rosterShortfalls,
    member_count_by_class: memberCountByClass,
    k_by_class: kByClass,
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
