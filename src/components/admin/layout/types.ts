// Floor plan editor — shared types between page (server) and editor (client).
// Pure types — must not import server-only modules.

export type ShapeKind =
  | "round_table"
  | "square_table"
  | "cushion"
  | "stage"
  | "podium"
  | "text_label"
  | "door"
  | "wall";

export type SquareSeats = {
  top: number;
  right: number;
  bottom: number;
  head: number;
};

// Coordinate system: viewBox "0 0 100 60". X in [0,100], Y in [0,60].
// Width and height are in the same isotropic user-space units (so a circle
// rendered as `<circle r=4>` is a true circle on screen regardless of aspect).
// Field names keep the *_pct suffix to match the DB schema (migration 021)
// where they were originally specced as percentages.
export type Shape = {
  id: string;
  kind: ShapeKind;
  x_pct: number;
  y_pct: number;
  width_pct: number;
  height_pct: number;
  rotation_deg: number;
  seat_count: number | null;
  seats_per_side: SquareSeats | null;
  // Physical table number — unique per event, null for non-table kinds.
  // Independent of the paired group's group_no: this is the number every
  // downstream surface displays. Set by Auto-number or by hand in the
  // inspector. See src/lib/group-number.ts.
  table_no: number | null;
  // Per-table multiplier for SEAT-NAME label font size. Null = inherit the
  // event default (events.floor_plan_name_scale). The centre numeral is not
  // affected — it stays auto-sized to the table so tables read consistently.
  name_scale: number | null;
  label_en: string | null;
  label_cn: string | null;
  group_id: string | null;
  locked: boolean;
  z_order: number;
};

export type EventLite = {
  id: string;
  slug: string;
  title_en: string | null;
  title_cn: string | null;
  seating_mode: "tables" | "cushions";
  group_size_min: number;
  group_size_max: number;
  // Printable page size in MILLIMETRES (migration 051). Defaults to the legacy
  // 300×180 so existing plans are unchanged; presets write true paper sizes.
  floor_plan_page_w: number;
  floor_plan_page_h: number;
  floor_plan_page_preset: string | null;
  // Event-wide seat-name font multiplier; per-table overrides live on Shape.
  floor_plan_name_scale: number;
};

// Group rosters loaded for the seating-chart render. The order of `members`
// is the seat order: zu_zhang first, then fu_zu_zhang, then participants,
// then pai_zhang. Each member's `role_label` is the bilingual chip we
// surface at the seat (组长 / 副组长 / 排长 / —).
export type SeatRole =
  | "zu_zhang"
  | "fu_zu_zhang"
  | "pai_zhang"
  | "participant";

export type GroupClassKey =
  | "strategic"
  | "key"
  | "growth"
  | "maintenance";

// Programme membership is now resolved dynamically from the `programmes`
// table (slug + abbrev + bilingual name), joined at load time. The single-
// character abbrev (e.g. 丰 / 贵 / 精 / 耀) rides on the member below.

export type StudentQualificationKey =
  | "basic"
  | "rising"
  | "elite"
  | "excellence"
  | "strategic";

export type UpgradePotentialKey = "low" | "medium" | "high";

export type GroupRosterMember = {
  participant_id: string;
  region_id: string | null;
  name_en: string | null;
  name_cn: string | null;
  role: SeatRole;
  // Resolved from the participant's programmes join at load time.
  programme_slug: string | null;
  programme_abbrev: string | null;
  programme_name_cn: string | null;
  is_old_student: boolean;
  // M6.6 chip-cluster signals (added 2026-05-09): drive the seat-name
  // chip row — gender (男/女), priority (战/卓 for excellence+), and
  // 高潜能 (潜) for sales attention. Loader can leave any null.
  gender: string | null;
  student_qualification: StudentQualificationKey | null;
  upgrade_potential: UpgradePotentialKey | null;
};

export type GroupRoster = {
  id: string;
  group_no: number;
  // Table number of the shape this group is paired to, or null when it isn't
  // seated yet. Denormalized at load time by inverting shapes.group_id —
  // the pptx exporters are client-side ("use client") and cannot query, so
  // the number has to physically ride on the roster.
  table_no: number | null;
  group_class: GroupClassKey | null;
  name_en: string | null;
  name_cn: string | null;
  members: GroupRosterMember[];
};

// Vision-detected table candidate — produced by /floor-plan-asset/auto-detect
// (Opus 4.7 vision). Server returns normalized image-relative coords; client
// converts to user-space via mapDetectedCandidate() below using the image's
// natural dimensions to undo the xMidYMid meet letterbox.
export type DetectedCandidate = {
  // Stable client-side id so React key + accept/reject can target one of N.
  id: string;
  kind: "round_table" | "square_table";
  // Normalized image-relative coords (0..1 of natural image dimensions).
  x_norm: number;
  y_norm: number;
  width_norm: number;
  height_norm: number;
  label: string | null;
  seat_count: number | null;
  confidence: "high" | "medium" | "low" | null;
};

