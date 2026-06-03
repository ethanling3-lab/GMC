import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

// Bank-transaction → enrolment matcher.
//
// Strategy (in order, first hit wins):
//
//   1. Provider-id fast path — the bank reference field frequently contains
//      the HitPay payment_id / payment_request_id we stamped into
//      enrollments.payment_provider_id. A substring match is unambiguous.
//
//   2. Name + amount + date path — for enrollments that are approved (or
//      already paid-but-partial) and within the amount/date window, we score
//      by name similarity. Requires exact amount match (or within 1% for
//      rounding) and date within ±14 days of approved_at/paid_at.
//
// Score interpretation:
//   ≥ 0.85      auto_matched    (pre-confirm in the UI; one-click finalize)
//   0.60–0.84   suggested       (top candidate shown; admin confirms)
//   < 0.60      unmatched       (manual search required)
//
// This lib is pure — no Supabase mutations. The API route calls it then
// writes the match state. That keeps the engine testable in isolation.

export type MatchCandidate = {
  enrollment_id: string;
  event_id: string;
  event_title: string;
  participant_id: string;
  participant_name: string;
  participant_region_id: string | null;
  participant_region: string | null;
  expected_amount: number | null;
  status: string;
  payment_status: string;
  approved_at: string | null;
  paid_at: string | null;
  score: number;
  basis: "provider_id" | "name_amount_date";
  amount_delta: number;
  date_delta_days: number | null;
};

export type BankTxnInput = {
  txn_date: string;           // ISO YYYY-MM-DD
  amount: number;             // signed — negative means outflow (refund)
  raw_name: string | null;
  raw_reference: string | null;
};

export type MatchResult = {
  status: "auto_matched" | "suggested" | "unmatched";
  confidence: number;         // 0..1
  basis: MatchCandidate["basis"] | null;
  matched: MatchCandidate | null;
  suggestions: MatchCandidate[]; // ordered by score desc, up to 5
};

export const AUTO_MATCH_THRESHOLD = 0.85;
export const SUGGEST_THRESHOLD = 0.6;
export const DATE_WINDOW_DAYS = 14;
export const AMOUNT_TOLERANCE_PCT = 0.01;  // 1% slop for FX / rounding

// -----------------------------------------------------------------------------
// Name normalization + similarity
// -----------------------------------------------------------------------------

// Normalize a name for comparison: strip punctuation, collapse whitespace,
// lowercase ASCII, keep CJK characters as-is. This is intentionally lossy —
// we want "Ethan Ling 林" and "ling ethan 林!" to collide.
export function normalizeName(s: string | null): string {
  if (!s) return "";
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u3000\s]+/g, " ")            // fullwidth + ASCII whitespace
    .replace(/[^\p{L}\p{N}\s]/gu, "")        // drop punctuation
    .trim();
}

// Token-set similarity: unordered word overlap with Levenshtein backoff.
// Rationale: bank exports often swap surname/given name order ("Ling Ethan"
// vs "Ethan Ling") and pad with honorifics ("Mr Ethan Ling"). A pure
// Levenshtein would penalise the reorder; a pure token-set would miss
// typos. Take the max.
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const tokenScore = tokenSetSimilarity(na, nb);
  const levScore = levenshteinRatio(na, nb);
  return Math.max(tokenScore, levScore);
}

