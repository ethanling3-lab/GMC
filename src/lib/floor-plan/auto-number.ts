import { isTableKind, type ShapeKind } from "@/components/admin/layout/types";

// Auto-number tables by layout order — the way a venue actually numbers them:
// front row first, left to right, then the next row back.
//
// Pure geometry, no DB, no directives. Runs CLIENT-SIDE in the editor rather
// than as an API route, unlike auto-place. Three reasons:
//   1. It needs no reads — the editor already holds every shape.
//   2. It flows through the existing maybePushHistory() → setShapes →
//      dirtyRef → scheduleSave() machinery, so ⌘Z undoes a 40-table renumber
//      for free.
//   3. No seat assignments move, so unlike runAutoPlace it needs no
//      window.location.reload() afterwards.
//
// RELATIONSHIP TO auto-place.ts
//
// auto-place sorts tables by raw radial distance from the stage. That is fine
// for greedy first-fit pairing but wrong for numbering: radial distance
// scrambles rows, because a table at the far left of row 1 is "further" from
// the stage than a table in the middle of row 2. So here we project onto the
// stage's orientation instead — depth (toward/away from stage) and lateral
// (along the stage) — then band by depth.

export type NumberableShape = {
  id: string;
  kind: ShapeKind;
  x_pct: number;
  y_pct: number;
  width_pct: number;
  height_pct: number;
  locked: boolean;
  table_no: number | null;
};

export type AutoNumberOptions = {
  /**
   * Locked tables are never written to, and their existing numbers are
   * reserved so the counter skips them. Consistent with every inspector field
   * being disabled on a locked shape. Default true.
   */
  respectLocked?: boolean;
  /**
   * Only assign to tables whose table_no is null, treating every existing
   * number as reserved. The ⌥-click modifier. Default false — a plain
   * Auto-number is a full renumber of unlocked tables, because "number by
   * layout order" is meaningless if arbitrary values stay pinned.
   */
  fillBlanksOnly?: boolean;
  /**
   * Row-band tolerance in SVG user-space units. Two tables whose depth
   * differs by less than this are the same row. Default is derived from the
   * tables' own size (see DEFAULT_ROW_TOLERANCE_FACTOR).
   */
  rowTolerance?: number;
  /** First number handed out. Default 1. */
  startAt?: number;
};

export type AutoNumberResult = {
  /** id → new table_no. ONLY tables whose number actually changed. */
  changes: Map<string, number>;
  /** ids skipped because they were locked. */
  skipped: string[];
  /** rows (depth bands) detected — surfaced in the confirm dialog. */
  rows: number;
  /** how many tables ended up with a number, including unchanged ones. */
  numbered: number;
};

// A round table defaults to 12u across, so 0.75 × that ≈ 9u: tables within
// roughly one table-width of depth belong to the same row. Generous enough
// for a hand-drawn plan where a row isn't perfectly aligned, tight enough
// that two genuine rows don't merge.
const DEFAULT_ROW_TOLERANCE_FACTOR = 0.75;
const MIN_ROW_TOLERANCE = 2;

type Projected = NumberableShape & { depth: number; lateral: number };

