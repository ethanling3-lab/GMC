import "server-only";

import * as XLSX from "xlsx";

// Bank-CSV parser. Banks don't agree on column headers, so this is a lenient
// heuristic mapper that walks the first sheet / first line to spot common
// names for: transaction date, amount, counterparty name, reference.
//
// Supported shapes (tested mentally against DBS, OCBC, Maybank, CIMB, HSBC):
//   - CSV or XLSX (XLSX lib handles both)
//   - Header row may be 1-5 rows into the file (bank statements often have
//     account metadata banners at the top)
//   - Amount may be signed, a single column, or split into debit/credit
//
// Unmapped rows come back with `issues[]` so the UI can surface them as
// "needs manual review" instead of silently dropping.

export type ParsedBankRow = {
  rowIndex: number;                 // 0-based index within detected data rows
  txn_date: string | null;          // ISO YYYY-MM-DD
  amount: number | null;            // positive for inflows (credits to us)
  currency: string | null;
  raw_name: string | null;
  raw_reference: string | null;
  raw_row: Record<string, unknown>; // full original row for audit
  issues: string[];                 // non-empty if the row couldn't be parsed cleanly
};

export type ParsedBankImport = {
  rows: ParsedBankRow[];
  headerMap: {
    date: string | null;
    amount: string | null;
    credit: string | null;
    debit: string | null;
    name: string | null;
    reference: string | null;
    currency: string | null;
  };
  totalRows: number;
  droppedRows: number;
};

// Canonical header patterns. First match wins.
const HEADER_PATTERNS = {
  date: [/^(txn|transaction|value|posting|trans|entry|date)\s*date?$/i, /^date$/i, /日期/],
  amount: [/^amount$/i, /^txn\s*amount$/i, /^transaction\s*amount$/i, /^value$/i, /金额/],
  credit: [/^credit$/i, /^credit\s*amount$/i, /^incoming$/i, /^deposit$/i, /贷方/, /收入/],
  debit: [/^debit$/i, /^debit\s*amount$/i, /^outgoing$/i, /^withdrawal$/i, /借方/, /支出/],
  name: [
    /^(counterparty|payer|from|sender|remitter|description|narration|details|particulars|beneficiary)$/i,
    /^(transaction\s*)?description$/i,
    /对方|付款人|收款人/,
  ],
  reference: [/^(reference|ref|transaction\s*ref|txn\s*ref|payment\s*ref|bank\s*ref|cheque)/i, /参考|附言/],
  currency: [/^(currency|ccy|cur)$/i, /币种/],
} as const;

function matchHeader(h: string, patterns: readonly RegExp[]): boolean {
  const trimmed = h.trim();
  return patterns.some((p) => p.test(trimmed));
}

// Excel serial date → JS Date. Excel's epoch is 1899-12-30 UTC.
function excelSerialToDate(serial: number): Date | null {
  if (!Number.isFinite(serial) || serial < 0 || serial > 2958466) return null;
  const days = Math.floor(serial);
  const ms = Math.round((serial - days) * 86400 * 1000);
  return new Date(Date.UTC(1899, 11, 30) + days * 86400_000 + ms);
}

function normalizeDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === "number") {
    const d = excelSerialToDate(v);
    return d ? d.toISOString().slice(0, 10) : null;
  }
  const s = String(v).trim();
  if (!s) return null;

  // Try ISO first: YYYY-MM-DD or YYYY/MM/DD
  const iso = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) {
    const [_, y, m, d] = iso;
    void _;
    return `${y.padStart(4, "0")}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // DD/MM/YYYY or DD-MM-YYYY (SE-Asian default; prefer DD/MM over MM/DD
  // because every major bank in the target region uses DD/MM).
  const dmy = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (dmy) {
    const [_, d, m, y] = dmy;
    void _;
    const yyyy = y.length === 2 ? (Number(y) >= 70 ? `19${y}` : `20${y}`) : y.padStart(4, "0");
    return `${yyyy}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // Fallback: let JS attempt a parse
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function normalizeAmount(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  // Strip currency symbols, commas, whitespace. Keep decimal separator.
  const s = String(v).replace(/[^\d.\-+()]/g, "").trim();
  if (!s) return null;
  // Parentheses denote negatives on some exports: (123.45) = -123.45
  const neg = /^\(.*\)$/.test(String(v).trim());
  const n = Number(neg ? `-${s.replace(/[()]/g, "")}` : s);
  return Number.isFinite(n) ? n : null;
}

// Walk the first few rows to find the header row. We look for a row that
// contains at least one recognisable header keyword.
function detectHeaderRow(sheet: unknown[][]): number {
  const SCAN = Math.min(sheet.length, 15);
  for (let i = 0; i < SCAN; i++) {
    const row = sheet[i] ?? [];
    const cells = row.map((c) => String(c ?? "").trim());
    if (cells.length < 2) continue;
    const hits = cells.filter((c) => {
      return (
        matchHeader(c, HEADER_PATTERNS.date) ||
        matchHeader(c, HEADER_PATTERNS.amount) ||
        matchHeader(c, HEADER_PATTERNS.credit) ||
        matchHeader(c, HEADER_PATTERNS.debit) ||
        matchHeader(c, HEADER_PATTERNS.name) ||
        matchHeader(c, HEADER_PATTERNS.reference)
      );
    });
    if (hits.length >= 2) return i;
  }
  return 0;
}

export function parseBankFile(buffer: ArrayBuffer | Buffer): ParsedBankImport {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    return {
      rows: [],
      headerMap: emptyHeaderMap(),
      totalRows: 0,
      droppedRows: 0,
    };
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

  // Map canonical fields → column index.
  const map: ParsedBankImport["headerMap"] = emptyHeaderMap();
  headers.forEach((h) => {
    if (!h) return;
    if (!map.date && matchHeader(h, HEADER_PATTERNS.date)) map.date = h;
    else if (!map.amount && matchHeader(h, HEADER_PATTERNS.amount)) map.amount = h;
    else if (!map.credit && matchHeader(h, HEADER_PATTERNS.credit)) map.credit = h;
    else if (!map.debit && matchHeader(h, HEADER_PATTERNS.debit)) map.debit = h;
    else if (!map.name && matchHeader(h, HEADER_PATTERNS.name)) map.name = h;
    else if (!map.reference && matchHeader(h, HEADER_PATTERNS.reference)) map.reference = h;
    else if (!map.currency && matchHeader(h, HEADER_PATTERNS.currency)) map.currency = h;
  });

  const idx = (name: string | null): number => (name ? headers.indexOf(name) : -1);
  const iDate = idx(map.date);
  const iAmount = idx(map.amount);
  const iCredit = idx(map.credit);
  const iDebit = idx(map.debit);
  const iName = idx(map.name);
  const iRef = idx(map.reference);
  const iCur = idx(map.currency);

  const rows: ParsedBankRow[] = [];
  let dropped = 0;

  dataRows.forEach((row, i) => {
    const rawRow: Record<string, unknown> = {};
    headers.forEach((h, j) => {
      if (h) rawRow[h] = row[j] ?? null;
    });

    // Blank row guard — most statements have trailing empties.
    const anyValue = row.some((c) => c != null && String(c).trim() !== "");
    if (!anyValue) {
      dropped++;
      return;
    }

    const issues: string[] = [];
    const txn_date = iDate >= 0 ? normalizeDate(row[iDate]) : null;
    if (!txn_date) issues.push("date_missing");

    let amount: number | null = null;
    if (iAmount >= 0) {
      amount = normalizeAmount(row[iAmount]);
    } else if (iCredit >= 0 || iDebit >= 0) {
      const credit = iCredit >= 0 ? normalizeAmount(row[iCredit]) : null;
      const debit = iDebit >= 0 ? normalizeAmount(row[iDebit]) : null;
      if (credit != null && credit !== 0) amount = Math.abs(credit);
      else if (debit != null && debit !== 0) amount = -Math.abs(debit);
    }
    if (amount == null) issues.push("amount_missing");

    const raw_name = iName >= 0 ? toText(row[iName]) : null;
    const raw_reference = iRef >= 0 ? toText(row[iRef]) : null;
    const currency = iCur >= 0 ? toText(row[iCur]) : null;

    rows.push({
      rowIndex: i,
      txn_date,
      amount,
      currency,
      raw_name,
      raw_reference,
      raw_row: rawRow,
      issues,
    });
  });

  return {
    rows,
    headerMap: map,
    totalRows: rows.length,
    droppedRows: dropped,
  };
}

function emptyHeaderMap(): ParsedBankImport["headerMap"] {
  return {
    date: null,
    amount: null,
    credit: null,
    debit: null,
    name: null,
    reference: null,
    currency: null,
  };
}

function toText(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
