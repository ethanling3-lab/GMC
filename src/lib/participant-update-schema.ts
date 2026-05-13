import { z } from "zod";
import {
  GENDERS,
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

export const ZU_ZHANG_TIERS = [
  "key_recruitment",
  "recruitment",
  "maintenance",
  "auxiliary",
] as const;

export const GROWTH_DIMENSIONS = [
  "financial",
  "relationship",
  "health",
  "inner_peace",
] as const;

export const STUDENT_QUALIFICATIONS = [
  "basic",
  "rising",
  "elite",
  "excellence",
  "strategic",
] as const;

export const UPGRADE_POTENTIALS = ["low", "medium", "high"] as const;

export const PROGRAMME_TIERS = [
  "abundance",
  "glorious_family",
  "elite_cultural_heritage",
  "glorious_cultural_heritage",
] as const;

export const ZU_ZHANG_CORE_TRAITS = [
  "logical_thinking",
  "social_intelligence",
  "adaptability",
  "goal_orientation",
  "attention_to_detail",
] as const;

export const ENERGY_PROFILES = ["high", "medium", "quiet"] as const;
export const LANGUAGE_FLUENCIES = ["en", "cn", "both"] as const;

// M6.8 — profile-deck fields. attended_courses is admin-maintained;
// each entry can carry an optional programme_tier tag + free-form date
// (year-month or full date string — kept as text to absorb partial
// dates like "2024-03").
const attendedCourseEntry = z.object({
  course_name: z.string().trim().min(1).max(200),
  programme_tier: z
    .union([z.enum(PROGRAMME_TIERS), z.null()])
    .optional(),
  date: z
    .union([z.string().trim().max(20), z.null()])
    .optional(),
});

const optionalString = z
  .union([z.string().max(2000), z.null()])
  .optional()
  .transform((v) => (v === "" ? null : v));

// CRITICAL: preserve undefined through transforms. Zod's .optional()
// lets undefined flow into the transform; if the transform converts
// undefined → null, missing keys in the PATCH body get nulled out.
// That bricks region_id (and email + birth_date) whenever ANY PATCH
// caller doesn't include them. Always check `v === undefined` first.
const optionalEmail = z
  .union([z.string().email().max(200), z.literal(""), z.null()])
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    return v === "" || v === null ? null : v;
  });

const optionalDate = z
  .union([
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
    z.literal(""),
    z.null(),
  ])
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    return v === "" || v === null ? null : v;
  });

// Post-022 the score scale is 1-5 with semantic level labels
// (基础/成长/精英/卓越/战略). The DB constraint enforces 1-5; we cap
// here too so client-side validation matches.
const score = z
  .union([z.number().int().min(1).max(5), z.null()])
  .optional();

// overall_score is soft-deprecated (legacy 1-10 column kept for read-
// only display). Algorithm doesn't consume it. Schema retains the
// legacy bound so existing rows still load; nothing should be writing.
const legacyOverallScore = z
  .union([z.number().int().min(1).max(10), z.null()])
  .optional();

