// Cushion-mode seating: rank participants by composite score, then walk
// the cushion grid front-to-back / left-to-right and assign in order.
//
// No grouping, no LLM, no rationale. Used by meditation-class events
// where seating reflects personal-score precedence (front rows for the
// most senior students; cushions at the ends of each row are 排长).
//
// Pure function. Caller loads the cushion shapes + participants and
// persists the assignments.

import { pickCushionRoles } from "./roles";
import type {
  CushionAssignment,
  CushionShape,
  GroupingParticipant,
  GroupingResult,
} from "./types";

export type CushionRankInput = {
  participants: GroupingParticipant[];
  cushions: CushionShape[];
};

export function cushionRank(input: CushionRankInput): GroupingResult {
  const n = input.participants.length;
  if (input.cushions.length === 0) {
    return {
      strategy: "cushion_rank",
      groups: [],
      cushion_assignments: [],
      metadata: { n, k: 0 },
    };
  }

  // Step 1 — sort participants by composite score desc; ties broken by
  // is_old_student first (true before false), then by region_id for
  // determinism.
  const ranked = [...input.participants].sort((a, b) => {
    const sa = compositeScore(a);
    const sb = compositeScore(b);
    if (sb !== sa) return sb - sa;
    if (a.is_old_student !== b.is_old_student) {
      return a.is_old_student ? -1 : 1;
    }
    return (a.region_id ?? "").localeCompare(b.region_id ?? "");
  });

  // Step 2 — cluster cushions into rows by y_pct. Rows defined as
  // groups of cushions whose y_pct values are within `eps` of each
  // other, where eps = max(avg cushion height, 2%).
  const avgHeight =
    input.cushions.reduce((acc, c) => acc + c.height_pct, 0)
    / input.cushions.length;
  const eps = Math.max(avgHeight, 2);

  const rows = clusterCushionsIntoRows(input.cushions, eps);

  // Step 3 — flatten the row-major order: front rows first, left→right
  // within each row. This is the seating order.
  type SeatTuple = {
    row_index: number;
    seat_index: number;
    shape_id: string;
  };
  const seatOrder: SeatTuple[] = [];
  for (let rowIdx = 0; rowIdx < rows.length; rowIdx += 1) {
    const row = rows[rowIdx];
    for (let seatIdx = 0; seatIdx < row.length; seatIdx += 1) {
      seatOrder.push({
        row_index: rowIdx,
        seat_index: seatIdx,
        shape_id: row[seatIdx].id,
      });
    }
  }

  // Step 4 — assign in lockstep up to min(participants, seats).
  const seatedCount = Math.min(ranked.length, seatOrder.length);
  const seated: Array<{ row_index: number; seat_index: number; participant_id: string; shape_id: string }> = [];
  for (let i = 0; i < seatedCount; i += 1) {
    seated.push({
      row_index: seatOrder[i].row_index,
      seat_index: seatOrder[i].seat_index,
      participant_id: ranked[i].participant_id,
      shape_id: seatOrder[i].shape_id,
    });
  }

  // Step 5 — role pass: leftmost + rightmost per row → pai_zhang.
  const roles = pickCushionRoles(seated);
  const roleByPid = new Map(roles.map((r) => [r.participant_id, r.role]));

  const cushion_assignments: CushionAssignment[] = seated.map((s) => ({
    shape_id: s.shape_id,
    seat_no: 0, // cushion shapes have seat_count=1 → conventional seat_no=0
    participant_id: s.participant_id,
    role: roleByPid.get(s.participant_id) ?? "participant",
  }));

  return {
    strategy: "cushion_rank",
    groups: [], // cushion mode has no logical groups
    cushion_assignments,
    metadata: { n, k: rows.length },
  };
}

function compositeScore(p: GroupingParticipant): number {
  const overall = p.overall_score ?? 5;
  const influence = p.influence_score ?? 5;
  const financial = p.financial_score ?? 5;
  return overall * 2 + influence + financial;
}

// Single-pass clustering: sort cushions by y_pct ascending, then walk
// the list adding to the current row until y_pct jumps by > eps; that
// starts a new row. Within each row, sort by x_pct ascending.
//
// Front-of-room is the smallest y_pct (top of viewport) — same convention
// as SVG / screen coords. The events.podium_position is what defines
// "front" but for cushion mode the algorithm assumes top-of-viewport =
// front by convention; admin lays the room out accordingly.
function clusterCushionsIntoRows(
  cushions: CushionShape[],
  eps: number,
): CushionShape[][] {
  if (cushions.length === 0) return [];
  const sortedByY = [...cushions].sort((a, b) => a.y_pct - b.y_pct);
  const rows: CushionShape[][] = [];
  let current: CushionShape[] = [sortedByY[0]];
  let bandY = sortedByY[0].y_pct;
  for (let i = 1; i < sortedByY.length; i += 1) {
    const c = sortedByY[i];
    if (c.y_pct - bandY <= eps) {
      current.push(c);
    } else {
      rows.push(current);
      current = [c];
      bandY = c.y_pct;
    }
  }
  rows.push(current);
  for (const row of rows) {
    row.sort((a, b) => a.x_pct - b.x_pct);
  }
  return rows;
}
