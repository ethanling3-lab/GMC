import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase";
import type { GroupingResult } from "./types";

// Replaces the existing event_groups + event_seat_assignments for an
// event with the result of a fresh grouping run. Idempotent.
//
// Table mode: writes event_groups (with rationales + leader) and one
// event_seat_assignments per draft member with shape_id/seat_no NULL.
// Auto-place (M6.6) backfills shape_id/seat_no by UPDATE, not INSERT,
// so the unique-on-(event_id, participant_id) constraint stays sticky.
//
// Cushion mode: skips event_groups; writes event_seat_assignments per
// cushion_assignments entry, with shape_id + seat_no already populated.
//
// NOT atomic in the strict sense — Supabase REST has no native cross-
// table transaction. We accept a brief window of empty state. The route
// is super-admin gated and idempotent so an interrupted call can be
// re-run safely.

export type PersistResult = {
  groups_inserted: number;
  assignments_inserted: number;
};

export async function persistGroupingResult(
  eventId: string,
  result: GroupingResult,
): Promise<PersistResult | { error: string }> {
  const service = createSupabaseServiceClient();

  // Wipe previous state. Order matters: assignments → groups so the
  // group_id FK doesn't block the delete.
  const { error: delAssignErr } = await service
    .from("event_seat_assignments")
    .delete()
    .eq("event_id", eventId);
  if (delAssignErr) return { error: delAssignErr.message };

  const { error: delGroupsErr } = await service
    .from("event_groups")
    .delete()
    .eq("event_id", eventId);
  if (delGroupsErr) return { error: delGroupsErr.message };

  // Cushion mode — write assignments only; no groups.
  if (result.strategy === "cushion_rank") {
    if (result.cushion_assignments.length === 0) {
      return { groups_inserted: 0, assignments_inserted: 0 };
    }
    const { error: insErr } = await service
      .from("event_seat_assignments")
      .insert(
        result.cushion_assignments.map((a) => ({
          event_id: eventId,
          shape_id: a.shape_id,
          seat_no: a.seat_no,
          participant_id: a.participant_id,
          role: a.role,
          group_id: null,
        })),
      );
    if (insErr) return { error: insErr.message };
    return {
      groups_inserted: 0,
      assignments_inserted: result.cushion_assignments.length,
    };
  }

  // Table mode — insert groups, capture ids, then insert one
  // event_seat_assignments per draft member with NULL shape/seat.
  if (result.groups.length === 0) {
    return { groups_inserted: 0, assignments_inserted: 0 };
  }

  const { data: insertedGroups, error: groupInsErr } = await service
    .from("event_groups")
    .insert(
      result.groups.map((g) => ({
        event_id: eventId,
        group_no: g.group_no,
        leader_participant_id: g.leader_participant_id,
        rationale_en: g.rationale_en,
        rationale_cn: g.rationale_cn,
      })),
    )
    .select("id, group_no");
  if (groupInsErr || !insertedGroups) {
    return { error: groupInsErr?.message ?? "group_insert_failed" };
  }

  const groupIdByNo = new Map<number, string>();
  for (const g of insertedGroups) groupIdByNo.set(g.group_no, g.id);

  const assignmentRows = result.groups.flatMap((g) => {
    const gid = groupIdByNo.get(g.group_no);
    if (!gid) return [];
    return g.members.map((m) => ({
      event_id: eventId,
      shape_id: null,
      seat_no: null,
      participant_id: m.participant_id,
      role: m.role,
      group_id: gid,
    }));
  });

  if (assignmentRows.length === 0) {
    return { groups_inserted: insertedGroups.length, assignments_inserted: 0 };
  }

  const { error: assignInsErr } = await service
    .from("event_seat_assignments")
    .insert(assignmentRows);
  if (assignInsErr) return { error: assignInsErr.message };

  return {
    groups_inserted: insertedGroups.length,
    assignments_inserted: assignmentRows.length,
  };
}
