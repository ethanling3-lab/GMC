// The single source of truth for the number a group displays.
//
// Pure — no runtime imports, no `server-only`, no "use client". This is
// imported by RSC pages, server loaders, client components, AND both
// browser-side pptx renderers (src/lib/floor-plan/export-pptx.ts and
// src/lib/profile-deck/export-pptx.ts are "use client" — pptxgenjs runs in
// the browser). Keep it dependency-free so none of those chains break.
//
// WHY THIS EXISTS
//
// A group carries two numbers:
//   group_no  — event_groups.group_no. The INTERNAL key, handed out 1..k by
//               the grouping algorithm walking class order, so it encodes
//               when the group was formed. Pins (enrollments.pinned_group_no),
//               the XLSX importer, and all 14 member-move actions resolve by
//               it. It is never renumbered.
//   table_no  — event_floor_plan_shapes.table_no of the table the group is
//               PAIRED to. The physical number staff and attendees read.
//
// Display always prefers table_no, because "which table do I walk to" is the
// question every downstream surface is really answering. But the UNIT stays
// Group / 组 — a group seated at table 7 reads "Group 7 · 第 7 组", not
// "Table 7". The word "table" survives in display copy only via
// tableFurnitureLabel() below, which describes the furniture itself.
//
// Before this helper existed, `Group ${group_no}` / `组 ${group_no}` was
// hand-rolled in ~15 places with two different Chinese formats. Everything
// goes through here now.

export type GroupNumberStyle =
  // Admin surfaces: "组 7" — terse, sits next to other chips.
  | "admin"
  // Participant portal: "第 7 组" — the natural spoken form.
  | "portal";

export type GroupNumberInput = {
  group_no: number | null;
  table_no: number | null;
};

export type GroupNumberLabel = {
  /** table_no ?? group_no. Null only when both inputs are null. */
  no: number | null;
  /**
   * True when table_no drove the number — i.e. the group is seated. Callers
   * MUST use this to disambiguate: placed and unplaced groups draw from two
   * different number spaces, so a group at table 7 and an unplaced group_no 7
   * both render "7". Unplaced numbers need a visual marker (see GroupsClient).
   */
  placed: boolean;
  /** "Group 7" — empty string when there is no number at all. */
  en: string;
  /** admin: "组 7" · portal: "第 7 组" — empty string when no number. */
  cn: string;
  /** "Group 7 · 组 7" */
  bilingual: string;
  /** "GROUP 7 · 组 7" — the letterspaced eyebrow form. */
  eyebrow: string;
  /** "#7" — tight chip for dense grids. */
  short: string;
};

const EMPTY: GroupNumberLabel = {
  no: null,
  placed: false,
  en: "",
  cn: "",
  bilingual: "",
  eyebrow: "",
  short: "",
};

/**
 * Resolves the number a group displays, in every format the app needs.
 *
 * Both numbers null returns all-empty strings with `no: null` — that covers
 * the synthetic `__ungrouped` row in check-in-query and any unassigned
 * bucket. Callers keep their own "Ungrouped · 未分组" copy for that case
 * rather than having it baked in here, since the wording differs per surface.
 */
export function groupNumber(
  input: GroupNumberInput,
  style: GroupNumberStyle = "admin",
): GroupNumberLabel {
  const placed = input.table_no != null;
  const no = input.table_no ?? input.group_no;
  if (no == null) return EMPTY;

  const en = `Group ${no}`;
  const cn = style === "portal" ? `第 ${no} 组` : `组 ${no}`;
  return {
    no,
    placed,
    en,
    cn,
    bilingual: `${en} · ${cn}`,
    eyebrow: `GROUP ${no} · 组 ${no}`,
    short: `#${no}`,
  };
}

export type TableFurnitureLabel = {
  /** "Table 7" */
  en: string;
  /** "桌 7" */
  cn: string;
  /** "TABLE 7 · 桌 7" */
  eyebrow: string;
};

/**
 * The furniture's own identity — the ONLY place the word "table" appears in
 * display copy. Two callers:
 *   - an empty numbered table on the canvas, so staff can identify tables
 *     before any group is assigned to them;
 *   - the inspector's "Table # · 桌号" field.
 *
 * Returns null for an unnumbered table so callers can fall through to their
 * existing kind-based label ("Round · 12 座").
 */
export function tableFurnitureLabel(
  table_no: number | null,
): TableFurnitureLabel | null {
  if (table_no == null) return null;
  return {
    en: `Table ${table_no}`,
    cn: `桌 ${table_no}`,
    eyebrow: `TABLE ${table_no} · 桌 ${table_no}`,
  };
}

/**
 * First 1-3 digit run in a printed table label, or null.
 *
 * Vision auto-detect reads the printed number off an uploaded floor plan into
 * `label_en` ("12", "Table 12", "12A"); acceptCandidate promotes it into the
 * structured `table_no`. Mirrors the regexp the 049 migration backfill uses,
 * so a label backfilled server-side and one accepted client-side agree.
 */
export function parseTableNo(
  label: string | null | undefined,
): number | null {
  if (!label) return null;
  const m = /(\d{1,3})/.exec(label);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  if (!Number.isFinite(n) || n < 1 || n > 999) return null;
  return n;
}