export const ParticipantUpdateSchema = z
  .object({
    region_id: z
      .union([z.string().trim().min(1).max(50), z.literal(""), z.null()])
      .optional()
      .transform((v) => {
        if (v === undefined) return undefined;
        return v === "" || v === null ? null : v;
      }),
    name_en: optionalString,
    name_cn: optionalString,
    email: optionalEmail,
    phone: optionalString,
    region: z.union([z.enum(REGIONS), z.null()]).optional(),
    gender: z.union([z.enum(GENDERS), z.null()]).optional(),
    birth_date: optionalDate,
    occupation: optionalString,
    industry: optionalString,

    financial_score: score,
    influence_score: score,
    overall_score: legacyOverallScore,
    motivation_tag: z.union([z.enum(MOTIVATIONS), z.null()]).optional(),
    is_old_student: z.boolean().optional(),

    personality: optionalString,
    face_type: optionalString,
    parameter_framework: optionalString,
    cs_notes: z
      .union([z.string().max(20_000), z.null()])
      .optional()
      .transform((v) => (v === "" ? null : v)),

    // M6.0 qualitative fields.
    zu_zhang_tier: z.union([z.enum(ZU_ZHANG_TIERS), z.null()]).optional(),
    zu_zhang_grade: z
      .union([z.number().int().min(1).max(5), z.null()])
      .optional(),
    zu_zhang_dimensions: z.array(z.enum(GROWTH_DIMENSIONS)).max(4).optional(),
    zu_zhang_core_traits: z
      .array(z.enum(ZU_ZHANG_CORE_TRAITS))
      .max(5)
      .optional(),
    goal_dimensions: z.array(z.enum(GROWTH_DIMENSIONS)).max(4).optional(),
    student_qualification: z
      .union([z.enum(STUDENT_QUALIFICATIONS), z.null()])
      .optional(),
    has_special_contribution: z.boolean().optional(),
    upgrade_potential: z.union([z.enum(UPGRADE_POTENTIALS), z.null()]).optional(),
    programme_tier: z.union([z.enum(PROGRAMME_TIERS), z.null()]).optional(),

    // M6.8 profile-deck fields.
    dharma_name: optionalString,
    religion: optionalString,
    attended_courses: z.array(attendedCourseEntry).max(50).optional(),

    // Migration 032 — full briefing card (sectioned as 个人 / 上课 / 客服).
    sub_region: optionalString,
    training_level: optionalString,
    health_status: optionalString,
    family_situation: optionalString,
    dietary_needs: optionalString,
    interaction_notes: optionalString,
    course_needs: optionalString,
    suggested_group_leader_notes: optionalString,
    recommended_courses: optionalString,
    forbidden_courses: optionalString,
    cs_evaluation: optionalString,

    assigned_region_lead_id: z.union([z.string().uuid(), z.null()]).optional(),
    assigned_cs_id: z.union([z.string().uuid(), z.null()]).optional(),

    // Relationships. family_member_ids is the FULL desired set of
    // family-link partners; the PATCH route reconciles by adding new
    // edges + removing dropped ones. Referrer is a simple FK column.
    family_member_ids: z.array(z.string().uuid()).max(50).optional(),
    referrer_id: z.union([z.string().uuid(), z.null()]).optional(),
    referrer_name: optionalString,
    referrer_contact: optionalString,

    // M6.4 grouping signals (migration 030).
    energy_profile: z.union([z.enum(ENERGY_PROFILES), z.null()]).optional(),
    language_fluency: z
      .union([z.enum(LANGUAGE_FLUENCIES), z.null()])
      .optional(),
    // Conflict pairs — same shape as family_member_ids: full desired
    // set; PATCH route reconciles vs participant_conflict_pairs.
    conflict_member_ids: z.array(z.string().uuid()).max(50).optional(),

    status: z.enum(STATUSES).optional(),
  })
  .strict();

export type ParticipantUpdate = z.infer<typeof ParticipantUpdateSchema>;

// Fields that a regional_lead or customer_service admin is allowed to edit.
// Super admins can edit everything.
//
// `overall_score` was scoped-editable on the legacy 1-10 model; in M6.0
// it's read-only (soft-deprecated). Drop from the scoped list so the
// API rejects writes from non-super admins. Super admin can still write
// via the strict schema for legacy fixups.
export const SCOPED_ALLOWED_FIELDS: ReadonlyArray<keyof ParticipantUpdate> = [
  "region_id",
  "name_en",
  "name_cn",
  "email",
  "phone",
  "gender",
  "birth_date",
  "occupation",
  "industry",
  "financial_score",
  "influence_score",
  "motivation_tag",
  "is_old_student",
  "personality",
  "face_type",
  "parameter_framework",
  "cs_notes",
  "status",
  "zu_zhang_tier",
  "zu_zhang_grade",
  "zu_zhang_dimensions",
  "zu_zhang_core_traits",
  "goal_dimensions",
  "student_qualification",
  "has_special_contribution",
  "upgrade_potential",
  "programme_tier",
  "dharma_name",
  "religion",
  "attended_courses",
  "sub_region",
  "training_level",
  "health_status",
  "family_situation",
  "dietary_needs",
  "interaction_notes",
  "course_needs",
  "suggested_group_leader_notes",
  "recommended_courses",
  "forbidden_courses",
  "cs_evaluation",
  "family_member_ids",
  "referrer_id",
  "referrer_name",
  "referrer_contact",
  "energy_profile",
  "language_fluency",
  "conflict_member_ids",
];