// Map a detected candidate's normalized image-relative coords into the
// canvas's user-space (0..VB_W, 0..VB_H), undoing the xMidYMid meet
// letterbox the SVG <image> applies. If natural dimensions are unknown
// (image not yet loaded), assumes the image fills the page exactly.
export function mapDetectedCandidate(
  c: DetectedCandidate,
  natural: { w: number; h: number } | null,
  page: PageSize = DEFAULT_PAGE,
): { x: number; y: number; width: number; height: number } {
  const VB_W = page.w;
  const VB_H = page.h;
  const x = clampUnit(c.x_norm);
  const y = clampUnit(c.y_norm);
  const w = clampUnit(c.width_norm);
  const h = clampUnit(c.height_norm);
  if (!natural || natural.w <= 0 || natural.h <= 0) {
    return {
      x: x * VB_W,
      y: y * VB_H,
      width: w * VB_W,
      height: h * VB_H,
    };
  }
  const imageAspect = natural.w / natural.h;
  const pageAspect = VB_W / VB_H;
  let renderW: number;
  let renderH: number;
  let xOff: number;
  let yOff: number;
  if (imageAspect >= pageAspect) {
    // Image is wider than the page — fills width, letterbox top/bottom.
    renderW = VB_W;
    renderH = VB_W / imageAspect;
    xOff = 0;
    yOff = (VB_H - renderH) / 2;
  } else {
    // Image is narrower than the page — fills height, letterbox sides.
    renderH = VB_H;
    renderW = VB_H * imageAspect;
    xOff = (VB_W - renderW) / 2;
    yOff = 0;
  }
  return {
    x: xOff + x * renderW,
    y: yOff + y * renderH,
    width: w * renderW,
    height: h * renderH,
  };
}

