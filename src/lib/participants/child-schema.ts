import { z } from "zod";

// A child as a parent or staff enters them (migration 084).
export const ChildBody = z.object({
  name_cn: z.string().trim().min(1, "Enter the child's Chinese name.").max(60),
  name_en: z.string().trim().max(80).nullable().optional(),
  birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a birth date."),
  gender: z.enum(["male", "female"]).nullable().optional(),
});
