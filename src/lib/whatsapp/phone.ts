// The single source of truth for turning a typed-in phone number into the
// E.164 string Meta will accept.
//
// Pure — no runtime imports, no `server-only`, no "use client". It is imported
// by route handlers, the notification sender, the broadcast audience builder,
// AND client-side form validation, so keep it dependency-free.
//
// WHY THIS EXISTS
//
// Before this module, four places each did their own thing and disagreed:
//   - src/lib/broadcasts/audience.ts   `toE164` — strips separators, prepends
//     '+' to any bare 6-15 digit run. Knows no country, so `0127701231`
//     became `+0127701231`, which is not a number anywhere.
//   - src/lib/inbox/channels/whatsapp.ts `normalizeWhatsAppId` — inbound only,
//     and correct only because Meta already hands back E.164.
//   - src/lib/grouping/load-groups.ts  `phoneKey` — last 8 digits, for
//     duplicate-person matching. Deliberately lossy; NOT a dialable number.
//     Left alone on purpose — it answers a different question.
//   - src/app/api/me/recruit/leads/route.ts — raw digits, baked into a
//     synthetic `<digits>@no-email.gmc` placeholder email.
// and the actual send path (src/lib/enrollment-notifications.ts) normalised
// nothing at all — it passed `participants.phone` verbatim to Graph.
//
// THE TRUNK-ZERO PROBLEM
//
// This can't be solved by string-munging alone, which is why the rules below
// are per-country. `012-345 6789` is a valid Malaysian mobile whose leading
// '0' is a national trunk prefix that must be DROPPED when the +60 country
// code goes on: +60123456789. The identical digits under Singapore rules are
// not a mobile at all — SG has no trunk prefix and its numbers are 8 digits.
// So the same input is correct, wrong, or meaningless depending on a country
// we have to be told. Hence `defaultRegion`.
//
// WHAT THIS DELIBERATELY WILL NOT DO
//
// It never guesses its way past a contradiction. A stored `+65 0127701231` on
// a participant whose region is MY is a real row in this database: someone
// picked the wrong country code AND kept the trunk zero. We could "fix" it to
// +60127701231 by trusting region over the typed code — and if that guess is
// wrong, GMC sends a stranger somebody's enrollment details. It is reported
// as `invalid_for_country` for a human to resolve instead.

export type RegionCode = "SG" | "MY" | "HK" | "TW" | "CN";

type CountryRule = {
  /** Country calling code, digits only. */
  cc: string;
  /**
   * True when the national numbering plan puts a '0' in front of the
   * subscriber number for domestic dialling. That '0' is dropped in E.164.
   * SG and HK have no trunk prefix at all, so a leading '0' there is an
   * error rather than something to strip.
   */
  trunk: boolean;
  /** Valid national significant number lengths, AFTER any trunk 0 is dropped. */
  nsnLengths: number[];
  /** Leading digits of the NSN that indicate a mobile line. */
  mobileFirst: string[];
};

// GMC's participant base is these five regions (participants.region). Adding a
// sixth is one row here.
const RULES: Record<RegionCode, CountryRule> = {
  SG: { cc: "65", trunk: false, nsnLengths: [8], mobileFirst: ["8", "9"] },
  MY: { cc: "60", trunk: true, nsnLengths: [9, 10], mobileFirst: ["1"] },
  HK: { cc: "852", trunk: false, nsnLengths: [8], mobileFirst: ["5", "6", "9"] },
  TW: { cc: "886", trunk: true, nsnLengths: [8, 9], mobileFirst: ["9"] },
  CN: { cc: "86", trunk: true, nsnLengths: [10, 11], mobileFirst: ["1"] },
};

// Longest-first so '852' wins over '85' and '886' over '88' when matching a
// typed country code against the table.
const CC_TO_REGION: Array<[string, RegionCode]> = (
  Object.entries(RULES) as Array<[RegionCode, CountryRule]>
)
  .map(([region, rule]) => [rule.cc, region] as [string, RegionCode])
  .sort((a, b) => b[0].length - a[0].length);

