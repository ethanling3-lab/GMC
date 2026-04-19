import { z } from "zod";
import { FormSchema } from "./event-form-schema";

export const PAYMENT_METHODS = [
  "hitpay",
  "stripe",
  "bank_transfer",
  "tt",
] as const;

const slug = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, {
    message:
      "Slug must be lowercase letters, numbers, and hyphens (no leading/trailing hyphen).",
  });

export const EventCreateSchema = z.object({
  slug,
  title_en: z.string().trim().max(200).nullable().optional(),
  title_cn: z.string().trim().max(200).nullable().optional(),
  type: z
    .enum(["retreat", "course", "single_class", "delivery_class", "other"])
    .default("course"),
  mode: z.enum(["online", "offline"]).default("offline"),
});
export type EventCreate = z.infer<typeof EventCreateSchema>;

export const EventUpdateSchema = z
  .object({
    slug: slug.optional(),

    title_en: z.string().trim().max(200).nullable().optional(),
    title_cn: z.string().trim().max(200).nullable().optional(),
    heading_en: z.string().trim().max(300).nullable().optional(),
    heading_cn: z.string().trim().max(300).nullable().optional(),
    sub_heading_en: z.string().trim().max(400).nullable().optional(),
    sub_heading_cn: z.string().trim().max(400).nullable().optional(),
    body_en: z.string().nullable().optional(),
    body_cn: z.string().nullable().optional(),

    poster_url: z.string().url().nullable().optional(),
    gallery: z.array(z.string().url()).max(40).optional(),

    type: z
      .enum(["retreat", "course", "single_class", "delivery_class", "other"])
      .optional(),
    mode: z.enum(["online", "offline"]).optional(),
    venue: z.string().trim().max(200).nullable().optional(),
    city: z.string().trim().max(120).nullable().optional(),
    country: z.string().trim().max(120).nullable().optional(),

    start_date: z.string().date().nullable().optional(),
    end_date: z.string().date().nullable().optional(),
    arrival_day: z.string().date().nullable().optional(),
    departure_day: z.string().date().nullable().optional(),

    enrollment_opens_at: z.string().datetime().nullable().optional(),
    enrollment_closes_at: z.string().datetime().nullable().optional(),

    capacity: z.number().int().min(0).max(10_000).nullable().optional(),
    price: z.number().min(0).max(1_000_000).nullable().optional(),
    currency: z.string().length(3).optional(),
    payment_methods: z.array(z.enum(PAYMENT_METHODS)).optional(),

    target_audience_filter: z.record(z.string(), z.unknown()).optional(),
    status: z.enum(["draft", "open", "closed", "archived"]).optional(),
    requires_approval: z.boolean().optional(),

    form_schema: FormSchema.optional(),

    bank_details: z
      .object({
        en: z.string().max(4000).optional(),
        zh: z.string().max(4000).optional(),
      })
      .optional(),
  })
  .strict();
export type EventUpdate = z.infer<typeof EventUpdateSchema>;
