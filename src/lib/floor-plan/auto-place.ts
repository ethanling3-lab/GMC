import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// M6.6 — auto-place groups onto tables + auto-seat members within each table.
//
// Algorithm:
//   1. Sort groups by class priority (strategic > key > growth > maintenance)
//      then by group_no.
//   2. Sort tables by distance from the stage (if a stage shape exists) —
//      closest first. If no stage shape, fall back to y_pct ascending (top
//      of canvas = front).
//   3. Greedy pair: for each group in priority order, assign the first
//      remaining table whose seat_count >= group's member count.
//   4. Auto-seat: within each placed group, sort members by role (zu_zhang
//      → fu_zu_zhang → participant → pai_zhang) then by participant_id for
//      determinism, and write seat_no 1..N.
//
// Mode: tables only. Cushion-mode events use the cushion-rank algorithm
// instead and skip auto-place entirely.
//
// Locked groups are preserved: their existing shape pairing (if any) stays;
// they are NOT reshuffled. Their tables are excluded from the available
// pool.

type Table = {
  id: string;
  kind: "round_table" | "square_table";
  x_pct: number;
  y_pct: number;
  width_pct: number;
  height_pct: number;
  seat_count: number | null;
  group_id: string | null;
};

type GroupRow = {
  id: string;
  group_no: number;
  group_class: "strategic" | "key" | "growth" | "maintenance";
  locked: boolean;
};

type AssignmentRow = {
  id: string;
  participant_id: string;
  group_id: string | null;
  role: "zu_zhang" | "fu_zu_zhang" | "participant" | "pai_zhang";
};

type StageShape = {
  x_pct: number;
  y_pct: number;
  width_pct: number;
  height_pct: number;
};

export type AutoPlaceResult = {
  placements: Array<{
    shape_id: string;
    group_id: string;
    group_no: number;
    member_count: number;
  }>;
  unplaced_groups: Array<{
    group_id: string;
    group_no: number;
    member_count: number;
    reason: "no_members" | "no_capacity" | "locked_kept";
  }>;
  unused_tables: number;
  seat_writes: number;
  preserved_locked: number;
};

const CLASS_PRIORITY: Record<GroupRow["group_class"], number> = {
  strategic: 0,
  key: 1,
  growth: 2,
  maintenance: 3,
};

const ROLE_ORDER: Record<AssignmentRow["role"], number> = {
  zu_zhang: 0,
  fu_zu_zhang: 1,
  participant: 2,
  pai_zhang: 3,
};

