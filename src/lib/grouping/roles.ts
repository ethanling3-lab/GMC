// Role assignment helpers. Pure — no DB.
//
// M6.0 rewrite: 组长 are admin-curated per event, not derived from
// scores. Table mode now has a single helper `applyCuratedRoles` that
// stamps roles based on each working group's seeded leader pairing:
//   * main_zu_zhang  → 'zu_zhang'
//   * auxiliary_zu_zhang → 'fu_zu_zhang'
//   * everyone else  → 'participant'
//
// Cushion mode (`pickCushionRoles`) is unchanged — it tags leftmost +
// rightmost cushion in each row as `pai_zhang`.

import type { DraftMember, GroupMemberRole, GroupingParticipant, GroupingZuZhang } from "./types";

export type RolePick = {
  participant_id: string;
  role: GroupMemberRole;
};

// Stamp roles for a working group whose 组长 pairing is already
// seeded. Returns the full member list as DraftMember[] so the caller
// can stuff it directly into a DraftGroup.
export function applyCuratedRoles(g: {
  main_zu_zhang: GroupingZuZhang | null;
  auxiliary_zu_zhang: GroupingZuZhang | null;
  members: GroupingParticipant[];
}): DraftMember[] {
  const out: DraftMember[] = [];
  if (g.main_zu_zhang) {
    out.push({
      participant_id: g.main_zu_zhang.participant_id,
      region_id: g.main_zu_zhang.region_id,
      role: "zu_zhang",
    });
  }
  if (g.auxiliary_zu_zhang) {
    out.push({
      participant_id: g.auxiliary_zu_zhang.participant_id,
      region_id: g.auxiliary_zu_zhang.region_id,
      role: "fu_zu_zhang",
    });
  }
  for (const p of g.members) {
    out.push({
      participant_id: p.participant_id,
      region_id: p.region_id,
      role: "participant",
    });
  }
  return out;
}

// Mark leftmost + rightmost participants per row as pai_zhang. Caller
// supplies an ordered list of (rowIndex, seatIndexInRow, participant_id)
// tuples — same shape cushion-rank.ts produces.
export function pickCushionRoles(
  seated: Array<{ row_index: number; seat_index: number; participant_id: string }>,
): RolePick[] {
  // Group by row.
  const rows = new Map<number, typeof seated>();
  for (const s of seated) {
    const arr = rows.get(s.row_index) ?? [];
    arr.push(s);
    rows.set(s.row_index, arr);
  }

  const roles: RolePick[] = [];
  for (const [, rowSeats] of rows) {
    const sorted = [...rowSeats].sort((a, b) => a.seat_index - b.seat_index);
    const leftmost = sorted[0];
    const rightmost = sorted[sorted.length - 1];
    for (const s of sorted) {
      let role: GroupMemberRole = "participant";
      if (s.participant_id === leftmost.participant_id) role = "pai_zhang";
      else if (s.participant_id === rightmost.participant_id) role = "pai_zhang";
      roles.push({ participant_id: s.participant_id, role });
    }
  }
  return roles;
}