function clampUnit(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

// Background-image asset rendered under the shapes layer in the editor.
// Stored in the private `event-floor-plans` bucket; `url` is a fresh signed
// URL produced by the layout page loader (1h TTL). Width/height are kept
// for future use (vision auto-detect needs the natural dimensions); for
// rendering we just stretch the image to fit the page bounding box.
export type FloorPlanAsset = {
  id: string;
  storage_path: string;
  opacity: number;
  width_px: number | null;
  height_px: number | null;
  original_filename: string | null;
  url: string;
};

export type LayoutEditorProps = {
  event: EventLite;
  initialShapes: Shape[];
  groups: GroupRoster[];
  canEdit: boolean;
  initialAsset: FloorPlanAsset | null;
};

// DEFAULT viewport extents. As of migration 051 the printable page size is
// per-event (events.floor_plan_page_w/h, in millimetres) — these are the
// fallback for events that never set one, and they preserve the historical
// 300×180 canvas exactly so existing plans render unchanged.
//
// Pass 3 bump trail: 100×60 → 150×90 → 200×120 → 300×180. 300×180 fits ~80
// round tables (12u each + spacing) before things get cramped. Spawn defaults
// (12u round table etc.) are in the same units, so a bigger page means more
// room rather than bigger furniture.
//
// Prefer reading the page from `EventLite.floor_plan_page_w/h`. These consts
// remain for defaults and for code that genuinely has no event in scope.
export const VB_W = 300;
export const VB_H = 180;

export type PageSize = { w: number; h: number };

export const DEFAULT_PAGE: PageSize = { w: VB_W, h: VB_H };

// Real paper sizes in millimetres, which is what the page units now mean.
// Landscape is listed first in each pair because a seating chart is almost
// always wider than tall.
export const PAGE_PRESETS: Array<{
  id: string;
  label: string;
  w: number;
  h: number;
}> = [
  { id: "a4_landscape", label: "A4 ↔", w: 297, h: 210 },
  { id: "a4_portrait", label: "A4 ↕", w: 210, h: 297 },
  { id: "a3_landscape", label: "A3 ↔", w: 420, h: 297 },
  { id: "a3_portrait", label: "A3 ↕", w: 297, h: 420 },
  { id: "a2_landscape", label: "A2 ↔", w: 594, h: 420 },
  { id: "a2_portrait", label: "A2 ↕", w: 420, h: 594 },
  { id: "a1_landscape", label: "A1 ↔", w: 841, h: 594 },
  { id: "a1_portrait", label: "A1 ↕", w: 594, h: 841 },
  // The pre-051 canvas. Kept selectable so an admin who changes their mind can
  // get back to exactly what their existing plan was laid out against.
  { id: "legacy", label: "Legacy 300×180", w: VB_W, h: VB_H },
];

export function presetById(id: string | null): { w: number; h: number } | null {
  if (!id) return null;
  return PAGE_PRESETS.find((p) => p.id === id) ?? null;
}

/** Matches a w/h back to a preset id, or null when it's a custom size. */
export function presetIdFor(w: number, h: number): string | null {
  return PAGE_PRESETS.find((p) => p.w === w && p.h === h)?.id ?? null;
}

// Spawn defaults per shape kind. Sizes match the M6.4 plan: round table 8%
// diameter, square table 10×6, cushion 3% diameter, etc. New shapes spawn
// near canvas center with a small random offset so successive spawns don't
// stack on the exact same point.
export function defaultsForKind(kind: ShapeKind): {
  width_pct: number;
  height_pct: number;
  seat_count: number | null;
  seats_per_side: SquareSeats | null;
  label_en: string | null;
  label_cn: string | null;
} {
  switch (kind) {
    case "round_table":
      return {
        width_pct: 12,
        height_pct: 12,
        seat_count: 10,
        seats_per_side: null,
        label_en: null,
        label_cn: null,
      };
    case "square_table":
      return {
        width_pct: 15,
        height_pct: 9,
        seat_count: 10,
        seats_per_side: { top: 3, right: 3, bottom: 3, head: 1 },
        label_en: null,
        label_cn: null,
      };
    case "cushion":
      return {
        width_pct: 4.5,
        height_pct: 4.5,
        seat_count: 1,
        seats_per_side: null,
        label_en: null,
        label_cn: null,
      };
    case "stage":
      return {
        width_pct: 39,
        height_pct: 9,
        seat_count: null,
        seats_per_side: null,
        label_en: "Stage",
        label_cn: "舞台",
      };
    case "podium":
      return {
        width_pct: 12,
        height_pct: 6,
        seat_count: null,
        seats_per_side: null,
        label_en: "Podium",
        label_cn: "讲台",
      };
    case "text_label":
      return {
        width_pct: 21,
        height_pct: 6,
        seat_count: null,
        seats_per_side: null,
        label_en: "Label",
        label_cn: "标签",
      };
    case "door":
      return {
        width_pct: 9,
        height_pct: 1.8,
        seat_count: null,
        seats_per_side: null,
        label_en: null,
        label_cn: null,
      };
    case "wall":
      return {
        width_pct: 30,
        height_pct: 1.2,
        seat_count: null,
        seats_per_side: null,
        label_en: null,
        label_cn: null,
      };
  }
}

export const SHAPE_LABEL_EN: Record<ShapeKind, string> = {
  round_table: "Round table",
  square_table: "Square table",
  cushion: "Cushion",
  stage: "Stage",
  podium: "Podium",
  text_label: "Text",
  door: "Door",
  wall: "Wall",
};

export const SHAPE_LABEL_CN: Record<ShapeKind, string> = {
  round_table: "圆桌",
  square_table: "方桌",
  cushion: "蒲团",
  stage: "舞台",
  podium: "讲台",
  text_label: "文字",
  door: "门",
  wall: "墙",
};

export function paletteForMode(mode: "tables" | "cushions"): ShapeKind[] {
  if (mode === "tables") {
    return [
      "round_table",
      "square_table",
      "stage",
      "podium",
      "text_label",
      "door",
      "wall",
    ];
  }
  return ["cushion", "stage", "podium", "text_label", "door", "wall"];
}

export function isSeatedKind(kind: ShapeKind): boolean {
  return kind === "round_table" || kind === "square_table" || kind === "cushion";
}

// Kinds that carry a `table_no`. Distinct from isSeatedKind, which also
// includes `cushion` — cushions are seats, not tables, and cushion-mode
// events have no table numbers at all. Mirrors the DB CHECK constraint
// event_floor_plan_shapes_table_no_kind_ck (migration 049).
export function isTableKind(kind: ShapeKind): boolean {
  return kind === "round_table" || kind === "square_table";
}

// Off-page margin. The 200×120 page is the printable area; the editor lets
// admins drag shapes one page-width / -height beyond the boundaries on
// every side as scratch space. Anything beyond this hard cap is clamped
// (prevents accidental drags that send a shape into oblivion).
// Off-page scratch margin: one page-width / -height beyond every edge. Now
// derived from the ACTUAL page rather than the 300×180 default, so a bigger
// page gets proportionally more scratch space.
export function clampBounds(page: PageSize = DEFAULT_PAGE): {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
} {
  return {
    xMin: -page.w,
    xMax: page.w * 2,
    yMin: -page.h,
    yMax: page.h * 2,
  };
}

// Legacy exports — the 300×180 bounds. Still referenced by the shapes API
// route's Zod schema, which validates against the widest page any event could
// use rather than per-request (see the comment there).
export const X_MIN = -VB_W;
export const X_MAX = VB_W * 2;
export const Y_MIN = -VB_H;
export const Y_MAX = VB_H * 2;

export function clampShape(s: Shape, page: PageSize = DEFAULT_PAGE): Shape {
  const b = clampBounds(page);
  const w = Math.max(0.5, Math.min(page.w, s.width_pct));
  const h = Math.max(0.5, Math.min(page.h, s.height_pct));
  const x = Math.max(b.xMin, Math.min(b.xMax - w, s.x_pct));
  const y = Math.max(b.yMin, Math.min(b.yMax - h, s.y_pct));
  return { ...s, x_pct: x, y_pct: y, width_pct: w, height_pct: h };
}
