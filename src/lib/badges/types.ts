// Shared shapes for the 名牌 (name badge) generator. Pure — safe to import from
// client components (the loader that fills these lives in ./load, server-only).

export type BadgeSettings = {
  ink_color: string;
  qr_plate: boolean;
  /** Plate mode: the plate colour, and the QR colour drawn on it. */
  plate_fill: string;
  plate_ink: string;
  /** Name centre line, % of badge height from the top. */
  name_center_pct: number;
  /** QR top edge, % of badge height from the top. */
  qr_top_pct: number;
  qr_size_mm: number;
  /** Signed URL (1h) for the uploaded background design, or null. */
  bg_url: string | null;
  bg_original_filename: string | null;
};

export const DEFAULT_BADGE_SETTINGS: BadgeSettings = {
  ink_color: "#FFFFFF",
  qr_plate: false,
  plate_fill: "#FFFFFF",
  plate_ink: "#111111",
  name_center_pct: 40,
  qr_top_pct: 50,
  // Matches the QR in Ethan's sample sheet (~26 mm on a 54 mm badge).
  qr_size_mm: 26,
  bg_url: null,
  bg_original_filename: null,
};

/**
 * new       — never printed
 * changed   — printed, but name / group / seat / QR token differ from the print
 * unchanged — printed and still accurate
 */
export type BadgePrintStatus = "new" | "changed" | "unchanged";

export type BadgeRow = {
  enrollment_id: string;
  participant_id: string;
  /** name_cn, or name_en when there is no Chinese name. */
  name: string;
  region_id: string | null;
  /** Number the group displays (table_no ?? group_no); null = ungrouped. */
  display_no: number | null;
  seat_no: number | null;
  /** Check-in QR token (raw, not the URL — matches /checkin/[token]). */
  token: string;
  status: BadgePrintStatus;
  print_count: number;
};

export type BadgePayload = {
  event: { id: string; slug: string; title: string };
  settings: BadgeSettings;
  rows: BadgeRow[];
  /** Paid enrollments whose QR token could not be minted — left off the PDF. */
  missing_token_count: number;
  /**
   * Extra paid enrollments for someone who already has a badge in this event
   * (enrolled twice). One badge per person — the earliest enrollment wins.
   */
  duplicate_enrollment_count: number;
};

/** What the client reports back after a successful download. */
export type BadgePrintedItem = {
  enrollment_id: string;
  name: string;
  display_no: number | null;
  seat_no: number | null;
  token_prefix: string;
};

export const TOKEN_PREFIX_LEN = 8;
