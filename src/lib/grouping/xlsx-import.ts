import "server-only";

import * as XLSX from "xlsx";
import {
  GROUP_CLASS_LABEL,
  type GroupClass,
  type GroupMemberRole,
} from "./types";

// Parser for the grouping round-trip spreadsheet. The admin exports the
// grouping (see groups/export/route.ts), edits it in Google Sheets / Excel,
// downloads it back as .xlsx or .csv, and re-uploads. SheetJS reads both
// formats from a single Buffer.
//
// The export writes these columns (only the first six are read on import;
// the rest are display-only and ignored):
//   Participant ID (do not edit)  — immutable match key (uuid)
//   Group #                       — desired group number (integer)
//   Group Name EN / Group Name CN — optional per-group display name
//   Class                         — "特级组 · Strategic" (parsed leniently)
//   Role                          — "组长 · Leader" (parsed leniently)
//   Region ID                     — human fallback key when the uuid is blank
//
// Header matching is lenient (case-insensitive, tolerant of the admin
// tweaking labels) so a hand-rebuilt sheet still imports.

export type ParsedGroupingRow = {
  rowIndex: number; // 0-based index within the data rows (for error messages)
  participant_id: string | null;
  region_id: string | null;
  group_no: number | null;
  role_key: GroupMemberRole;
  class_key: GroupClass | null;
  group_name_en: string | null;
  group_name_cn: string | null;
  raw_row: Record<string, unknown>;
};

