import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase";
import type { AdminContext } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";
import {
  SAVED_VIEW_NAME_MAX,
  hasActiveFilters,
  validateSavedViewName,
  type SavedView,
  type SavedViewFilters,
} from "./saved-views-types";

// Server lib for inbox saved views. CRUD scoped to the caller — every
// query filters by `created_by = admin.id` so admins can only see + act
// on their own presets. Writes flow through the service client (bypasses
// RLS) and call writeAuditLog. Soft delete via `deleted_at`.

const COLUMNS = "id, name, filters, created_at, updated_at";

export type SavedViewWriteInput = {
  name: string;
  filters: SavedViewFilters;
};

export type SavedViewValidationError = {
  field: "name" | "filters" | "name_conflict";
  message: string;
};

function validateInput(input: SavedViewWriteInput): SavedViewValidationError | null {
  const nameErr = validateSavedViewName(input.name);
  if (nameErr) return { field: "name", message: nameErr };
  if (!input.filters || typeof input.filters !== "object") {
    return { field: "filters", message: "Filters payload is required." };
  }
  if (!hasActiveFilters(input.filters)) {
    return {
      field: "filters",
      message: "Pick at least one filter before saving a view.",
    };
  }
  return null;
}

export async function listSavedViewsForAdmin(admin: AdminContext): Promise<SavedView[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("inbox_saved_views")
    .select(COLUMNS)
    .eq("created_by", admin.id)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`listSavedViewsForAdmin failed: ${error.message}`);
  return (data ?? []) as SavedView[];
}

export async function createSavedView(
  input: SavedViewWriteInput,
  admin: AdminContext,
): Promise<{ view?: SavedView; error?: SavedViewValidationError }> {
  const validationErr = validateInput(input);
  if (validationErr) return { error: validationErr };

  const supabase = createSupabaseServiceClient();
  const trimmedName = input.name.trim();
  const { data, error } = await supabase
    .from("inbox_saved_views")
    .insert({
      name: trimmedName.slice(0, SAVED_VIEW_NAME_MAX),
      filters: input.filters,
      created_by: admin.id,
      updated_by: admin.id,
    })
    .select(COLUMNS)
    .single();

  if (error) {
    // 23505 = unique-violation on (created_by, lower(name)) live partial index.
    if (error.code === "23505") {
      return {
        error: {
          field: "name_conflict",
          message: `You already have a saved view named "${trimmedName}".`,
        },
      };
    }
    throw new Error(`createSavedView failed: ${error.message}`);
  }

  const view = data as SavedView;
  await writeAuditLog({
    actor_id: admin.id,
    action: "inbox.saved_view_created",
    entity: "inbox_saved_views",
    entity_id: view.id,
    before: null,
    after: { name: view.name, filters: view.filters },
    metadata: {},
  });
  return { view };
}

export async function softDeleteSavedView(
  id: string,
  admin: AdminContext,
): Promise<{ ok: true } | { error: "not_found" | "forbidden" }> {
  const supabase = createSupabaseServiceClient();

  // Load first so we can (a) confirm ownership and (b) carry before-state
  // into the audit row.
  const { data: row, error: loadErr } = await supabase
    .from("inbox_saved_views")
    .select("id, name, filters, created_by, deleted_at")
    .eq("id", id)
    .maybeSingle();
  if (loadErr) throw new Error(`softDeleteSavedView load failed: ${loadErr.message}`);
  if (!row || row.deleted_at) return { error: "not_found" };
  if (row.created_by !== admin.id) return { error: "forbidden" };

  const { error: updErr } = await supabase
    .from("inbox_saved_views")
    .update({ deleted_at: new Date().toISOString(), updated_by: admin.id })
    .eq("id", id);
  if (updErr) throw new Error(`softDeleteSavedView update failed: ${updErr.message}`);

  await writeAuditLog({
    actor_id: admin.id,
    action: "inbox.saved_view_deleted",
    entity: "inbox_saved_views",
    entity_id: id,
    before: { name: row.name, filters: row.filters },
    after: null,
    metadata: {},
  });

  return { ok: true };
}
