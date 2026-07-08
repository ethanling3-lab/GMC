import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase";
import type { AdminContext } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";
import {
  validateSlug,
  validateAbbrev,
  validateName,
  validatePrice,
  validateValidityMonths,
  type Programme,
} from "./types";

// Server lib for the admin-managed programmes list. All writes go through
// the service client (bypasses RLS) + audit log. Programmes are never hard
// deleted (they're referenced by participants + price tiers) — they are
// deactivated (active=false). The `slug` is the pricing contract and is
// immutable after creation.

const COLUMNS =
  "id, slug, name_en, name_cn, abbrev, validity_months, price_sgd, on_site_sgd, active, sort_order, created_at, updated_at";

type ProgrammeRow = Omit<Programme, "price_sgd" | "on_site_sgd"> & {
  price_sgd: number | string;
  on_site_sgd: number | string | null;
};

// Postgres `numeric` arrives as a string via PostgREST — coerce to number.
function normalize(row: ProgrammeRow): Programme {
  return {
    ...row,
    price_sgd: Number(row.price_sgd),
    on_site_sgd: row.on_site_sgd == null ? null : Number(row.on_site_sgd),
  };
}

export type ProgrammeWriteInput = {
  slug: string;
  name_en: string;
  name_cn: string;
  abbrev: string;
  validity_months: number | null;
  price_sgd: number;
  on_site_sgd: number | null;
  active?: boolean;
  sort_order?: number;
};

export type ProgrammeValidationError = {
  field:
    | "slug"
    | "name_en"
    | "name_cn"
    | "abbrev"
    | "price_sgd"
    | "on_site_sgd"
    | "validity_months"
    | "slug_conflict";
  message: string;
};

function validateInput(
  input: Partial<ProgrammeWriteInput>,
  { partial = false }: { partial?: boolean } = {},
): ProgrammeValidationError | null {
  if (!partial || input.slug !== undefined) {
    if (typeof input.slug !== "string") return { field: "slug", message: "Slug is required." };
    const err = validateSlug(input.slug);
    if (err) return { field: "slug", message: err };
  }
  if (!partial || input.name_en !== undefined) {
    const err = validateName(input.name_en ?? "", "English name");
    if (err) return { field: "name_en", message: err };
  }
  if (!partial || input.name_cn !== undefined) {
    const err = validateName(input.name_cn ?? "", "Chinese name");
    if (err) return { field: "name_cn", message: err };
  }
  if (!partial || input.abbrev !== undefined) {
    const err = validateAbbrev(input.abbrev ?? "");
    if (err) return { field: "abbrev", message: err };
  }
  if (!partial || input.price_sgd !== undefined) {
    const err = validatePrice(Number(input.price_sgd), "Price");
    if (err) return { field: "price_sgd", message: err };
  }
  if (input.on_site_sgd !== undefined && input.on_site_sgd !== null) {
    const err = validatePrice(Number(input.on_site_sgd), "On-site price");
    if (err) return { field: "on_site_sgd", message: err };
  }
  if (!partial || input.validity_months !== undefined) {
    const err = validateValidityMonths(input.validity_months ?? null);
    if (err) return { field: "validity_months", message: err };
  }
  return null;
}

export async function listProgrammes(
  { includeInactive = false }: { includeInactive?: boolean } = {},
): Promise<Programme[]> {
  const supabase = createSupabaseServiceClient();
  let query = supabase
    .from("programmes")
    .select(COLUMNS)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (!includeInactive) query = query.eq("active", true);
  const { data, error } = await query;
  if (error) throw new Error(`listProgrammes failed: ${error.message}`);
  return ((data ?? []) as ProgrammeRow[]).map(normalize);
}

export async function getProgrammeById(id: string): Promise<Programme | null> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("programmes")
    .select(COLUMNS)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`getProgrammeById failed: ${error.message}`);
  return data ? normalize(data as ProgrammeRow) : null;
}

