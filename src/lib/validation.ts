import { z } from "zod";
import {
  buildAnswersSchema,
  type FormSchema as EventFormSchema,
  type IdentityToggles,
} from "./event-form-schema";

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

// Build a registration schema tailored to an event's identity toggles + custom
// form fields. Used by both the client (resolver swaps when the selected event
// changes) and the server (`/api/register`). Identity fields that the event
// marks required become non-empty; custom answers live under `answers.*`.
export function buildRegistrationSchemaFor(
  identity: IdentityToggles | undefined | null,
  formSchema: EventFormSchema,
) {
  const i: IdentityToggles = identity ?? {
    require_name_cn: true,
    require_birth_date: false,
    require_gender: false,
    require_occupation: false,
    require_industry: false,
    require_referrer: true,
  };
  const requiredStr = (msg: string) => z.string().trim().min(1, msg).max(120);
  const optionalStr = z.string().trim().max(120).optional().or(z.literal(""));

  const base = z.object({
    event_slug: z.string().min(1, "Event is required"),
    name_en: requiredStr("English name is required"),
    name_cn: i.require_name_cn
      ? requiredStr("Chinese name is required")
      : optionalStr,
    email: z.string().trim().toLowerCase().email("Invalid email"),
    phone: z
      .string()
      .trim()
      .min(5, "Phone is too short")
      .max(30, "Phone is too long")
      .regex(/^[+0-9()\s-]+$/, "Invalid phone format"),
    region: z.enum(SUPPORTED_REGIONS, { message: "Please pick your region" }),
    language: z.enum(["zh", "en", "both"]).default("zh"),
    gender: i.require_gender
      ? z.enum(["male", "female", "other"], {
          message: "Please pick your gender",
        })
      : z.enum(["male", "female", "other", "undisclosed"]).default("undisclosed"),
    birth_date: i.require_birth_date
      ? z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Birth date is required (YYYY-MM-DD)")
      : z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date (YYYY-MM-DD)")
          .optional()
          .or(z.literal("")),
    occupation: i.require_occupation
      ? requiredStr("Occupation is required")
      : optionalStr,
    industry: i.require_industry
      ? requiredStr("Industry is required")
      : optionalStr,

    referrer_name: i.require_referrer
      ? requiredStr("Referrer is required")
      : optionalStr,
    referrer_contact: z.string().trim().max(120).optional().or(z.literal("")),

    prefill_token: z.string().max(200).optional(),

    answers: buildAnswersSchema(formSchema),
  });

  return base;
}

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