export type PhoneRejectReason =
  /** Nothing usable in the input at all. */
  | "empty"
  /** Fewer digits than the shortest real number. */
  | "too_short"
  /** No '+' country code typed and no region to infer one from. */
  | "unknown_country"
  /**
   * The digits contradict the country they claim. Covers a leading '0' under
   * a no-trunk plan (SG/HK) and any NSN whose length isn't valid there.
   * Always a human fix — see the header note.
   */
  | "invalid_for_country";

export type PhoneNormalizeResult =
  | {
      ok: true;
      /** '+' followed by digits only. Safe to hand to Graph. */
      e164: string;
      /** Null when the country code isn't one of GMC's five. */
      country: RegionCode | null;
      /** Null when we have no numbering rules for that country. */
      mobile: boolean | null;
      /** True when normalisation actually altered the input. */
      changed: boolean;
    }
  | { ok: false; reason: PhoneRejectReason; detail: string };

/**
 * Digits, and whether the input carried an explicit international prefix.
 *
 * NFKC folds full-width digits (５１２ → 512), which a participant typing on a
 * Chinese or Taiwanese IME can easily produce. '00' and '011' are the common
 * international access prefixes in this region and mean the same as '+'.
 */
function scan(raw: string): { digits: string; international: boolean } {
  const s = raw.normalize("NFKC").trim();
  if (s.startsWith("+")) {
    return { digits: s.slice(1).replace(/\D/g, ""), international: true };
  }
  const digits = s.replace(/\D/g, "");
  if (digits.startsWith("00") && digits.length > 4) {
    return { digits: digits.slice(2), international: true };
  }
  if (digits.startsWith("011") && digits.length > 5) {
    return { digits: digits.slice(3), international: true };
  }
  return { digits, international: false };
}

function validate(
  region: RegionCode,
  nsn: string,
): { ok: true; mobile: boolean } | { ok: false; detail: string } {
  const rule = RULES[region];
  if (!rule.nsnLengths.includes(nsn.length)) {
    return {
      ok: false,
      detail: `${region} numbers are ${rule.nsnLengths.join(" or ")} digits after the country code, got ${nsn.length}`,
    };
  }
  return { ok: true, mobile: rule.mobileFirst.includes(nsn.slice(0, 1)) };
}

/**
 * Normalises a typed phone number to E.164.
 *
 * `defaultRegion` supplies the country when the input has no international
 * prefix — pass `participants.region`. It is IGNORED when the input already
 * carries a country code, so a Malaysian number stored on an SG-region
 * participant still normalises as Malaysian.
 */
