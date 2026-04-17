import { z } from "zod";

// ISO country codes we actively support. Keep in sync with region_id trigger in migration.
export const SUPPORTED_REGIONS = ["SG", "MY", "TW", "HK", "CN", "ID", "TH", "VN", "PH", "US", "AU", "OTHER"] as const;
export type SupportedRegion = (typeof SUPPORTED_REGIONS)[number];

// Public registration payload — what the public registration form sends.
// NOTE: No passport, no government IDs. Per privacy rules, we collect only the
// minimum needed to reach out and verify identity at the event.
export const registrationSchema = z.object({
  event_slug: z.string().min(1, "Event is required"),
  name_cn: z.string().trim().max(120).optional().or(z.literal("")),
  name_en: z.string().trim().min(1, "English name is required").max(120),
  email: z.string().trim().toLowerCase().email("Invalid email"),
  phone: z
    .string()
    .trim()
    .min(5, "Phone is too short")
    .max(30, "Phone is too long")
    .regex(/^[+0-9()\s-]+$/, "Invalid phone format"),
  region: z.enum(SUPPORTED_REGIONS, { message: "Please pick your region" }),
  language: z.enum(["zh", "en", "both"]).default("zh"),
  gender: z.enum(["male", "female", "other", "undisclosed"]).default("undisclosed"),
  birth_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date (YYYY-MM-DD)")
    .optional()
    .or(z.literal("")),
  occupation: z.string().trim().max(120).optional().or(z.literal("")),
  industry: z.string().trim().max(120).optional().or(z.literal("")),

  // 感召报名: who referred / introduced this participant. Required.
  referrer_name: z.string().trim().min(1, "Referrer is required").max(120),
  referrer_contact: z.string().trim().max(120).optional().or(z.literal("")),
});

// Form-side type (fields with .default() are optional here).
export type RegistrationInput = z.input<typeof registrationSchema>;
// Server-side parsed type (defaults applied — all fields concrete).
export type RegistrationParsed = z.output<typeof registrationSchema>;

// Confirmation submission — participant re-confirms their details from the link.
export const confirmationSchema = z.object({
  token: z.string().min(32),
  name_cn: z.string().trim().max(120).optional().or(z.literal("")),
  name_en: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().min(5).max(30),
  region: z.enum(SUPPORTED_REGIONS),
  occupation: z.string().trim().max(120).optional().or(z.literal("")),
  industry: z.string().trim().max(120).optional().or(z.literal("")),
});

export type ConfirmationInput = z.infer<typeof confirmationSchema>;