export async function createProgramme(
  input: ProgrammeWriteInput,
  admin: AdminContext,
): Promise<{ programme?: Programme; error?: ProgrammeValidationError }> {
  const validationErr = validateInput(input);
  if (validationErr) return { error: validationErr };

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("programmes")
    .insert({
      slug: input.slug.trim(),
      name_en: input.name_en.trim(),
      name_cn: input.name_cn.trim(),
      abbrev: input.abbrev.trim(),
      validity_months: input.validity_months,
      price_sgd: input.price_sgd,
      on_site_sgd: input.on_site_sgd,
      active: input.active ?? true,
      sort_order: input.sort_order ?? 0,
      created_by: admin.id,
      updated_by: admin.id,
    })
    .select(COLUMNS)
    .single();

  if (error) {
    if (error.code === "23505") {
      return { error: { field: "slug_conflict", message: `Slug "${input.slug}" is already in use.` } };
    }
    throw new Error(`createProgramme failed: ${error.message}`);
  }

  const programme = normalize(data as ProgrammeRow);
  await writeAuditLog({
    actor_id: admin.id,
    action: "programme.created",
    entity: "programme",
    entity_id: programme.id,
    after: { slug: programme.slug, name_en: programme.name_en, price_sgd: programme.price_sgd },
  });
  return { programme };
}

// `slug` is intentionally omitted — it's immutable after creation (the
// pricing contract). All other fields, including `active`, are editable.
export async function updateProgramme(
  id: string,
  input: Partial<Omit<ProgrammeWriteInput, "slug">>,
  admin: AdminContext,
): Promise<{ programme?: Programme; error?: ProgrammeValidationError; notFound?: boolean }> {
  const validationErr = validateInput(input, { partial: true });
  if (validationErr) return { error: validationErr };

  const existing = await getProgrammeById(id);
  if (!existing) return { notFound: true };

  const supabase = createSupabaseServiceClient();
  const patch: Record<string, unknown> = {
    updated_by: admin.id,
    updated_at: new Date().toISOString(),
  };
  if (input.name_en !== undefined) patch.name_en = input.name_en.trim();
  if (input.name_cn !== undefined) patch.name_cn = input.name_cn.trim();
  if (input.abbrev !== undefined) patch.abbrev = input.abbrev.trim();
  if (input.validity_months !== undefined) patch.validity_months = input.validity_months;
  if (input.price_sgd !== undefined) patch.price_sgd = input.price_sgd;
  if (input.on_site_sgd !== undefined) patch.on_site_sgd = input.on_site_sgd;
  if (input.active !== undefined) patch.active = input.active;
  if (input.sort_order !== undefined) patch.sort_order = input.sort_order;

  const { data, error } = await supabase
    .from("programmes")
    .update(patch)
    .eq("id", id)
    .is("deleted_at", null)
    .select(COLUMNS)
    .single();
  if (error) throw new Error(`updateProgramme failed: ${error.message}`);

  const programme = normalize(data as ProgrammeRow);
  const reactivated = input.active === true && !existing.active;
  await writeAuditLog({
    actor_id: admin.id,
    action: reactivated ? "programme.reactivated" : "programme.updated",
    entity: "programme",
    entity_id: programme.id,
    before: { name_en: existing.name_en, price_sgd: existing.price_sgd, active: existing.active },
    after: { name_en: programme.name_en, price_sgd: programme.price_sgd, active: programme.active },
  });
  return { programme };
}

// Soft "delete" = deactivate. Programmes stay in the table (referenced by
// participants + price tiers); they just drop out of pickers.
export async function deactivateProgramme(
  id: string,
  admin: AdminContext,
): Promise<{ ok: boolean; notFound?: boolean }> {
  const existing = await getProgrammeById(id);
  if (!existing) return { ok: false, notFound: true };
  if (!existing.active) return { ok: true };

  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("programmes")
    .update({ active: false, updated_by: admin.id, updated_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null);
  if (error) throw new Error(`deactivateProgramme failed: ${error.message}`);

  await writeAuditLog({
    actor_id: admin.id,
    action: "programme.deactivated",
    entity: "programme",
    entity_id: id,
    before: { slug: existing.slug, name_en: existing.name_en },
  });
  return { ok: true };
}
