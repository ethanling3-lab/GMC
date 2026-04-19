import { z } from "zod";
import {
  GENDERS,
  LANGUAGES,
  MOTIVATIONS,
  REGIONS,
} from "@/lib/participant-import-schema";

export const STATUSES = [
  "new",
  "info_verified",
  "cs_enriched",
  "active",
  "inactive",
] as const;

const optionalString = z
  .union([z.string().max(2000), z.null()])
  .optional()
  .transform((v) => (v === "" ? null : v));

const optionalEmail = z
  .union([z.string().email().max(200), z.literal(""), z.null()])
  .optional()
  .transform((v) => (v === "" || v == null ? null : v));

const optionalDate = z
  .union([
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
    z.literal(""),
    z.null(),
  ])
  .optional()
  .transform((v) => (v === "" || v == null ? null : v));

const score = z
  .union([z.number().int().min(1).max(10), z.null()])
  .optional();

export const ParticipantUpdateSchema = z
  .object({
    region_id: z
      .union([z.string().trim().min(1).max(50), z.literal(""), z.null()])
      .optional()
      .transform((v) => (v === "" || v == null ? null : v)),
    name_en: optionalString,
    name_cn: optionalString,
    email: optionalEmail,
    phone: optionalString,
    region: z.union([z.enum(REGIONS), z.null()]).optional(),
    language: z.union([z.enum(LANGUAGES), z.null()]).optional(),
    gender: z.union([z.enum(GENDERS), z.null()]).optional(),
    birth_date: optionalDate,
    occupation: optionalString,
    industry: optionalString,

    financial_score: score,
    influence_score: score,
    overall_score: score,
    motivation_tag: z.union([z.enum(MOTIVATIONS), z.null()]).optional(),
    is_old_student: z.boolean().optional(),

    personality: optionalString,
    face_type: optionalString,
    parameter_framework: optionalString,
    cs_notes: z
      .union([z.string().max(20_000), z.null()])
      .optional()
      .transform((v) => (v === "" ? null : v)),

    assigned_region_lead_id: z.union([z.string().uuid(), z.null()]).optional(),
    assigned_cs_id: z.union([z.string().uuid(), z.null()]).optional(),

    status: z.enum(STATUSES).optional(),
  })
  .strict();

export type ParticipantUpdate = z.infer<typeof ParticipantUpdateSchema>;

// Fields that a regional_lead or customer_service admin is allowed to edit.
// Super admins can edit everything.
export const SCOPED_ALLOWED_FIELDS: ReadonlyArray<keyof ParticipantUpdate> = [
  "region_id",
  "name_en",
  "name_cn",
  "email",
  "phone",
  "language",
  "gender",
  "birth_date",
  "occupation",
  "industry",
  "financial_score",
  "influence_score",
  "overall_score",
  "motivation_tag",
  "is_old_student",
  "personality",
  "face_type",
  "parameter_framework",
  "cs_notes",
  "status",
];