function centerOf(s: NumberableShape): { cx: number; cy: number } {
  return { cx: s.x_pct + s.width_pct / 2, cy: s.y_pct + s.height_pct / 2 };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Numbers every unlocked table 1..N in layout order.
 *
 * `shapes` is the full shape list — stages included, since the stage defines
 * the orientation. Non-table kinds are filtered out and never numbered.
 */
export function autoNumberTables(
  shapes: readonly NumberableShape[],
  opts: AutoNumberOptions = {},
): AutoNumberResult {
  const {
    respectLocked = true,
    fillBlanksOnly = false,
    startAt = 1,
  } = opts;

  const tables = shapes.filter((s) => isTableKind(s.kind));
  if (tables.length === 0) {
    return { changes: new Map(), skipped: [], rows: 0, numbered: 0 };
  }

  // -------------------------------------------------------------------------
  // 1. Orientation. First stage shape wins, mirroring auto-place's .limit(1).
  // -------------------------------------------------------------------------
  const stage = shapes.find((s) => s.kind === "stage") ?? null;
  const stageCenter = stage ? centerOf(stage) : null;
  // A stage wider than tall (the 39×9 default) faces the room front-to-back,
  // so depth runs along y. A tall narrow stage is a side stage — depth runs
  // along x. With no stage at all, fall back to y ascending, which is
  // precisely auto-place's documented no-stage behaviour.
  const sideStage =
    stage != null && stage.height_pct > stage.width_pct;

  const projected: Projected[] = tables.map((t) => {
    const { cx, cy } = centerOf(t);
    if (stageCenter) {
      return sideStage
        ? { ...t, depth: Math.abs(cx - stageCenter.cx), lateral: cy }
        : { ...t, depth: Math.abs(cy - stageCenter.cy), lateral: cx };
    }
    return { ...t, depth: cy, lateral: cx };
  });

  // -------------------------------------------------------------------------
  // 2. Band by depth into rows.
  // -------------------------------------------------------------------------
  const tolerance =
    opts.rowTolerance ??
    Math.max(
      MIN_ROW_TOLERANCE,
      DEFAULT_ROW_TOLERANCE_FACTOR *
        median(tables.map((t) => Math.max(t.width_pct, t.height_pct))),
    );

  const byDepth = [...projected].sort(
    (a, b) => a.depth - b.depth || a.lateral - b.lateral || (a.id < b.id ? -1 : 1),
  );

  const bands: Projected[][] = [];
  let current: Projected[] = [];
  // Compare each table against the running MEAN of the open band, not against
  // its first element. A gently arced row (common on a hand-drawn plan) would
  // otherwise chain-drift: each table is within tolerance of the previous one,
  // so the whole canvas collapses into a single band.
  let bandSum = 0;
  for (const t of byDepth) {
    if (current.length === 0) {
      current.push(t);
      bandSum = t.depth;
      continue;
    }
    const bandMean = bandSum / current.length;
    if (t.depth - bandMean > tolerance) {
      bands.push(current);
      current = [t];
      bandSum = t.depth;
    } else {
      current.push(t);
      bandSum += t.depth;
    }
  }
  if (current.length > 0) bands.push(current);

  // -------------------------------------------------------------------------
  // 3. Order within each band, then hand out numbers continuously.
  //
  // Numbering never resets per row — table numbers are unique per event
  // (partial unique index from migration 049), so a reset is impossible. No
  // serpentine either: staff read every row left-to-right, and so does the
  // printed plan and the PPTX.
  // -------------------------------------------------------------------------
  const ordered: Projected[] = [];
  let rows = 0;
  for (const band of bands) {
    if (band.length === 0) continue;
    rows += 1;
    ordered.push(
      ...[...band].sort(
        (a, b) =>
          a.lateral - b.lateral || a.depth - b.depth || (a.id < b.id ? -1 : 1),
      ),
    );
  }

  // Numbers we must not hand out: those held by tables we won't rewrite.
  const reserved = new Set<number>();
  const skipped: string[] = [];
  for (const t of ordered) {
    const frozen =
      (respectLocked && t.locked) || (fillBlanksOnly && t.table_no != null);
    if (!frozen) continue;
    if (respectLocked && t.locked) skipped.push(t.id);
    if (t.table_no != null) reserved.add(t.table_no);
  }

  const changes = new Map<string, number>();
  let next = Math.max(1, Math.trunc(startAt));
  let numbered = 0;

  for (const t of ordered) {
    const frozen =
      (respectLocked && t.locked) || (fillBlanksOnly && t.table_no != null);
    if (frozen) {
      if (t.table_no != null) numbered += 1;
      continue;
    }
    while (reserved.has(next)) next += 1;
    // Only emit real changes — keeps the debounced POST payload small and the
    // floor_plan.table_numbered audit trail meaningful.
    if (t.table_no !== next) changes.set(t.id, next);
    reserved.add(next);
    numbered += 1;
    next += 1;
  }

  return { changes, skipped, rows, numbered };
}

/**
 * Lowest positive number not already taken by a table.
 *
 * Used when spawning a table and when accepting a vision candidate whose
 * printed number collides. Fills holes rather than jumping to max+1, so
 * replacing a deleted table reuses its number.
 */
export function nextFreeTableNo(shapes: readonly NumberableShape[]): number {
  const taken = new Set<number>();
  for (const s of shapes) {
    if (isTableKind(s.kind) && s.table_no != null) taken.add(s.table_no);
  }
  let n = 1;
  while (taken.has(n)) n += 1;
  return n;
}