function tokenSetSimilarity(a: string, b: string): number {
  const setA = new Set(a.split(/\s+/).filter(Boolean));
  const setB = new Set(b.split(/\s+/).filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return 0;
  let hit = 0;
  for (const t of setA) if (setB.has(t)) hit++;
  const union = setA.size + setB.size - hit;
  return union === 0 ? 0 : hit / union;
}

function levenshteinRatio(a: string, b: string): number {
  if (a === b) return 1;
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 0 : 1 - dist / maxLen;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  // Rolling-row DP: O(min(m,n)) space
  if (m > n) [a, b] = [b, a];
  const prev = new Array<number>(a.length + 1);
  const curr = new Array<number>(a.length + 1);
  for (let i = 0; i <= a.length; i++) prev[i] = i;
  for (let j = 1; j <= b.length; j++) {
    curr[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[i] = Math.min(
        curr[i - 1] + 1,
        prev[i] + 1,
        prev[i - 1] + cost,
      );
    }
    for (let i = 0; i <= a.length; i++) prev[i] = curr[i];
  }
  return prev[a.length];
}

// -----------------------------------------------------------------------------
// Matching pipeline
// -----------------------------------------------------------------------------

type EnrolmentRow = {
  id: string;
  event_id: string;
  participant_id: string;
  status: string;
  payment_status: string;
  payment_provider_id: string | null;
  amount_paid: number | string | null;
  amount_due: number | string | null;
  approved_at: string | null;
  paid_at: string | null;
  event: {
    id: string;
    title_en: string | null;
    title_cn: string | null;
    currency: string | null;
    price: number | string | null;
  } | null;
  participant: {
    id: string;
    region_id: string | null;
    name_en: string | null;
    name_cn: string | null;
    region: string | null;
  } | null;
};

// Case-insensitive substring search over the reference string. Long
// provider_ids are unlikely to collide, but we enforce a minimum length of 8
// so we don't false-positive on short numeric ids.
function tryProviderIdMatch(
  reference: string | null,
  enrolments: EnrolmentRow[],
): MatchCandidate | null {
  if (!reference) return null;
  const ref = reference.toLowerCase();
  for (const e of enrolments) {
    const pid = e.payment_provider_id?.trim();
    if (!pid || pid.length < 8) continue;
    if (ref.includes(pid.toLowerCase())) {
      return toCandidate(e, 1.0, "provider_id", 0, null);
    }
  }
  return null;
}

function toCandidate(
  e: EnrolmentRow,
  score: number,
  basis: MatchCandidate["basis"],
  amountDelta: number,
  dateDelta: number | null,
): MatchCandidate {
  const title = e.event?.title_en || e.event?.title_cn || "";
  const name =
    [e.participant?.name_en, e.participant?.name_cn]
      .filter((v): v is string => typeof v === "string" && v.trim() !== "")
      .join(" · ") || "(unknown)";
  return {
    enrollment_id: e.id,
    event_id: e.event_id,
    event_title: title,
    participant_id: e.participant_id,
    participant_name: name,
    participant_region_id: e.participant?.region_id ?? null,
    participant_region: e.participant?.region ?? null,
    expected_amount:
      e.amount_paid != null
        ? Number(e.amount_paid)
        : e.amount_due != null
          ? Number(e.amount_due)
          : e.event?.price != null
            ? Number(e.event.price)
            : null,
    status: e.status,
    payment_status: e.payment_status,
    approved_at: e.approved_at,
    paid_at: e.paid_at,
    score: round4(score),
    basis,
    amount_delta: round4(amountDelta),
    date_delta_days: dateDelta,
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function daysBetween(a: string, b: string): number {
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  if (isNaN(da) || isNaN(db)) return Infinity;
  return Math.abs(da - db) / 86_400_000;
}

// Score a single enrolment against the bank txn. Assumes amount + date
// windows have already been pre-filtered at the SQL level.
function scoreByNameAmountDate(
  txn: BankTxnInput,
  e: EnrolmentRow,
): MatchCandidate | null {
  if (!e.participant) return null;
  const expected =
    e.amount_paid != null
      ? Number(e.amount_paid)
      : e.amount_due != null
        ? Number(e.amount_due)
        : e.event?.price != null
          ? Number(e.event.price)
          : null;
  if (expected == null || !Number.isFinite(expected) || expected <= 0) return null;

  const amountDelta = Math.abs(txn.amount - expected);
  const amountPct = amountDelta / expected;
  if (amountPct > AMOUNT_TOLERANCE_PCT && amountDelta > 0.5) {
    // Allow 50¢ absolute slop OR 1% — whichever is larger
    return null;
  }

  const anchorDate = e.paid_at ?? e.approved_at ?? null;
  const dateDelta = anchorDate ? daysBetween(txn.txn_date, anchorDate) : null;
  if (dateDelta != null && dateDelta > DATE_WINDOW_DAYS) return null;

  // Name similarity — try both English and Chinese names, take the max.
  const nameEn = nameSimilarity(txn.raw_name ?? "", e.participant.name_en ?? "");
  const nameCn = nameSimilarity(txn.raw_name ?? "", e.participant.name_cn ?? "");
  const nameScore = Math.max(nameEn, nameCn);

  // Composite score:
  //   60% name, 25% amount-exactness, 15% date-proximity.
  const amountScore = 1 - Math.min(amountPct * 10, 1);   // 1.0 at exact, 0 at 10%
  const dateScore =
    dateDelta == null
      ? 0.5
      : 1 - Math.min(dateDelta / DATE_WINDOW_DAYS, 1);

  const composite = 0.6 * nameScore + 0.25 * amountScore + 0.15 * dateScore;

  return toCandidate(e, composite, "name_amount_date", amountDelta, dateDelta);
}

// Load the enrolment pool for this txn and run the match. Returns a
// MatchResult with the top candidate + up to 5 suggestions.
//
// The candidate pool is pre-filtered at the SQL level to enrolments that are
// either awaiting payment or were marked paid recently — everything else
// isn't a plausible source of an inbound bank transfer.
export async function matchBankTransaction(
  service: SupabaseClient,
  txn: BankTxnInput,
): Promise<MatchResult> {
  // SQL pre-filter: load enrolments plausibly tied to this txn.
  //   - status in (approved, paid) — pending/rejected/cancelled can't absorb
  //     a payment
  //   - Pull the event.price so we can score when amount_paid is NULL
  //     (pre-payment approved rows)
  // Tolerate older databases that don't have refund_amount yet.
  const selectCols =
    "id, event_id, participant_id, status, payment_status, payment_provider_id, amount_paid, amount_due, approved_at, paid_at, event:events(id, title_en, title_cn, currency, price), participant:participants(id, region_id, name_en, name_cn, region)";

  const { data, error } = await service
    .from("enrollments")
    .select(selectCols)
    .in("status", ["approved", "paid"])
    .limit(1000);

  if (error) {
    throw new Error(`bank-match load failed: ${error.message}`);
  }

  const pool = (data ?? []) as unknown as EnrolmentRow[];

  // 1. Provider-id fast path
  const providerHit = tryProviderIdMatch(txn.raw_reference, pool);

  // 2. Name/amount/date path — always compute so we can surface suggestions
  //    even when the provider-id path hits (a human might want to override).
  const scored: MatchCandidate[] = [];
  for (const e of pool) {
    const cand = scoreByNameAmountDate(txn, e);
    if (cand) scored.push(cand);
  }
  scored.sort((a, b) => b.score - a.score);

  if (providerHit) {
    // Provider hit wins but we still surface the best name-based alternates.
    const suggestions = scored
      .filter((c) => c.enrollment_id !== providerHit.enrollment_id)
      .slice(0, 4);
    return {
      status: "auto_matched",
      confidence: 1.0,
      basis: "provider_id",
      matched: providerHit,
      suggestions,
    };
  }

  const top = scored[0] ?? null;
  const suggestions = scored.slice(0, 5);

  if (!top || top.score < SUGGEST_THRESHOLD) {
    return {
      status: "unmatched",
      confidence: top?.score ?? 0,
      basis: null,
      matched: null,
      suggestions,
    };
  }

  if (top.score >= AUTO_MATCH_THRESHOLD) {
    return {
      status: "auto_matched",
      confidence: top.score,
      basis: "name_amount_date",
      matched: top,
      suggestions: scored.slice(1, 5),
    };
  }

  return {
    status: "suggested",
    confidence: top.score,
    basis: "name_amount_date",
    matched: top,
    suggestions: scored.slice(1, 5),
  };
}