export type ParsedGroupingSheet = {
  rows: ParsedGroupingRow[];
  // Which canonical fields we located in the header row. `preview` uses this
  // to reject a file that's missing the key/group columns entirely.
  headerMap: {
    participant_id: string | null;
    region_id: string | null;
    group_no: string | null;
    role: string | null;
    class: string | null;
    group_name_en: string | null;
    group_name_cn: string | null;
  };
  totalDataRows: number;
  droppedRows: number;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Field detection. Order matters where headers share a prefix — group-name
// columns are tested before the bare group-number column so "Group Name EN"
// never falls through to `group_no`.
function classifyHeader(h: string): keyof ParsedGroupingSheet["headerMap"] | null {
  const s = h.trim();
  // "Table #" is EXPORT-ONLY. Table numbers live on event_floor_plan_shapes and
  // are never written from a spreadsheet — honouring them would mean mutating
  // floor-plan geometry from a sheet, and two rows claiming Table 5 would need
  // conflict-resolution UI that doesn't exist. Rejected up front so it can
  // never fall through to `group_no` if that regex is ever loosened.
  if (/^table\s*(#|no\.?|number)?\s*$/i.test(s) || /桌\s*(号|#|编号)/.test(s)) {
    return null;
  }
  if (/participant\s*id/i.test(s) || /参与者\s*id|学员\s*id/i.test(s)) {
    return "participant_id";
  }
  if (/group\s*name/i.test(s) && /(en|eng|english|英)/i.test(s)) {
    return "group_name_en";
  }
  if (/group\s*name/i.test(s) && /(cn|chi|chinese|中)/i.test(s)) {
    return "group_name_cn";
  }
  if (/组\s*名/i.test(s) && /(en|英)/i.test(s)) return "group_name_en";
  if (/组\s*名/i.test(s) && /(cn|中)/i.test(s)) return "group_name_cn";
  if (/^group\s*(#|no\.?|number)?\s*$/i.test(s) || /组\s*(号|#|编号)/i.test(s)) {
    return "group_no";
  }
  if (/^class$/i.test(s) || /组\s*别|级别|类别/i.test(s)) return "class";
  if (/^role$/i.test(s) || /角色|职务/i.test(s)) return "role";
  if (
    /region\s*id/i.test(s) ||
    /student\s*id/i.test(s) ||
    /学员编号|学号|区域编号/i.test(s)
  ) {
    return "region_id";
  }
  return null;
}

// Locate the header row by scanning the first few rows for our known columns.
function detectHeaderRow(matrix: unknown[][]): number {
  const SCAN = Math.min(matrix.length, 10);
  for (let i = 0; i < SCAN; i++) {
    const cells = (matrix[i] ?? []).map((c) => String(c ?? "").trim());
    if (cells.length < 2) continue;
    const hits = cells.filter((c) => classifyHeader(c) != null);
    if (hits.length >= 2) return i;
  }
  return 0;
}

function toText(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function normalizeGroupNo(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.trunc(v) : null;
  const digits = String(v).replace(/[^\d]/g, "");
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

// Role text → enum. Chinese labels are authoritative; the export writes
// "组长 · Leader" etc. A blank / unrecognized cell means a plain participant.
function normalizeRole(v: unknown): GroupMemberRole {
  const s = String(v ?? "").trim();
  if (!s) return "participant";
  if (s.includes("副组长") || s.includes("副組長")) return "fu_zu_zhang";
  if (s.includes("组长") || s.includes("組長")) return "zu_zhang";
  if (s.includes("排长") || s.includes("排長")) return "pai_zhang";
  if (/\baux/i.test(s) || /auxiliary/i.test(s)) return "fu_zu_zhang";
  if (/\bleader\b/i.test(s)) return "zu_zhang";
  if (/\brow\b/i.test(s)) return "pai_zhang";
  return "participant";
}

// Class text → enum. The export writes "特级组 · Strategic"; match against the
// CN name, short CN, or EN name of any GroupClass. Unrecognized → null (the
// caller defaults new groups to `growth` with a warning).
function normalizeClass(v: unknown): GroupClass | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  for (const key of Object.keys(GROUP_CLASS_LABEL) as GroupClass[]) {
    const label = GROUP_CLASS_LABEL[key];
    if (
      s.includes(label.cn) ||
      s.includes(label.short_cn) ||
      lower.includes(label.en.toLowerCase())
    ) {
      return key;
    }
  }
  return null;
}

export function parseGroupingWorkbook(
  buffer: ArrayBuffer | Buffer,
): ParsedGroupingSheet {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
  // Prefer the "Groups" sheet the export writes; fall back to the first sheet
  // (a CSV download has a single unnamed sheet).
  const sheetName =
    wb.SheetNames.find((n) => /group/i.test(n)) ?? wb.SheetNames[0];
  const emptyMap: ParsedGroupingSheet["headerMap"] = {
    participant_id: null,
    region_id: null,
    group_no: null,
    role: null,
    class: null,
    group_name_en: null,
    group_name_cn: null,
  };
  if (!sheetName) {
    return { rows: [], headerMap: emptyMap, totalDataRows: 0, droppedRows: 0 };
  }

  const sheet = wb.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
  });

  const headerIdx = detectHeaderRow(matrix);
  const headers = (matrix[headerIdx] ?? []).map((h) => String(h ?? "").trim());
  const dataRows = matrix.slice(headerIdx + 1);

  // Map canonical field → column index (first matching header wins).
  const map = { ...emptyMap };
  const colOf: Partial<Record<keyof typeof map, number>> = {};
  headers.forEach((h, j) => {
    if (!h) return;
    const field = classifyHeader(h);
    if (field && map[field] == null) {
      map[field] = h;
      colOf[field] = j;
    }
  });

  const cell = (row: unknown[], field: keyof typeof map): unknown => {
    const j = colOf[field];
    return j == null ? null : row[j];
  };

  const rows: ParsedGroupingRow[] = [];
  let dropped = 0;

  dataRows.forEach((row, i) => {
    const anyValue = row.some((c) => c != null && String(c).trim() !== "");
    if (!anyValue) {
      dropped++;
      return;
    }

    const rawRow: Record<string, unknown> = {};
    headers.forEach((h, j) => {
      if (h) rawRow[h] = row[j] ?? null;
    });

    const pidRaw = toText(cell(row, "participant_id"));
    const participant_id = pidRaw && UUID_RE.test(pidRaw) ? pidRaw : null;

    rows.push({
      rowIndex: i,
      participant_id,
      region_id: toText(cell(row, "region_id")),
      group_no: normalizeGroupNo(cell(row, "group_no")),
      role_key: normalizeRole(cell(row, "role")),
      class_key: normalizeClass(cell(row, "class")),
      group_name_en: toText(cell(row, "group_name_en")),
      group_name_cn: toText(cell(row, "group_name_cn")),
      raw_row: rawRow,
    });
  });

  return {
    rows,
    headerMap: map,
    totalDataRows: rows.length,
    droppedRows: dropped,
  };
}
