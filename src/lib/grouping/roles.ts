// Deterministic 组长 / 副组长 / 排长 picker.
//
// Pure functions called by both balance.ts (table-mode after assignment)
// and cushion-rank.ts (cushion-mode after seating). The same logic also
// runs server-side after a drag-drop in the GroupBuilder UI to recompute
// roles when membership changes.
//
// Rules (table mode):
//   * 组长 = highest (overall + influence) old student in the group; if
//     no old students present, the highest-scoring participant overall.
//     The group always has exactly one zu_zhang.
//   * 副组长 = next 1–2 old students by (overall + influence). Prefer 2
//     when group has ≥3 old students, else 1; if no remaining old
//     students, fall back to highest-scoring non-leader participants.
//   * Everyone else = participant.
//
// Rules (cushion mode):
//   * pai_zhang = leftmost AND rightmost cushion in each row. Single-
//     cushion rows get one pai_zhang. Everyone else = participant.
//   * No 组长 / 副组长 in cushion mode (handled by cushion-rank.ts).

import type { GroupMemberRole, GroupingParticipant } from "./types";

export type RolePick = {
  participant_id: string;
  role: GroupMemberRole;
};

// Score used to rank candidates inside a group. Old-student status is a
// tiebreaker but doesn't directly inflate the number — the role rules
// already prefer old students explicitly.
function leaderScore(p: GroupingParticipant): number {
  const overall = p.overall_score ?? 5;
  const influence = p.influence_score ?? 5;
  return overall * 2 + influence;
}

export function pickTableRoles(members: GroupingParticipant[]): RolePick[] {
  if (members.length === 0) return [];

  // Sort copies by leaderScore desc; ties broken by region_id lexicographic
  // for determinism across runs.
  const sorted = [...members].sort((a, b) => {
    const ds = leaderScore(b) - leaderScore(a);
    if (ds !== 0) return ds;
    return (a.region_id ?? "").localeCompare(b.region_id ?? "");
  });

  const oldStudents = sorted.filter((p) => p.is_old_student);
  const nonOld = sorted.filter((p) => !p.is_old_student);

  // 组长 — first old student if any, else top of overall sorted list.
  const zuZhang = oldStudents[0] ?? sorted[0];

  // Number of 副组长 — prefer 2 when ≥3 old students, else 1.
  const deputyTarget = oldStudents.length >= 3 ? 2 : 1;
  const deputyCandidates: GroupingParticipant[] = [];
  // Pull from remaining old students first.
  for (const p of oldStudents) {
    if (p.participant_id === zuZhang.participant_id) continue;
    deputyCandidates.push(p);
    if (deputyCandidates.length >= deputyTarget) break;
  }
  // If still short, fall back to highest-scoring non-old students.
  if (deputyCandidates.length < deputyTarget) {
    for (const p of nonOld) {
      if (p.participant_id === zuZhang.participant_id) continue;
      deputyCandidates.push(p);
      if (deputyCandidates.length >= deputyTarget) break;
    }
  }

  const roles: RolePick[] = [];
  const deputyIds = new Set(deputyCandidates.map((p) => p.participant_id));
  for (const p of members) {
    let role: GroupMemberRole = "participant";
    if (p.participant_id === zuZhang.participant_id) role = "zu_zhang";
    else if (deputyIds.has(p.participant_id)) role = "fu_zu_zhang";
    roles.push({ participant_id: p.participant_id, role });
  }
  return roles;
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
