import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase";
import type { AdminContext } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";
import {
  validateColor,
  validateSlug,
  type Tag,
} from "./tags-types";

// Server lib for inbox tag definitions + per-conversation apply/remove.
// All writes go through the service client (bypasses RLS) + audit-log.
// Soft delete via `deleted_at`; slug becomes reusable after delete.

const COLUMNS =
  "id, slug, label_en, label_zh, color, created_by, updated_by, created_at, updated_at";

export type TagWriteInput = {
  slug: string;
  label_en: string;
  label_zh: string;
  color: string;
};

export type TagValidationError = {
  field: "slug" | "label_en" | "label_zh" | "color" | "slug_conflict";
  message: string;
};

function validateInput(
  input: Partial<TagWriteInput>,
  { partial = false }: { partial?: boolean } = {},
): TagValidationError | null {
  if (!partial || input.slug !== undefined) {
    if (typeof input.slug !== "string") return { field: "slug", message: "Slug is required." };
    const err = validateSlug(input.slug);
    if (err) return { field: "slug", message: err };
  }
  const labelChecks = ["label_en", "label_zh"] as const;
  for (const k of labelChecks) {
    if (!partial || input[k] !== undefined) {
      const v = input[k];
      if (typeof v !== "string" || !v.trim()) {
        return { field: k, message: `${k.replace("_", " ")} is required.` };
      }
      if (v.length > 60) {
        return { field: k, message: `${k} is too long (max 60 chars).` };
      }
    }
  }
  if (!partial || input.color !== undefined) {
    if (typeof input.color !== "string") return { field: "color", message: "Colour is required." };
    const err = validateColor(input.color);
    if (err) return { field: "color", message: err };
  }
  return null;
}

export async function listTags(): Promise<Tag[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("inbox_tags")
    .select(COLUMNS)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`listTags failed: ${error.message}`);
  return (data ?? []) as Tag[];
}

export async function getTagById(id: string): Promise<Tag | null> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("inbox_tags")
    .select(COLUMNS)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`getTagById failed: ${error.message}`);
  return (data as Tag | null) ?? null;
}

export async function createTag(
  input: TagWriteInput,
  admin: AdminContext,
): Promise<{ tag?: Tag; error?: TagValidationError }> {
  const validationErr = validateInput(input);
  if (validationErr) return { error: validationErr };

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("inbox_tags")
    .insert({
      slug: input.slug.trim(),
      label_en: input.label_en.trim(),
      label_zh: input.label_zh.trim(),
      color: input.color.trim(),
      created_by: admin.id,
      updated_by: admin.id,
    })
    .select(COLUMNS)
    .single();

  if (error) {
    if (error.code === "23505") {
      return {
        error: {
          field: "slug_conflict",
          message: `Slug "${input.slug}" is already in use.`,
        },
      };
    }
    throw new Error(`createTag failed: ${error.message}`);
  }

  const tag = data as Tag;
  await writeAuditLog({
    actor_id: admin.id,
    action: "inbox.tag_created",
    entity: "inbox_tag",
    entity_id: tag.id,
    after: { slug: tag.slug, label_en: tag.label_en, color: tag.color },
  });
  return { tag };
}

export async function updateTag(
  id: string,
  input: Partial<TagWriteInput>,
  admin: AdminContext,
): Promise<{ tag?: Tag; error?: TagValidationError; notFound?: boolean }> {
  const validationErr = validateInput(input, { partial: true });
  if (validationErr) return { error: validationErr };

  const existing = await getTagById(id);
  if (!existing) return { notFound: true };

  const supabase = createSupabaseServiceClient();
  const patch: Record<string, unknown> = {
    updated_by: admin.id,
    updated_at: new Date().toISOString(),
  };
  if (input.slug !== undefined) patch.slug = input.slug.trim();
  if (input.label_en !== undefined) patch.label_en = input.label_en.trim();
  if (input.label_zh !== undefined) patch.label_zh = input.label_zh.trim();
  if (input.color !== undefined) patch.color = input.color.trim();

  const { data, error } = await supabase
    .from("inbox_tags")
    .update(patch)
    .eq("id", id)
    .is("deleted_at", null)
    .select(COLUMNS)
    .single();

  if (error) {
    if (error.code === "23505") {
      return {
        error: {
          field: "slug_conflict",
          message: `Slug "${input.slug}" is already in use.`,
        },
      };
    }
    throw new Error(`updateTag failed: ${error.message}`);
  }

  const tag = data as Tag;
  await writeAuditLog({
    actor_id: admin.id,
    action: "inbox.tag_updated",
    entity: "inbox_tag",
    entity_id: tag.id,
    before: { slug: existing.slug, label_en: existing.label_en, color: existing.color },
    after: { slug: tag.slug, label_en: tag.label_en, color: tag.color },
  });
  return { tag };
}

export async function deleteTag(
  id: string,
  admin: AdminContext,
): Promise<{ ok: boolean; notFound?: boolean }> {
  const existing = await getTagById(id);
  if (!existing) return { ok: false, notFound: true };

  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("inbox_tags")
    .update({
      deleted_at: new Date().toISOString(),
      updated_by: admin.id,
    })
    .eq("id", id)
    .is("deleted_at", null);

  if (error) throw new Error(`deleteTag failed: ${error.message}`);

  await writeAuditLog({
    actor_id: admin.id,
    action: "inbox.tag_deleted",
    entity: "inbox_tag",
    entity_id: id,
    before: { slug: existing.slug, label_en: existing.label_en },
  });
  return { ok: true };
}

// -----------------------------------------------------------------------------
// Per-conversation apply / remove. Modifies `conversations.tags text[]`
// idempotently — adding an already-present slug is a no-op, same for remove.
// -----------------------------------------------------------------------------

async function loadConversationTags(conversationId: string): Promise<string[] | null> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("conversations")
    .select("tags")
    .eq("id", conversationId)
    .maybeSingle();
  if (error) throw new Error(`loadConversationTags: ${error.message}`);
  if (!data) return null;
  return Array.isArray(data.tags) ? (data.tags as string[]) : [];
}

export async function applyTagToConversation(
  conversationId: string,
  slug: string,
  admin: AdminContext,
): Promise<{ tags?: string[]; notFound?: boolean }> {
  const current = await loadConversationTags(conversationId);
  if (current === null) return { notFound: true };
  if (current.includes(slug)) return { tags: current };

  const next = [...current, slug];
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("conversations")
    .update({ tags: next })
    .eq("id", conversationId);
  if (error) throw new Error(`applyTagToConversation failed: ${error.message}`);

  await writeAuditLog({
    actor_id: admin.id,
    action: "inbox.conversation_tagged",
    entity: "conversation",
    entity_id: conversationId,
    metadata: { slug },
  });
  return { tags: next };
}

export async function removeTagFromConversation(
  conversationId: string,
  slug: string,
  admin: AdminContext,
): Promise<{ tags?: string[]; notFound?: boolean }> {
  const current = await loadConversationTags(conversationId);
  if (current === null) return { notFound: true };
  if (!current.includes(slug)) return { tags: current };

  const next = current.filter((s) => s !== slug);
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("conversations")
    .update({ tags: next })
    .eq("id", conversationId);
  if (error) throw new Error(`removeTagFromConversation failed: ${error.message}`);

  await writeAuditLog({
    actor_id: admin.id,
    action: "inbox.conversation_untagged",
    entity: "conversation",
    entity_id: conversationId,
    metadata: { slug },
  });
  return { tags: next };
}
