// Physical layout of the 名牌 sheet. Pure numbers in millimetres, shared by the
// on-screen preview and the PDF renderer so the two can never drift.
//
// Sheet: A4 landscape (297 × 210). Badges: 54 wide × 85 tall (portrait),
// 5 columns × 2 rows, butted edge to edge so one cut serves two badges.
// The 270 × 170 block is centred on the page, leaving 13.5 mm side and 20 mm
// top/bottom margins for crop marks and the calibration bar.

export const PAGE_W = 297;
export const PAGE_H = 210;
export const BADGE_W = 54;
export const BADGE_H = 85;
export const COLS = 5;
export const ROWS = 2;
export const PER_PAGE = COLS * ROWS;

export const GRID_X0 = (PAGE_W - COLS * BADGE_W) / 2; // 13.5
export const GRID_Y0 = (PAGE_H - ROWS * BADGE_H) / 2; // 20

/** Width the name may occupy before it shrinks (4 mm side padding). */
export const NAME_MAX_W = BADGE_W - 8;
/** Name cap height bounds, mm. Large like the sample; shrinks for long names. */
export const NAME_MAX_H = 11;
export const NAME_MIN_H = 5;

/** Top-left corner of slot `i` (0-based, row-major) on its page. */
export function slotOrigin(i: number): { x: number; y: number } {
  const s = i % PER_PAGE;
  const col = s % COLS;
  const row = Math.floor(s / COLS);
  return { x: GRID_X0 + col * BADGE_W, y: GRID_Y0 + row * BADGE_H };
}

/** QR placement inside a badge, mm relative to the badge's top-left. */
export function qrBox(settings: { qr_top_pct: number; qr_size_mm: number }) {
  const size = settings.qr_size_mm;
  const x = (BADGE_W - size) / 2;
  // Clamp so a big QR pushed low can't run off the badge.
  const y = Math.min((settings.qr_top_pct / 100) * BADGE_H, BADGE_H - size - 2);
  return { x, y, size };
}

/** Name centre line, mm from the badge top. */
export function nameCenterY(settings: { name_center_pct: number }) {
  return (settings.name_center_pct / 100) * BADGE_H;
}
