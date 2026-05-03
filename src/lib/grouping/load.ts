import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CushionShape,
  GroupingConfig,
  GroupingParticipant,
  SeatingMode,
} from "./types";

// Loads the inputs the generate route needs:
//   * event row → seating_mode + group_size_min/max
//   * enrolled participants (status in approved/paid) joined with the
//     participants table for scoring fields
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
  cushions: CushionShape[];
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
  if (evErr) return { error: evErr.message };
  if (!event) return { error: "event_not_found" };

  const { data: enrolments, error: enErr } = await supabase
    .from("enrollments")
    .select(
      "id, pinned_group_no, participant:participants!inner(id, region_id, overall_score, influence_score, financial_score, motivation_tag, is_old_student, family_of_participant_id, region)",
    )
    .eq("event_id", eventId)
    .in("status", ["approved", "paid"])
    .returns<EnrolmentRow[]>();
  if (enErr) return { error: enErr.message };

  const participants: GroupingParticipant[] = (enrolments ?? [])
    .filter((e) => e.participant)
    .map((e) => ({
      participant_id: e.participant!.id,
      region_id: e.participant!.region_id,
      overall_score: e.participant!.overall_score,
      influence_score: e.participant!.influence_score,
      financial_score: e.participant!.financial_score,
      motivation_tag: e.participant!.motivation_tag,
      is_old_student: e.participant!.is_old_student,
      family_of_participant_id: e.participant!.family_of_participant_id,
      region: e.participant!.region,
      pinned_group_no: e.pinned_group_no,
    }));

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
    cushions,
  };
}
