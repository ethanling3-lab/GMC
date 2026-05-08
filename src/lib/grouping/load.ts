import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CushionShape,
  GroupingConfig,
  GroupingParticipant,
  GroupingZuZhang,
  GrowthDimension,
  SeatingMode,
  StudentQualification,
  ZuZhangCoreTrait,
  ZuZhangTier,
} from "./types";

// Loads the inputs the generate route needs:
//   * event row → seating_mode + group_size_min/max
//   * enrolled participants (status in approved/paid) joined with the
//     participants table for scoring + qualitative fields
//   * curated 组长 roster — enrolments where serving_as_zu_zhang=true,
//     resolved to GroupingZuZhang (effective tier from
//     enrollments.zu_zhang_tier_for_event ?? participants.zu_zhang_tier)
//   * cushion shapes (cushion mode only) for row clustering
//
// The route is responsible for deciding which algorithm to call; this
// loader returns everything either path might need.

export type GroupingLoadedInputs = {
  event: {
    id: string;
    seating_mode: SeatingMode;
    config: GroupingConfig;
  };
  participants: GroupingParticipant[];
  zu_zhang_roster: GroupingZuZhang[];
  cushions: CushionShape[];
  // Pass 2 — group_no values currently held by locked groups. Persist
  // skips these when renumbering fresh groups so locked groups keep
  // their identity across regenerate runs.
  locked_group_nos: number[];
};

type EventRow = {
  id: string;
  seating_mode: SeatingMode;
  group_size_min: number;
  group_size_max: number;
};

type EnrolmentRow = {
  id: string;
  pinned_group_no: number | null;
  serving_as_zu_zhang: boolean;
  zu_zhang_tier_for_event: ZuZhangTier | null;
  zu_zhang_grade_for_event: number | null;
  participant: {
    id: string;
    region_id: string | null;
    overall_score: number | null;
    influence_score: number | null;
    financial_score: number | null;
    motivation_tag: string | null;
    is_old_student: boolean;
    family_of_participant_id: string | null;
    region: string | null;
    goal_dimensions: GrowthDimension[] | null;
    student_qualification: StudentQualification | null;
    zu_zhang_tier: ZuZhangTier | null;
    zu_zhang_grade: number | null;
    zu_zhang_dimensions: GrowthDimension[] | null;
    zu_zhang_core_traits: ZuZhangCoreTrait[] | null;
    energy_profile: "high" | "medium" | "quiet" | null;
    language_fluency: "en" | "cn" | "both" | null;
  } | null;
};