export function normalizePhone(
  raw: string | null | undefined,
  defaultRegion?: RegionCode | string | null,
): PhoneNormalizeResult {
  if (!raw || !raw.trim()) return { ok: false, reason: "empty", detail: "no phone" };

  const { digits, international } = scan(raw);
  if (!digits) return { ok: false, reason: "empty", detail: "no digits in input" };
  if (digits.length < 7) {
    return { ok: false, reason: "too_short", detail: `only ${digits.length} digits` };
  }

  const region = asRegionCode(defaultRegion);

  if (international) {
    // An E.164 country code always starts 1-9, so a leading zero here is
    // malformed — '+0065 9123 4567' (international prefix typed twice),
    // '+0123...' (trunk zero kept after the '+'), or a synthetic number. We
    // could charitably strip it, but that guesses at which of those it was,
    // and this module does not guess: a wrong guess sends someone's details
    // to a stranger. Reported so a human decides.
    //
    // Found by migration 052's format check rejecting 300 backfill rows —
    // the constraint is the reason this branch is not still wrong.
    if (digits.startsWith("0")) {
      return {
        ok: false,
        reason: "invalid_for_country",
        detail: "country code cannot start with 0",
      };
    }
    const hit = CC_TO_REGION.find(([cc]) => digits.startsWith(cc));
    if (!hit) {
      // A country we have no rules for — Indonesia, Australia, anywhere. We
      // can't validate it, but it is already in international form, so pass it
      // through rather than block a legitimate participant. Meta will reject
      // it if it's wrong, and that failure is now surfaced (see the callers).
      if (digits.length > 15) {
        return { ok: false, reason: "invalid_for_country", detail: "more than 15 digits" };
      }
      return { ok: true, e164: `+${digits}`, country: null, mobile: null, changed: `+${digits}` !== raw.trim() };
    }
    const [cc, ccRegion] = hit;
    let nsn = digits.slice(cc.length);
    if (nsn.startsWith("0")) {
      if (!RULES[ccRegion].trunk) {
        // e.g. '+65 0127701231' — SG has no trunk prefix, so this is a typo we
        // must not paper over. See the header note on not guessing.
        return {
          ok: false,
          reason: "invalid_for_country",
          detail: `+${cc} numbers never start with 0 after the country code`,
        };
      }
      nsn = nsn.replace(/^0+/, "");
    }
    const check = validate(ccRegion, nsn);
    if (!check.ok) {
      return { ok: false, reason: "invalid_for_country", detail: check.detail };
    }
    const e164 = `+${cc}${nsn}`;
    return { ok: true, e164, country: ccRegion, mobile: check.mobile, changed: e164 !== raw.trim() };
  }

  if (!region) {
    return {
      ok: false,
      reason: "unknown_country",
      detail: "no country code typed and no region on the record",
    };
  }

  const rule = RULES[region];
  let nsn: string;
  if (
    digits.startsWith(rule.cc) &&
    rule.nsnLengths.includes(digits.length - rule.cc.length)
  ) {
    // Already carries its own country code, just without the '+'. Checking the
    // remaining length matters: an HK number can legitimately begin '60', and
    // an MY '60123456' is 8 digits — too short for MY once '60' is eaten — so
    // the length test is what stops us from swallowing a real leading digit.
    nsn = digits.slice(rule.cc.length);
  } else if (rule.trunk && digits.startsWith("0")) {
    nsn = digits.replace(/^0+/, "");
  } else {
    nsn = digits;
  }

  if (digits.startsWith("0") && !rule.trunk) {
    return {
      ok: false,
      reason: "invalid_for_country",
      detail: `${region} numbers never start with 0`,
    };
  }

  const check = validate(region, nsn);
  if (!check.ok) {
    return { ok: false, reason: "invalid_for_country", detail: check.detail };
  }
  const e164 = `+${rule.cc}${nsn}`;
  return { ok: true, e164, country: region, mobile: check.mobile, changed: e164 !== raw.trim() };
}

/**
 * Meta's `wa_id` → E.164.
 *
 * Kept separate from normalizePhone because a wa_id is ALWAYS international
 * and always digits-only ('6591234567'), with no '+' and no trunk prefix.
 * Feeding it to normalizePhone without a region would be rejected as
 * `unknown_country` — which would break inbound message resolution — and
 * feeding it one would be worse: '6591234567' under an MY default would be
 * read as a local number and mangled. So the country is taken from the digits
 * themselves, exactly as Meta sent them.
 *
 * This replaces the two hand-rolled copies that used to live in
 * inbox/identity.ts and inbox/channels/whatsapp.ts.
 */
export function waIdToE164(waId: string): string {
  const digits = waId.replace(/\D/g, "");
  return digits ? `+${digits}` : waId.trim();
}

/** Narrows a free-text region column to a region we have rules for. */
export function asRegionCode(value: string | null | undefined): RegionCode | null {
  if (!value) return null;
  const up = value.trim().toUpperCase();
  return up in RULES ? (up as RegionCode) : null;
}

/**
 * Convenience for send paths: the E.164 string, or null if it can't be formed.
 *
 * Callers that need to TELL THE USER why should use normalizePhone and read
 * the reason. This exists so a call site that genuinely has nothing to do with
 * a failure doesn't have to unwrap the result type.
 */
export function toE164OrNull(
  raw: string | null | undefined,
  defaultRegion?: RegionCode | string | null,
): string | null {
  const res = normalizePhone(raw, defaultRegion);
  return res.ok ? res.e164 : null;
}
