// Client-safe types + validators for programmes (the admin-managed course
// offerings that drive tiered pricing + membership validity).
//
// Split from `programmes.ts` ("server-only") so the admin form, participant
// editor, and broadcast filter can import freely. Mirrors the inbox
// tags-types / snippets-types pattern.

export type Programme = {
  id: string;
  slug: string;
  name_en: string;
  name_cn: string;
  abbrev: string;
  validity_months: number | null;
  price_sgd: number;
  on_site_sgd: number | null;
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

// Allows '_' — the seeded slugs (e.g. glorious_family) are the pricing
// contract and must keep their original enum spelling. Mirrors the SQL CHECK.
export const PROGRAMME_SLUG_PATTERN = /^[a-z0-9][a-z0-9_]{0,49}$/;

export function validateSlug(slug: string): string | null {
  if (!slug) return "Slug is required.";
  if (!PROGRAMME_SLUG_PATTERN.test(slug)) {
    return "Slug must be lowercase letters, digits and underscores (1–50 chars, starting with a letter or digit).";
  }
  return null;
}

export function validateAbbrev(abbrev: string): string | null {
  if (!abbrev || !abbrev.trim()) return "Abbreviation is required.";
  // Count by code points so a single CJK char counts as 1.
  const len = [...abbrev.trim()].length;
  if (len < 1 || len > 2) return "Abbreviation must be 1–2 characters.";
  return null;
}

export function validateName(value: string, field: string): string | null {
  if (!value || !value.trim()) return `${field} is required.`;
  if (value.length > 80) return `${field} is too long (max 80 chars).`;
  return null;
}

export function validatePrice(value: number, field: string): string | null {
  if (!Number.isFinite(value) || value < 0) return `${field} must be a non-negative number.`;
  return null;
}

export function validateValidityMonths(value: number | null): string | null {
  if (value === null) return null; // null = perpetual
  if (!Number.isInteger(value) || value <= 0) {
    return "Validity must be a positive whole number of months, or empty for no expiry.";
  }
  return null;
}

// Convenience to derive a slug from an English name when creating a new
// programme. Returns null if the result fails the pattern (admin must type one).
export function deriveSlug(label: string): string | null {
  const cleaned = label
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  if (!cleaned) return null;
  const trimmed = cleaned.slice(0, 50).replace(/_+$/, "");
  return PROGRAMME_SLUG_PATTERN.test(trimmed) ? trimmed : null;
}

// Human-readable validity label, e.g. "3 years", "18 months", "No expiry".
export function validityLabel(months: number | null): string {
  if (months == null) return "No expiry";
  if (months % 12 === 0) {
    const years = months / 12;
    return `${years} year${years === 1 ? "" : "s"}`;
  }
  return `${months} month${months === 1 ? "" : "s"}`;
}
