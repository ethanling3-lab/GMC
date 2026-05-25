// Client-safe types + helpers for inbox tags.
//
// Split from `tags.ts` ("server-only") so the picker, chip strip, and
// inbox sidebar can import freely. Follows the snippets-types pattern.

export type Tag = {
  id: string;
  slug: string;
  label_en: string;
  label_zh: string;
  color: string;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

// Mirrors the SQL CHECK constraint.
export function validateSlug(slug: string): string | null {
  if (!slug) return "Slug is required.";
  if (!SLUG_PATTERN.test(slug)) {
    return "Slug must be lowercase letters, digits and hyphens (2–40 chars, starting with a letter or digit).";
  }
  return null;
}

export function validateColor(color: string): string | null {
  if (!color) return "Colour is required.";
  if (!HEX_PATTERN.test(color)) {
    return "Colour must be a 6-digit hex like #A53A1F.";
  }
  return null;
}

// Convenience for the picker: derive a slug from a freeform label. Strips
// punctuation, lowercases, dashes spaces. Returns null if the result
// doesn't pass the SLUG_PATTERN check (admin must supply a manual slug).
export function deriveSlug(label: string): string | null {
  const cleaned = label
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!cleaned) return null;
  const trimmed = cleaned.slice(0, 40).replace(/-+$/, "");
  return SLUG_PATTERN.test(trimmed) ? trimmed : null;
}

// Decides whether a tag's chip should use light or dark text given its
// background colour. Standard relative-luminance threshold (~0.6 chosen
// for the warm paper aesthetic — slightly lower than the textbook 0.5
// so mid-tones lean dark, matching the editorial feel).
export function readableTextColor(hex: string): "light" | "dark" {
  if (!HEX_PATTERN.test(hex)) return "dark";
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const lin = (c: number) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.6 ? "dark" : "light";
}

// Tints a hex by mixing with white for the chip background (so the raw
// color stays as an accent dot or border). Used by the chip strip when a
// chip is in its "soft" rest state.
export function tintHex(hex: string, alpha: number): string {
  if (!HEX_PATTERN.test(hex)) return hex;
  // Emit rgba so we can layer over paper-warm without computing a wash.
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
