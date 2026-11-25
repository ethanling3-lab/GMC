// Client-safe types + validators for the course catalogue (migration 075).
// A course is a kind of class (永不落空, HLCC, 金口之道 …); each event is a
// dated session of one course. Split from courses.ts ("server-only") so
// forms and the calendar can import freely.

export type Course = {
  id: string;
  slug: string;
  name_en: string;
  name_cn: string;
  short_label: string;
  colour: string;
  description: string | null;
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export const COURSE_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,49}$/;
export const COURSE_COLOUR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

// Calm, distinguishable swatches for the calendar (cool blues first — the
// admin palette — then warm accents). Admin can type any hex.
export const COURSE_COLOUR_SWATCHES = [
  "#3B5BDB",
  "#0C8599",
  "#2B8A3E",
  "#E67700",
  "#C2255C",
  "#7048E8",
  "#5C7CFA",
  "#868E96",
] as const;

export function validateCourseSlug(slug: string): string | null {
  if (!slug) return "Slug is required.";
  if (!COURSE_SLUG_PATTERN.test(slug)) {
    return "Slug must be lowercase letters, digits and hyphens (1–50 chars).";
  }
  return null;
}

export function validateCourseName(value: string, field: string): string | null {
  if (!value || !value.trim()) return `${field} is required.`;
  if (value.length > 80) return `${field} is too long (max 80 chars).`;
  return null;
}

export function validateShortLabel(value: string): string | null {
  const v = value?.trim() ?? "";
  if (!v) return "Short label is required.";
  if ([...v].length > 8) return "Short label must be 8 characters or fewer.";
  return null;
}

export function validateColour(value: string): string | null {
  if (!COURSE_COLOUR_PATTERN.test(value ?? "")) return "Colour must be a hex like #3B5BDB.";
  return null;
}

export function deriveCourseSlug(label: string): string | null {
  const cleaned = label
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50)
    .replace(/-+$/, "");
  return cleaned && COURSE_SLUG_PATTERN.test(cleaned) ? cleaned : null;
}
