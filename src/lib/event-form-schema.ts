import { z } from "zod";

// Shape of the JSONB document admins author in the event editor. The document
// drives both the public `/register` renderer and server-side answer
// validation. Safe to import from client code.

export const CUSTOM_FIELD_TYPES = [
  "section_header",
  "short_text",
  "long_text",
  "single_select",
  "multi_select",
  "checkbox_ack",
  "date",
] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

const fieldId = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, {
    message: "Field id must be snake_case (lowercase, digits, underscore).",
  });

const optionValue = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9_-]+$/, {
    message: "Option value must be alphanumeric / underscore / hyphen.",
  });

export const CustomFieldOptionSchema = z.object({
  value: optionValue,
  label_en: z.string().trim().max(240).default(""),
  label_cn: z.string().trim().max(240).default(""),
});
export type CustomFieldOption = z.infer<typeof CustomFieldOptionSchema>;

export const OTHER_OPTION_VALUE = "__other__";

export const CustomFieldSchema = z
  .object({
    id: fieldId,
    type: z.enum(CUSTOM_FIELD_TYPES),
    label_en: z.string().trim().max(400).default(""),
    label_cn: z.string().trim().max(400).default(""),
    hint_en: z.string().trim().max(600).default(""),
    hint_cn: z.string().trim().max(600).default(""),
    required: z.boolean().default(false),
    options: z.array(CustomFieldOptionSchema).max(40).default([]),
    // When true on a single/multi-select field, the renderer appends an
    // "Other" choice + free-text input. The text lands at
    // `answers.<field_id>__other` alongside the choice value.
    allow_other: z.boolean().default(false),
  })
  .superRefine((f, ctx) => {
    if (f.type === "single_select" || f.type === "multi_select") {
      if (f.options.length < 1) {
        ctx.addIssue({
          code: "custom",
          path: ["options"],
          message: "Select fields need at least one option.",
        });
      }
      const seen = new Set<string>();
      for (const o of f.options) {
        if (seen.has(o.value)) {
          ctx.addIssue({
            code: "custom",
            path: ["options"],
            message: `Duplicate option value "${o.value}".`,
          });
        }
        seen.add(o.value);
      }
    }
    if (f.type !== "section_header") {
      if (!f.label_en.trim() && !f.label_cn.trim()) {
        ctx.addIssue({
          code: "custom",
          path: ["label_en"],
          message: "Provide at least one language label.",
        });
      }
    }
  });
export type CustomField = z.infer<typeof CustomFieldSchema>;

export const IdentityTogglesSchema = z.object({
  require_name_cn: z.boolean().default(true),
  require_birth_date: z.boolean().default(false),
  require_gender: z.boolean().default(false),
  require_occupation: z.boolean().default(false),
  require_industry: z.boolean().default(false),
  require_referrer: z.boolean().default(true),
});
export type IdentityToggles = z.infer<typeof IdentityTogglesSchema>;

export const FormSchema = z.object({
  version: z.literal(1).default(1),
  identity: IdentityTogglesSchema.default({
    require_name_cn: true,
    require_birth_date: false,
    require_gender: false,
    require_occupation: false,
    require_industry: false,
    require_referrer: true,
  }),
  fields: z.array(CustomFieldSchema).max(60).default([]),
});
export type FormSchema = z.infer<typeof FormSchema>;

// Literal fallback so callers never encounter an undefined `identity`. Zod's
// default() on a nested object occasionally doesn't propagate when the raw DB
// row is exactly `{}`, so we build the object ourselves and trust Zod to
// validate the shape from here on.
const DEFAULT_IDENTITY: IdentityToggles = {
  require_name_cn: true,
  require_birth_date: false,
  require_gender: false,
  require_occupation: false,
  require_industry: false,
  require_referrer: true,
};

export function defaultFormSchema(): FormSchema {
  return {
    version: 1,
    identity: { ...DEFAULT_IDENTITY },
    fields: [],
  };
}

// Coerce whatever comes back from the DB (may be {} or a legacy row) into a
// fully-populated FormSchema, dropping unknown fields. Never throws.
export function normalizeFormSchema(raw: unknown): FormSchema {
  const parsed = FormSchema.safeParse(raw ?? {});
  const base = defaultFormSchema();
  if (!parsed.success) return base;
  return {
    version: 1,
    identity: { ...base.identity, ...(parsed.data.identity ?? {}) },
    fields: parsed.data.fields ?? [],
  };
}

