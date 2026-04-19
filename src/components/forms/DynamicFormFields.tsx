"use client";

import { Controller, type Control, type UseFormRegister, type FieldErrors } from "react-hook-form";
import type { CustomField, FormSchema } from "@/lib/event-form-schema";
import {
  AcknowledgementBlock,
  CheckboxGroup,
  FieldBlock,
  RadioGroup,
  SectionHeaderBlock,
  SelectField,
  TextField,
  TextareaField,
} from "./_primitives";

// Renders the custom-fields portion of a registration form based on the
// event's FormSchema. Expects react-hook-form's `register`/`control`/`errors`
// to be scoped under `answers.*` (e.g. `register("answers.empowerments")`).

type AnswersErrors = Record<string, { message?: string } | undefined>;

type Props = {
  schema: FormSchema;
  locale: "zh" | "en";
  register: UseFormRegister<{ answers: Record<string, unknown> }>;
  errors: FieldErrors<{ answers: Record<string, unknown> }>;
  control: Control<{ answers: Record<string, unknown> }>;
};

function pickLabel(f: CustomField, locale: "zh" | "en"): string {
  const primary = locale === "zh" ? f.label_cn : f.label_en;
  const fallback = locale === "zh" ? f.label_en : f.label_cn;
  return (primary || fallback || "").trim();
}

function pickHint(f: CustomField, locale: "zh" | "en"): string | undefined {
  const primary = locale === "zh" ? f.hint_cn : f.hint_en;
  const fallback = locale === "zh" ? f.hint_en : f.hint_cn;
  const value = (primary || fallback || "").trim();
  return value.length ? value : undefined;
}

function pickOptionLabel(
  o: { label_en: string; label_cn: string; value: string },
  locale: "zh" | "en",
): string {
  const primary = locale === "zh" ? o.label_cn : o.label_en;
  const fallback = locale === "zh" ? o.label_en : o.label_cn;
  return (primary || fallback || o.value).trim();
}

export function DynamicFormFields({
  schema,
  locale,
  register,
  errors,
  control,
}: Props) {
  if (!schema.fields.length) return null;
  const answerErrors = (errors.answers as unknown as AnswersErrors) ?? {};

  return (
    <div className="flex flex-col gap-8">
      {schema.fields.map((f) => {
        const label = pickLabel(f, locale);
        const hint = pickHint(f, locale);
        const err = answerErrors[f.id]?.message;

        if (f.type === "section_header") {
          return (
            <SectionHeaderBlock
              key={f.id}
              labelEn={f.label_en}
              labelCn={f.label_cn}
              hintEn={f.hint_en}
              hintCn={f.hint_cn}
              locale={locale}
            />
          );
        }

        if (f.type === "short_text") {
          return (
            <FieldBlock
              key={f.id}
              label={label}
              hint={hint}
              required={f.required}
              error={err}
            >
              <TextField
                {...register(`answers.${f.id}` as const)}
                error={!!err}
              />
            </FieldBlock>
          );
        }

        if (f.type === "long_text") {
          return (
            <FieldBlock
              key={f.id}
              label={label}
              hint={hint}
              required={f.required}
              error={err}
            >
              <TextareaField
                {...register(`answers.${f.id}` as const)}
                error={!!err}
              />
            </FieldBlock>
          );
        }

        if (f.type === "date") {
          return (
            <FieldBlock
              key={f.id}
              label={label}
              hint={hint}
              required={f.required}
              error={err}
            >
              <TextField
                type="date"
                {...register(`answers.${f.id}` as const)}
                error={!!err}
              />
            </FieldBlock>
          );
        }

        if (f.type === "single_select") {
          // Use a native <select> if >5 options, radio cards otherwise.
          if (f.options.length > 5) {
            return (
              <FieldBlock
                key={f.id}
                label={label}
                hint={hint}
                required={f.required}
                error={err}
              >
                <SelectField
                  {...register(`answers.${f.id}` as const)}
                  error={!!err}
                >
                  <option value="">
                    {locale === "zh" ? "请选择…" : "Please select…"}
                  </option>
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {pickOptionLabel(o, locale)}
                    </option>
                  ))}
                </SelectField>
              </FieldBlock>
            );
          }
          return (
            <FieldBlock
              key={f.id}
              label={label}
              hint={hint}
              required={f.required}
              error={err}
            >
              <Controller
                control={control}
                name={`answers.${f.id}` as const}
                render={({ field }) => (
                  <RadioGroup
                    name={`answers.${f.id}`}
                    value={
                      typeof field.value === "string"
                        ? field.value
                        : undefined
                    }
                    onChange={(v) => field.onChange(v)}
                    options={f.options.map((o) => ({
                      value: o.value,
                      label: pickOptionLabel(o, locale),
                    }))}
                    error={!!err}
                  />
                )}
              />
            </FieldBlock>
          );
        }

        if (f.type === "multi_select") {
          return (
            <FieldBlock
              key={f.id}
              label={label}
              hint={hint}
              required={f.required}
              error={err}
            >
              <Controller
                control={control}
                name={`answers.${f.id}` as const}
                render={({ field }) => (
                  <CheckboxGroup
                    name={`answers.${f.id}`}
                    values={Array.isArray(field.value) ? (field.value as string[]) : []}
                    onChange={(v) => field.onChange(v)}
                    options={f.options.map((o) => ({
                      value: o.value,
                      label: pickOptionLabel(o, locale),
                    }))}
                    error={!!err}
                  />
                )}
              />
            </FieldBlock>
          );
        }

        if (f.type === "checkbox_ack") {
          return (
            <Controller
              key={f.id}
              control={control}
              name={`answers.${f.id}` as const}
              render={({ field }) => (
                <AcknowledgementBlock
                  labelEn={f.label_en}
                  labelCn={f.label_cn}
                  hintEn={f.hint_en}
                  hintCn={f.hint_cn}
                  locale={locale}
                  required={f.required}
                  error={err}
                  checked={field.value === true}
                  onChange={(next) => field.onChange(next)}
                />
              )}
            />
          );
        }

        return null;
      })}
    </div>
  );
}
