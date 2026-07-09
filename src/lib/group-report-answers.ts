import type { CustomField } from "@/lib/event-form-schema";
import { OTHER_OPTION_VALUE } from "@/lib/event-form-schema";

// Resolve a stored answer value to a human-readable string, mirroring the
// display logic in EnrollmentsTable's AnswersGrid: option values → bilingual
// labels, the "__other" companion → "Other: <text>", checkbox_ack → ✓.
// Used by the group-report XLSX export. `answers` is the flat record for the
// section (so we can read the `<id>__other` companion).

function optionLabel(field: CustomField, value: string, locale: "zh" | "en"): string {
  if (value === OTHER_OPTION_VALUE) return locale === "zh" ? "其他" : "Other";
  const o = field.options.find((opt) => opt.value === value);
  if (!o) return value;
  const primary = locale === "zh" ? o.label_cn : o.label_en;
  const fallback = locale === "zh" ? o.label_en : o.label_cn;
  return (primary || fallback || o.value).trim();
}

export function formatAnswerValue(
  field: CustomField,
  answers: Record<string, unknown>,
  locale: "zh" | "en" = "zh",
): string {
  const value = answers[field.id];
  const otherText = answers[`${field.id}__other`];
  const otherStr = typeof otherText === "string" ? otherText.trim() : "";

  switch (field.type) {
    case "section_header":
      return "";
    case "short_text":
    case "long_text":
    case "date":
      return typeof value === "string" ? value : "";
    case "checkbox_ack":
      return value === true ? "✓" : "";
    case "single_select": {
      if (typeof value !== "string" || !value) return "";
      const label = optionLabel(field, value, locale);
      if (value === OTHER_OPTION_VALUE && otherStr) return `${label}: ${otherStr}`;
      return label;
    }
    case "multi_select": {
      if (!Array.isArray(value) || value.length === 0) return "";
      const parts = value.map((v) => {
        const label = optionLabel(field, String(v), locale);
        if (v === OTHER_OPTION_VALUE && otherStr) return `${label}: ${otherStr}`;
        return label;
      });
      return parts.join(", ");
    }
    default:
      return "";
  }
}

// Bilingual column header for a field, used as the XLSX header cell.
export function fieldHeader(field: CustomField): string {
  const cn = field.label_cn?.trim();
  const en = field.label_en?.trim();
  if (cn && en) return `${cn} · ${en}`;
  return cn || en || field.id;
}
