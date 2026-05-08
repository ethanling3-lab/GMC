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

export type ProgrammeTier =
  | "abundance"
  | "glorious_family"
  | "elite_cultural_heritage"
  | "glorious_cultural_heritage";

// Single-character bilingual abbrev shown next to seat names. Maps to the
// four GMC paid-programme tiers (丰盛 / 荣贵 / 精英文化财 / 荣耀文化财).
export const PROGRAMME_ABBREV: Record<ProgrammeTier, string> = {
  abundance: "丰",
  glorious_family: "贵",
  elite_cultural_heritage: "精",
  glorious_cultural_heritage: "耀",
};

export type GroupRosterMember = {
  participant_id: string;
  region_id: string | null;
  name_en: string | null;
  name_cn: string | null;
  role: SeatRole;
  programme_tier: ProgrammeTier | null;
  is_old_student: boolean;
};

export type GroupRoster = {
  id: string;
  group_no: number;
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
): { x: number; y: number; width: number; height: number } {
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

// Viewport extents (user-space units inside the SVG viewBox).
// Pass 3 bump trail: 100×60 → 150×90 → 200×120 → 300×180. Aspect 5:3
// preserved end-to-end. The printable page is 300×180 user-space units
// — wide enough for ~80 round tables (12u each + spacing) before things
// get cramped. Spawn defaults (12u round table etc.) stay the same so
// existing shapes don't suddenly look mis-sized.
export const VB_W = 300;
export const VB_H = 180;

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

// Off-page margin. The 200×120 page is the printable area; the editor lets
// admins drag shapes one page-width / -height beyond the boundaries on
// every side as scratch space. Anything beyond this hard cap is clamped
// (prevents accidental drags that send a shape into oblivion).
const OFF_PAGE_MARGIN_X = VB_W;
const OFF_PAGE_MARGIN_Y = VB_H;

export const X_MIN = -OFF_PAGE_MARGIN_X;
export const X_MAX = VB_W + OFF_PAGE_MARGIN_X; // 400
export const Y_MIN = -OFF_PAGE_MARGIN_Y;
export const Y_MAX = VB_H + OFF_PAGE_MARGIN_Y; // 240

export function clampShape(s: Shape): Shape {
  const w = Math.max(0.5, Math.min(VB_W, s.width_pct));
  const h = Math.max(0.5, Math.min(VB_H, s.height_pct));
  const x = Math.max(X_MIN, Math.min(X_MAX - w, s.x_pct));
  const y = Math.max(Y_MIN, Math.min(Y_MAX - h, s.y_pct));
  return { ...s, x_pct: x, y_pct: y, width_pct: w, height_pct: h };
}
