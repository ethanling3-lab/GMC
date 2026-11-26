import { z } from "zod";

// Shared request shapes for the payments routes (client-safe).

export const ScheduleRowSchema = z.object({
  label: z.string().trim().min(1, "Each row needs a label").max(60),
  due_on: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal(""), z.null()]).optional(),
  amount_sgd: z.number().min(0).max(1_000_000),
});

export const ScheduleSchema = z.array(ScheduleRowSchema).max(60);

export const TemplateItemSchema = z.object({
  label: z.string().trim().min(1, "Each row needs a label").max(60),
  amount_sgd: z.number().min(0).max(1_000_000),
  due_after_months: z.number().int().min(0).max(120),
});

export const TemplateSchema = z.object({
  name: z.string().trim().min(1, "Give the template a name").max(120),
  programme_id: z.string().uuid().nullable().optional(),
  kind: z.enum(["new", "upgrade", "other"]),
  total_sgd: z.number().min(0).max(1_000_000),
  note: z.string().trim().max(500).nullable().optional(),
  active: z.boolean().optional(),
  items: z.array(TemplateItemSchema).min(1, "Add at least one row").max(60),
});

export const PaymentInSchema = z
  .object({
    amount: z.number().positive().max(1_000_000),
    currency: z.enum(["SGD", "MYR"]),
    fx_rate: z.number().positive().max(10).nullable().optional(),
    method: z.enum(["card_pos", "cash", "paynow", "bank_transfer", "tt", "other"]),
    paid_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reference: z.string().trim().max(120).nullable().optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .refine((p) => p.currency === "SGD" || (p.fx_rate ?? 0) > 0, {
    message: "Type the MYR → SGD rate (SGD for 1 MYR)",
  });