export async function autoPlaceAndSeat(
  service: SupabaseClient,
  eventId: string,
): Promise<AutoPlaceResult | { error: string }> {
  // ---------------------------------------------------------------------------
  // 1. Load everything in parallel.
  // ---------------------------------------------------------------------------
  const [shapesRes, groupsRes, assignmentsRes, stageRes] = await Promise.all([
    service
      .from("event_floor_plan_shapes")
      .select(
        "id, kind, x_pct, y_pct, width_pct, height_pct, seat_count, group_id",
      )
      .eq("event_id", eventId)
      .in("kind", ["round_table", "square_table"])
      .returns<Table[]>(),
    service
      .from("event_groups")
      .select("id, group_no, group_class, locked")
      .eq("event_id", eventId)
      .returns<GroupRow[]>(),
    service
      .from("event_seat_assignments")
      .select("id, participant_id, group_id, role")
      .eq("event_id", eventId)
      .returns<AssignmentRow[]>(),
    service
      .from("event_floor_plan_shapes")
      .select("x_pct, y_pct, width_pct, height_pct")
      .eq("event_id", eventId)
      .eq("kind", "stage")
      .limit(1)
      .maybeSingle<StageShape>(),
  ]);
  if (shapesRes.error) return { error: shapesRes.error.message };
  if (groupsRes.error) return { error: groupsRes.error.message };
  if (assignmentsRes.error) return { error: assignmentsRes.error.message };

  const tables = shapesRes.data ?? [];
  const groups = groupsRes.data ?? [];
  const assignments = assignmentsRes.data ?? [];
  const stage = stageRes.data ?? null;

  // ---------------------------------------------------------------------------
  // 2. Bucket assignments by group_id for member-count + seat ordering.
  // ---------------------------------------------------------------------------
  const membersByGroup = new Map<string, AssignmentRow[]>();
  for (const a of assignments) {
    if (!a.group_id) continue;
    if (!membersByGroup.has(a.group_id)) membersByGroup.set(a.group_id, []);
    membersByGroup.get(a.group_id)!.push(a);
  }

  // ---------------------------------------------------------------------------
  // 3. Locked groups — keep their current placement (don't unlink), reserve
  //    those tables.
  // ---------------------------------------------------------------------------
  const reservedTableIds = new Set<string>();
  const lockedKept: AutoPlaceResult["unplaced_groups"] = [];
  for (const g of groups) {
    if (!g.locked) continue;
    const memberCount = membersByGroup.get(g.id)?.length ?? 0;
    // If a table is already pointing at this locked group, reserve it.
    const heldTable = tables.find((t) => t.group_id === g.id);
    if (heldTable) reservedTableIds.add(heldTable.id);
    lockedKept.push({
      group_id: g.id,
      group_no: g.group_no,
      member_count: memberCount,
      reason: "locked_kept",
    });
  }

  // ---------------------------------------------------------------------------
  // 4. Sort un-locked groups by class priority then group_no.
  // ---------------------------------------------------------------------------
  const sortedGroups = groups
    .filter((g) => !g.locked)
    .slice()
    .sort((a, b) => {
      const cmp = CLASS_PRIORITY[a.group_class] - CLASS_PRIORITY[b.group_class];
      if (cmp !== 0) return cmp;
      return a.group_no - b.group_no;
    });

  // ---------------------------------------------------------------------------
  // 5. Sort tables by distance from stage (closest first); fall back to
  //    y_pct ascending if no stage.
  // ---------------------------------------------------------------------------
  const stageX = stage ? stage.x_pct + stage.width_pct / 2 : null;
  const stageY = stage ? stage.y_pct + stage.height_pct / 2 : null;
  const sortedTables = tables.slice().sort((a, b) => {
    const ax = a.x_pct + a.width_pct / 2;
    const ay = a.y_pct + a.height_pct / 2;
    const bx = b.x_pct + b.width_pct / 2;
    const by = b.y_pct + b.height_pct / 2;
    if (stageX !== null && stageY !== null) {
      const da = (ax - stageX) ** 2 + (ay - stageY) ** 2;
      const db = (bx - stageX) ** 2 + (by - stageY) ** 2;
      if (da !== db) return da - db;
    } else {
      // No stage — front of canvas (smaller y) = closer to "front".
      if (Math.abs(ay - by) > 1) return ay - by;
    }
    return ax - bx;
  });

  // ---------------------------------------------------------------------------
  // 6. Greedy pair groups → tables.
  // ---------------------------------------------------------------------------
  const placements: AutoPlaceResult["placements"] = [];
  const unplaced: AutoPlaceResult["unplaced_groups"] = [...lockedKept];
  const usedTables = new Set<string>(reservedTableIds);

  // Track per-shape seat_count bumps so the persistence pass renders
  // every member as a named seat around the rim. Without this, a group
  // of 12 lands on a 10-seat default round table and seats 11-12 are
  // invisible.
  const seatCountBumps = new Map<string, number>();

  for (const g of sortedGroups) {
    const members = membersByGroup.get(g.id) ?? [];
    if (members.length === 0) {
      unplaced.push({
        group_id: g.id,
        group_no: g.group_no,
        member_count: 0,
        reason: "no_members",
      });
      continue;
    }
    // First-fit: pick the next available table (by stage-distance order)
    // regardless of current seat_count. We bump seat_count to match the
    // group size during the persist pass, so visual seat rendering follows.
    const table = sortedTables.find((t) => !usedTables.has(t.id));
    if (!table) {
      unplaced.push({
        group_id: g.id,
        group_no: g.group_no,
        member_count: members.length,
        reason: "no_capacity",
      });
      continue;
    }
    usedTables.add(table.id);
    placements.push({
      shape_id: table.id,
      group_id: g.id,
      group_no: g.group_no,
      member_count: members.length,
    });
    // Stage the seat_count bump if the group is larger than the table's
    // current count; never SHRINK an existing layout.
    const currentSeats = table.seat_count ?? 0;
    if (members.length > currentSeats) {
      seatCountBumps.set(table.id, members.length);
    }
  }

  // ---------------------------------------------------------------------------
  // 7. Persist — clear group_id on tables that are no longer paired (except
  //    locked tables we reserved); set group_id on placed tables; write
  //    shape_id + seat_no on each member of placed groups; clear shape_id +
  //    seat_no for groups that ended up unplaced.
  // ---------------------------------------------------------------------------
  const placementByShape = new Map(placements.map((p) => [p.shape_id, p]));
  const placedGroupIds = new Set(placements.map((p) => p.group_id));

  // 7a. Update event_floor_plan_shapes.group_id (+ seat_count bump if the
  //     placed group is bigger than the table's current seat count) in
  //     parallel.
  const tableUpdates = tables.map((t) => {
    if (reservedTableIds.has(t.id)) {
      // Locked group's table — leave alone.
      return Promise.resolve({ error: null });
    }
    const newGroupId = placementByShape.get(t.id)?.group_id ?? null;
    const newSeatCount = seatCountBumps.get(t.id);
    const groupChanged = t.group_id !== newGroupId;
    const seatChanged =
      newSeatCount !== undefined && newSeatCount !== t.seat_count;
    if (!groupChanged && !seatChanged) {
      return Promise.resolve({ error: null });
    }
    const patch: { group_id: string | null; seat_count?: number } = {
      group_id: newGroupId,
    };
    if (seatChanged) patch.seat_count = newSeatCount;
    return service
      .from("event_floor_plan_shapes")
      .update(patch)
      .eq("id", t.id);
  });
  const tableResults = await Promise.all(tableUpdates);
  for (const r of tableResults) {
    if (r.error) return { error: r.error.message };
  }

  // 7b. Update event_seat_assignments — TWO PHASES so the unique partial
  //     index on (shape_id, seat_no) doesn't fire mid-batch.
  //
  //     Phase A: clear shape_id + seat_no on every non-locked assignment.
  //              This frees up every (shape, seat) slot atomically before
  //              we write new ones.
  //     Phase B: write shape_id + seat_no for the placed groups' members.
  //
  //     If we ran A and B's writes interleaved (Promise.all over both),
  //     a NEW (Table 5, seat 1) write could fire BEFORE the OLD (Table 5,
  //     seat 1) clear committed → UNIQUE VIOLATION on the partial index.
  let seatWrites = 0;
  const lockedGroupIds = new Set(groups.filter((g) => g.locked).map((g) => g.id));

  // Phase A — clear stale shape_id+seat_no on non-locked rows in one bulk
  // update. event_id + the not-in-locked-groups filter scopes the wipe.
  // shape_id is also flipped to null on cushion-mode-style rows
  // (shape_id non-null but group_id null) so the algorithm starts from a
  // clean slate. Locked-group members keep their seating untouched.
  if (lockedGroupIds.size > 0) {
    const lockedIdsList = Array.from(lockedGroupIds);
    const { error: clearErr } = await service
      .from("event_seat_assignments")
      .update({ shape_id: null, seat_no: null })
      .eq("event_id", eventId)
      .or(
        `group_id.not.in.(${lockedIdsList.join(",")}),group_id.is.null`,
      );
    if (clearErr) return { error: clearErr.message };
  } else {
    const { error: clearErr } = await service
      .from("event_seat_assignments")
      .update({ shape_id: null, seat_no: null })
      .eq("event_id", eventId);
    if (clearErr) return { error: clearErr.message };
  }

  // Phase B — write new (shape_id, seat_no) for placed groups' members.
  // These can fan out in parallel safely since every tuple is unique
  // (per-table seat_no 1..N + non-overlapping shape_ids across placements).
  const assignmentUpdates: Array<PromiseLike<{ error: { message: string } | null }>> = [];
  for (const p of placements) {
    const members = (membersByGroup.get(p.group_id) ?? [])
      .slice()
      .sort((a, b) => {
        const r = ROLE_ORDER[a.role] - ROLE_ORDER[b.role];
        if (r !== 0) return r;
        return a.participant_id.localeCompare(b.participant_id);
      });
    members.forEach((m, i) => {
      assignmentUpdates.push(
        service
          .from("event_seat_assignments")
          .update({ shape_id: p.shape_id, seat_no: i + 1 })
          .eq("id", m.id),
      );
      seatWrites += 1;
    });
  }
  const assignmentResults = await Promise.all(assignmentUpdates);
  for (const r of assignmentResults) {
    if (r.error) return { error: r.error.message };
  }
  void placedGroupIds; // referenced indirectly via placements above

  return {
    placements,
    unplaced_groups: unplaced,
    unused_tables: tables.length - placements.length - reservedTableIds.size,
    seat_writes: seatWrites,
    preserved_locked: lockedKept.length,
  };
}
