import { z } from "zod";
import { FAQ_ANSWER_MAX_CHARS, FAQ_QUESTION_MAX_CHARS } from "./automations-types";

export const WHATSAPP_WRITE_ROLES = new Set(["super_admin", "regional_lead"]);

const answer = z
  .string()
  .trim()
  .max(FAQ_ANSWER_MAX_CHARS)
  .nullable()
  .transform((v) => (v ? v : null));

export const FaqBody = z
  .object({
    question: z.string().trim().min(1).max(FAQ_QUESTION_MAX_CHARS),
    answer_en: answer,
    answer_zh: answer,
  })
  .refine((v) => v.answer_en !== null || v.answer_zh !== null);

export const FaqSwitchBody = z.object({ enabled: z.boolean() });