// Build the Zod schema used to validate a given event's submitted answers.
// Output keys == custom field ids; shape depends on field type + required.
export function buildAnswersSchema(schema: FormSchema | null | undefined) {
  const shape: Record<string, z.ZodTypeAny> = {};
  const fields = schema?.fields ?? [];

  for (const f of fields) {
    if (f.type === "section_header") continue;

    // For selects with `allow_other`, widen the accepted value list to include
    // the synthetic sentinel and also register a paired `__other` text key.
    const allowOther =
      (f.type === "single_select" || f.type === "multi_select") && f.allow_other;

    let base: z.ZodTypeAny;
    switch (f.type) {
      case "short_text":
        base = z.string().trim().max(500);
        break;
      case "long_text":
        base = z.string().trim().max(4000);
        break;
      case "date":
        base = z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date (YYYY-MM-DD)");
        break;
      case "single_select": {
        const values = f.options.map((o) => o.value);
        if (allowOther) values.push(OTHER_OPTION_VALUE);
        base = z.enum(values as [string, ...string[]]);
        break;
      }
      case "multi_select": {
        const values = f.options.map((o) => o.value);
        if (allowOther) values.push(OTHER_OPTION_VALUE);
        base = z.array(z.enum(values as [string, ...string[]])).max(40);
        break;
      }
      case "checkbox_ack":
        // Required ack must be literally `true`; optional ack can be missing.
        base = f.required ? z.literal(true) : z.boolean();
        break;
    }

    if (f.required && f.type !== "checkbox_ack") {
      if (f.type === "multi_select") {
        base = (base as z.ZodArray<z.ZodString>).min(
          1,
          "Please select at least one option.",
        );
      } else if (f.type === "short_text" || f.type === "long_text") {
        base = (base as z.ZodString).min(1, "This field is required.");
      }
      shape[f.id] = base;
    } else {
      // Optional — accept `undefined`/missing or empty string.
      if (f.type === "short_text" || f.type === "long_text") {
        shape[f.id] = base.optional().or(z.literal(""));
      } else if (f.type === "multi_select") {
        shape[f.id] = base.optional().default([]);
      } else {
        shape[f.id] = base.optional();
      }
    }

    // Paired free-text for the "Other" choice. Required only when the user
    // actually picked "other"; the superRefine below enforces that.
    if (allowOther) {
      shape[`${f.id}__other`] = z
        .string()
        .trim()
        .max(500)
        .optional()
        .or(z.literal(""));
    }
  }

  const obj = z.object(shape).strip();
  // Cross-field: when "Other" is the chosen option, the companion text must be
  // non-empty. Runs after per-field validation so plain required/optional
  // errors still surface correctly.
  return obj.superRefine((data, ctx) => {
    for (const f of fields) {
      if (f.type !== "single_select" && f.type !== "multi_select") continue;
      if (!f.allow_other) continue;
      const value = (data as Record<string, unknown>)[f.id];
      const otherText = (data as Record<string, unknown>)[`${f.id}__other`];
      const picked =
        f.type === "single_select"
          ? value === OTHER_OPTION_VALUE
          : Array.isArray(value) && value.includes(OTHER_OPTION_VALUE);
      if (picked) {
        const text = typeof otherText === "string" ? otherText.trim() : "";
        if (!text) {
          ctx.addIssue({
            code: "custom",
            path: [`${f.id}__other`],
            message: "Please describe your answer.",
          });
        }
      }
    }
  });
}

export type AnswersShape = Record<string, string | string[] | boolean>;

// Stable id suggestion for a new field — e.g. used by the form builder when
// the admin adds a field without manually typing an id. Lowercases ASCII
// letters from the EN label and appends a short nonce for uniqueness.
export function suggestFieldId(labelEn: string, existingIds: string[]): string {
  const base =
    labelEn
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "field";
  let candidate = base;
  let n = 1;
  while (existingIds.includes(candidate)) {
    n += 1;
    candidate = `${base}_${n}`;
  }
  return candidate;
}
