import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase";
import type { GroupingResult } from "./types";

// Replaces the non-locked event_groups + event_seat_assignments for an
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
// Pass 2 (lock-from-regenerate): groups with locked=true are preserved
// across runs. Their assignments are NOT wiped. Fresh groups produced
// by the algorithm (group_no 1..k) are renumbered to skip locked
// group_no values so locked groups keep their identity.
//
// NOT atomic in the strict sense — Supabase REST has no native cross-
// table transaction. We accept a brief window of empty state. The route
// is super-admin gated and idempotent so an interrupted call can be
// re-run safely.

export type PersistResult = {
  groups_inserted: number;
  assignments_inserted: number;
  locked_groups_preserved: number;
};

export async function persistGroupingResult(
  eventId: string,
  result: GroupingResult,
): Promise<PersistResult | { error: string }> {
  const service = createSupabaseServiceClient();

  // Snapshot locked groups BEFORE the wipe so we know which group_no
  // values to skip when renumbering fresh groups.
  const { data: lockedGroups, error: lgErr } = await service
    .from("event_groups")
    .select("id, group_no")
    .eq("event_id", eventId)
    .eq("locked", true)
    .returns<Array<{ id: string; group_no: number }>>();
  if (lgErr) return { error: lgErr.message };
  const lockedIds = (lockedGroups ?? []).map((g) => g.id);
  const lockedNos = new Set((lockedGroups ?? []).map((g) => g.group_no));

  // Wipe previous NON-LOCKED state. Order matters: assignments → groups
  // so the group_id FK doesn't block the delete.
  let assignDelete = service
    .from("event_seat_assignments")
    .delete()
    .eq("event_id", eventId);
  if (lockedIds.length > 0) {
    // Postgrest `.not(col, "in", "(...)")` excludes locked groups'
    // assignments + the cushion-mode rows where group_id is null.
    assignDelete = assignDelete.or(
      `group_id.not.in.(${lockedIds.join(",")}),group_id.is.null`,
    );
  }
  const { error: delAssignErr } = await assignDelete;
  if (delAssignErr) return { error: delAssignErr.message };

  let groupDelete = service
    .from("event_groups")
    .delete()
    .eq("event_id", eventId);
  if (lockedIds.length > 0) {
    groupDelete = groupDelete.eq("locked", false);
  }
  const { error: delGroupsErr } = await groupDelete;
  if (delGroupsErr) return { error: delGroupsErr.message };

  // Cushion mode — write assignments only; no groups. Locked groups
  // don't apply in cushion mode (no event_groups rows in that mode).
  if (result.strategy === "cushion_rank") {
    if (result.cushion_assignments.length === 0) {
      return {
        groups_inserted: 0,
        assignments_inserted: 0,
        locked_groups_preserved: 0,
      };
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
      locked_groups_preserved: 0,
    };
  }

  // Table mode — insert groups, capture ids, then insert one
  // event_seat_assignments per draft member with NULL shape/seat.
  if (result.groups.length === 0) {
    return {
      groups_inserted: 0,
      assignments_inserted: 0,
      locked_groups_preserved: lockedNos.size,
    };
  }

  // Renumber fresh groups to skip locked group_no values. The result
  // arrives with group_no 1..k; map each fresh slot to the next
  // available number that isn't held by a locked group.
  const renumber = new Map<number, number>();
  let nextNo = 1;
  for (const g of result.groups) {
    while (lockedNos.has(nextNo)) nextNo += 1;
    renumber.set(g.group_no, nextNo);
    nextNo += 1;
  }

  const { data: insertedGroups, error: groupInsErr } = await service
    .from("event_groups")
    .insert(
      result.groups.map((g) => ({
        event_id: eventId,
        group_no: renumber.get(g.group_no)!,
        group_class: g.group_class,
        leader_participant_id: g.leader_participant_id,
        rationale_en: g.rationale_en,
        rationale_cn: g.rationale_cn,
      })),
    )
    .select("id, group_no");
  if (groupInsErr || !insertedGroups) {
    return { error: groupInsErr?.message ?? "group_insert_failed" };
  }

  const groupIdByRenumberedNo = new Map<number, string>();
  for (const g of insertedGroups) groupIdByRenumberedNo.set(g.group_no, g.id);

  const rawAssignmentRows = result.groups.flatMap((g) => {
    const renumbered = renumber.get(g.group_no);
    if (!renumbered) return [];
    const gid = groupIdByRenumberedNo.get(renumbered);
    if (!gid) return [];
    return g.members.map((m) => ({
      event_id: eventId,
      shape_id: null,
      seat_no: null,
      participant_id: m.participant_id,
      role: m.role,
      group_id: gid,
      // Carry the source group_no for the dedup log below so we can spot
      // the algorithm bug that put one participant in two groups.
      _src_group_no: g.group_no,
    }));
  });

  // Defensive dedup — the unique constraint event_seat_assignments_event_
  // participant_key blocks the same participant landing twice. The algo +
  // validator should already prevent this, but at large pax counts (300+)
  // we've seen one slip through; keep the role with higher priority
  // (zu_zhang > fu_zu_zhang > pai_zhang > participant) and log the rest.
  const ROLE_RANK: Record<string, number> = {
    zu_zhang: 0,
    fu_zu_zhang: 1,
    pai_zhang: 2,
    participant: 3,
  };
  const bestByPid = new Map<string, (typeof rawAssignmentRows)[number]>();
  const dropped: Array<{ pid: string; kept: number; dropped: number; role: string }> = [];
  for (const row of rawAssignmentRows) {
    const prev = bestByPid.get(row.participant_id);
    if (!prev) {
      bestByPid.set(row.participant_id, row);
      continue;
    }
    const prevRank = ROLE_RANK[prev.role] ?? 99;
    const curRank = ROLE_RANK[row.role] ?? 99;
    const winner = curRank < prevRank ? row : prev;
    const loser = winner === row ? prev : row;
    bestByPid.set(row.participant_id, winner);
    dropped.push({
      pid: row.participant_id,
      kept: winner._src_group_no,
      dropped: loser._src_group_no,
      role: loser.role,
    });
  }
  if (dropped.length > 0) {
    console.warn(
      `[persist] dedup'd ${dropped.length} duplicate participant assignment${dropped.length === 1 ? "" : "s"}:`,
      dropped.slice(0, 10),
    );
  }
  const assignmentRows = Array.from(bestByPid.values()).map(
    ({ _src_group_no, ...rest }) => {
      void _src_group_no;
      return rest;
    },
  );

  if (assignmentRows.length === 0) {
    return {
      groups_inserted: insertedGroups.length,
      assignments_inserted: 0,
      locked_groups_preserved: lockedNos.size,
    };
  }

  const { error: assignInsErr } = await service
    .from("event_seat_assignments")
    .insert(assignmentRows);
  if (assignInsErr) return { error: assignInsErr.message };

  return {
    groups_inserted: insertedGroups.length,
    assignments_inserted: assignmentRows.length,
    locked_groups_preserved: lockedNos.size,
  };
}
