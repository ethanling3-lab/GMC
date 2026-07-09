import { z } from "zod";
import { CustomFieldSchema, type CustomField } from "@/lib/event-form-schema";

// Shape of the JSONB document admins author for a group-report template.
// Reuses the event-form field engine (CustomField + all its field types +
// buildAnswersSchema) and wraps it in a fixed two-section model:
//
//   group_section  — the overall 汇总 summary, filled once per group
//   member_section — repeated once per group member (the same fields applied
//                    to each member; answers stored per participant_id)
//
// Safe to import from client code (types + zod only).

const SectionSchema = z.object({
  title_en: z.string().trim().max(200).default(""),
  title_cn: z.string().trim().max(200).default(""),
  fields: z.array(CustomFieldSchema).max(60).default([]),
});
export type GroupReportSection = {
  title_en: string;
  title_cn: string;
  fields: CustomField[];
};

export const GroupReportSchema = z.object({
  version: z.literal(1).default(1),
  group_section: SectionSchema.default({ title_en: "", title_cn: "", fields: [] }),
  member_section: SectionSchema.default({ title_en: "", title_cn: "", fields: [] }),
});
export type GroupReportSchema = z.infer<typeof GroupReportSchema>;

export function defaultGroupReportSchema(): GroupReportSchema {
  return {
    version: 1,
    group_section: { title_en: "Group summary", title_cn: "汇总", fields: [] },
    member_section: { title_en: "Member", title_cn: "组员", fields: [] },
  };
}

// Coerce whatever comes back from the DB (may be {} or a legacy row) into a
// fully-populated GroupReportSchema. Never throws.
export function normalizeGroupReportSchema(raw: unknown): GroupReportSchema {
  const parsed = GroupReportSchema.safeParse(raw ?? {});
  const base = defaultGroupReportSchema();
  if (!parsed.success) return base;
  return {
    version: 1,
    group_section: {
      title_en: parsed.data.group_section?.title_en ?? base.group_section.title_en,
      title_cn: parsed.data.group_section?.title_cn ?? base.group_section.title_cn,
      fields: parsed.data.group_section?.fields ?? [],
    },
    member_section: {
      title_en: parsed.data.member_section?.title_en ?? base.member_section.title_en,
      title_cn: parsed.data.member_section?.title_cn ?? base.member_section.title_cn,
      fields: parsed.data.member_section?.fields ?? [],
    },
  };
}

// True when a template has no answerable questions in either section — used to
// decide whether a template is worth activating / showing to leaders.
export function isGroupReportSchemaEmpty(schema: GroupReportSchema): boolean {
  const answerable = (fields: CustomField[]) =>
    fields.filter((f) => f.type !== "section_header").length;
  return answerable(schema.group_section.fields) === 0 && answerable(schema.member_section.fields) === 0;
}