export async function loadGroupingInputs(
  supabase: SupabaseClient,
  eventId: string,
): Promise<GroupingLoadedInputs | { error: string }> {
  const { data: event, error: evErr } = await supabase
    .from("events")
    .select("id, seating_mode, group_size_min, group_size_max")
    .eq("id", eventId)
    .maybeSingle<EventRow>();
  if (evErr) return { error: `events:${evErr.message}` };
  if (!event) return { error: "event_not_found" };

  const { data: enrolments, error: enErr } = await supabase
    .from("enrollments")
    .select(
      `id, pinned_group_no, serving_as_zu_zhang, zu_zhang_tier_for_event,
       zu_zhang_grade_for_event,
       participant:participants!inner(
         id, region_id,
         overall_score, influence_score, financial_score, motivation_tag,
         is_old_student, family_of_participant_id, region,
         goal_dimensions, student_qualification,
         zu_zhang_tier, zu_zhang_grade, zu_zhang_dimensions, zu_zhang_core_traits,
         energy_profile, language_fluency
       )`,
    )
    .eq("event_id", eventId)
    .in("status", ["approved", "paid"])
    .returns<EnrolmentRow[]>();
  if (enErr) return { error: `enrollments:${enErr.message}` };

  let enrolmentRows = (enrolments ?? []).filter((e) => e.participant);

  // Pass 2 — locked groups: read their assignments so we can exclude
  // those participants from the to-be-assigned pool AND keep their
  // group_no values reserved for the persist step.
  const { data: lockedGroups, error: lgErr } = await supabase
    .from("event_groups")
    .select("id, group_no")
    .eq("event_id", eventId)
    .eq("locked", true)
    .returns<Array<{ id: string; group_no: number }>>();
  if (lgErr) return { error: `locked_groups:${lgErr.message}` };
  const lockedGroupIds = (lockedGroups ?? []).map((g) => g.id);
  const lockedGroupNos = (lockedGroups ?? [])
    .map((g) => g.group_no)
    .sort((a, b) => a - b);
  const lockedPids = new Set<string>();
  if (lockedGroupIds.length > 0) {
    const { data: lockedAssigns, error: laErr } = await supabase
      .from("event_seat_assignments")
      .select("participant_id")
      .in("group_id", lockedGroupIds)
      .returns<Array<{ participant_id: string }>>();
    if (laErr) return { error: `locked_assignments:${laErr.message}` };
    for (const a of lockedAssigns ?? []) lockedPids.add(a.participant_id);
  }
  if (lockedPids.size > 0) {
    enrolmentRows = enrolmentRows.filter(
      (e) => !lockedPids.has(e.participant!.id),
    );
  }

  // Pull the family-link join table for everyone in this event so the
  // algorithm sees the full multi-edge graph. With large events (~300+),
  // a single `.or(a.in.(...),b.in.(...))` URL would overflow PostgREST's
  // request line limit (~8 KB), so we batch the participant id list into
  // 100-id chunks per axis and union the results client-side.
  const eventPids = enrolmentRows.map((e) => e.participant!.id);
  const familyByPid = new Map<string, Set<string>>();
  const conflictByPid = new Map<string, Set<string>>();
  if (eventPids.length > 0) {
    const CHUNK = 100;
    const seenLink = new Set<string>();
    const seenConflict = new Set<string>();
    for (let i = 0; i < eventPids.length; i += CHUNK) {
      const chunk = eventPids.slice(i, i + CHUNK);

      // Two queries per chunk (a_id IN chunk, b_id IN chunk) — each fits
      // well under the URL limit and PostgREST de-dups the union for us.
      const linkAResp = await supabase
        .from("participant_family_links")
        .select("a_id, b_id")
        .in("a_id", chunk);
      if (linkAResp.error) {
        return { error: `family_links_a:${linkAResp.error.message}` };
      }
      const linkBResp = await supabase
        .from("participant_family_links")
        .select("a_id, b_id")
        .in("b_id", chunk);
      if (linkBResp.error) {
        return { error: `family_links_b:${linkBResp.error.message}` };
      }
      for (const l of [...(linkAResp.data ?? []), ...(linkBResp.data ?? [])]) {
        const key = `${l.a_id}|${l.b_id}`;
        if (seenLink.has(key)) continue;
        seenLink.add(key);
        if (!familyByPid.has(l.a_id)) familyByPid.set(l.a_id, new Set());
        if (!familyByPid.has(l.b_id)) familyByPid.set(l.b_id, new Set());
        familyByPid.get(l.a_id)!.add(l.b_id);
        familyByPid.get(l.b_id)!.add(l.a_id);
      }

      // Same shape for conflict pairs.
      const confAResp = await supabase
        .from("participant_conflict_pairs")
        .select("a_id, b_id")
        .in("a_id", chunk);
      if (confAResp.error) {
        return { error: `conflict_pairs_a:${confAResp.error.message}` };
      }
      const confBResp = await supabase
        .from("participant_conflict_pairs")
        .select("a_id, b_id")
        .in("b_id", chunk);
      if (confBResp.error) {
        return { error: `conflict_pairs_b:${confBResp.error.message}` };
      }
      for (const l of [...(confAResp.data ?? []), ...(confBResp.data ?? [])]) {
        const key = `${l.a_id}|${l.b_id}`;
        if (seenConflict.has(key)) continue;
        seenConflict.add(key);
        if (!conflictByPid.has(l.a_id)) conflictByPid.set(l.a_id, new Set());
        if (!conflictByPid.has(l.b_id)) conflictByPid.set(l.b_id, new Set());
        conflictByPid.get(l.a_id)!.add(l.b_id);
        conflictByPid.get(l.b_id)!.add(l.a_id);
      }
    }
  }

  const participants: GroupingParticipant[] = enrolmentRows.map((e) => ({
    participant_id: e.participant!.id,
    region_id: e.participant!.region_id,
    overall_score: e.participant!.overall_score,
    influence_score: e.participant!.influence_score,
    financial_score: e.participant!.financial_score,
    motivation_tag: e.participant!.motivation_tag,
    is_old_student: e.participant!.is_old_student,
    family_of_participant_id: e.participant!.family_of_participant_id,
    family_member_ids: Array.from(familyByPid.get(e.participant!.id) ?? []),
    region: e.participant!.region,
    pinned_group_no: e.pinned_group_no,
    goal_dimensions: e.participant!.goal_dimensions ?? [],
    student_qualification_override: e.participant!.student_qualification,
    energy_profile: e.participant!.energy_profile,
    language_fluency: e.participant!.language_fluency,
    conflict_member_ids: Array.from(conflictByPid.get(e.participant!.id) ?? []),
  }));

  // Curated 组长 roster — only enrolments admin has flagged. Effective
  // tier = per-event override else participant's global tier. Drops any
  // serving=true rows where the participant has no global tier AND no
  // override (data integrity defense — admin shouldn't be able to flag
  // someone with no tier, but UI bugs can slip through).
  const zu_zhang_roster: GroupingZuZhang[] = [];
  for (const e of enrolmentRows) {
    if (!e.serving_as_zu_zhang) continue;
    const tier = e.zu_zhang_tier_for_event ?? e.participant!.zu_zhang_tier;
    if (!tier) continue;
    const grade = e.zu_zhang_grade_for_event ?? e.participant!.zu_zhang_grade;
    zu_zhang_roster.push({
      participant_id: e.participant!.id,
      region_id: e.participant!.region_id,
      tier,
      grade,
      dimensions: e.participant!.zu_zhang_dimensions ?? [],
      core_traits: e.participant!.zu_zhang_core_traits ?? [],
      is_main:
        tier === "key_recruitment"
        || tier === "recruitment"
        || tier === "maintenance",
      is_auxiliary: tier === "auxiliary",
    });
  }

  let cushions: CushionShape[] = [];
  if (event.seating_mode === "cushions") {
    const { data: shapes, error: shErr } = await supabase
      .from("event_floor_plan_shapes")
      .select("id, x_pct, y_pct, height_pct")
      .eq("event_id", eventId)
      .eq("kind", "cushion")
      .returns<CushionShape[]>();
    if (shErr) return { error: shErr.message };
    cushions = shapes ?? [];
  }

  return {
    event: {
      id: event.id,
      seating_mode: event.seating_mode,
      config: {
        group_size_min: event.group_size_min,
        group_size_max: event.group_size_max,
      },
    },
    participants,
    zu_zhang_roster,
    cushions,
    locked_group_nos: lockedGroupNos,
  };
}
