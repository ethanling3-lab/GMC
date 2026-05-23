import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase";
import type { AdminContext } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";
import {
  validateShortcut,
  type Snippet,
  type SnippetContext,
} from "./snippets-types";

// Server lib for inbox snippets. CRUD + per-conversation context resolution.
// All writes go through the service client (bypasses RLS) and audit-log the
// before/after states. Soft delete via `deleted_at`.

const COLUMNS =
  "id, shortcut, title_en, title_zh, body_en, body_zh, description_en, description_zh, created_by, updated_by, created_at, updated_at";

export type SnippetWriteInput = {
  shortcut: string;
  title_en: string;
  title_zh: string;
  body_en: string;
  body_zh: string;
  description_en?: string | null;
  description_zh?: string | null;
};

export type SnippetValidationError = {
  field:
    | "shortcut"
    | "title_en"
    | "title_zh"
    | "body_en"
    | "body_zh"
    | "shortcut_conflict";
  message: string;
};

function validateInput(
  input: Partial<SnippetWriteInput>,
  { partial = false }: { partial?: boolean } = {},
): SnippetValidationError | null {
  if (!partial || input.shortcut !== undefined) {
    if (typeof input.shortcut !== "string") {
      return { field: "shortcut", message: "Shortcut is required." };
    }
    const err = validateShortcut(input.shortcut);
    if (err) return { field: "shortcut", message: err };
  }
  const requiredText = ["title_en", "title_zh", "body_en", "body_zh"] as const;
  for (const k of requiredText) {
    if (!partial || input[k] !== undefined) {
      const v = input[k];
      if (typeof v !== "string" || !v.trim()) {
        return { field: k, message: `${k.replace("_", " ")} is required.` };
      }
      if (v.length > 4000) {
        return { field: k, message: `${k} is too long (max 4000 chars).` };
      }
    }
  }
  return null;
}

export async function listSnippets(): Promise<Snippet[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("inbox_snippets")
    .select(COLUMNS)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`listSnippets failed: ${error.message}`);
  return (data ?? []) as Snippet[];
}

export async function getSnippetById(id: string): Promise<Snippet | null> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("inbox_snippets")
    .select(COLUMNS)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`getSnippetById failed: ${error.message}`);
  return (data as Snippet | null) ?? null;
}

export async function createSnippet(
  input: SnippetWriteInput,
  admin: AdminContext,
): Promise<{ snippet?: Snippet; error?: SnippetValidationError }> {
  const validationErr = validateInput(input);
  if (validationErr) return { error: validationErr };

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("inbox_snippets")
    .insert({
      shortcut: input.shortcut.trim(),
      title_en: input.title_en.trim(),
      title_zh: input.title_zh.trim(),
      body_en: input.body_en,
      body_zh: input.body_zh,
      description_en: input.description_en?.trim() || null,
      description_zh: input.description_zh?.trim() || null,
      created_by: admin.id,
      updated_by: admin.id,
    })
    .select(COLUMNS)
    .single();

  if (error) {
    if (error.code === "23505") {
      return {
        error: {
          field: "shortcut_conflict",
          message: `Shortcut "${input.shortcut}" is already in use.`,
        },
      };
    }
    throw new Error(`createSnippet failed: ${error.message}`);
  }

  const snippet = data as Snippet;
  await writeAuditLog({
    actor_id: admin.id,
    action: "inbox.snippet_created",
    entity: "inbox_snippet",
    entity_id: snippet.id,
    after: { shortcut: snippet.shortcut, title_en: snippet.title_en },
  });

  return { snippet };
}

export async function updateSnippet(
  id: string,
  input: Partial<SnippetWriteInput>,
  admin: AdminContext,
): Promise<{ snippet?: Snippet; error?: SnippetValidationError; notFound?: boolean }> {
  const validationErr = validateInput(input, { partial: true });
  if (validationErr) return { error: validationErr };

  const existing = await getSnippetById(id);
  if (!existing) return { notFound: true };

  const supabase = createSupabaseServiceClient();
  const patch: Record<string, unknown> = {
    updated_by: admin.id,
    updated_at: new Date().toISOString(),
  };
  if (input.shortcut !== undefined) patch.shortcut = input.shortcut.trim();
  if (input.title_en !== undefined) patch.title_en = input.title_en.trim();
  if (input.title_zh !== undefined) patch.title_zh = input.title_zh.trim();
  if (input.body_en !== undefined) patch.body_en = input.body_en;
  if (input.body_zh !== undefined) patch.body_zh = input.body_zh;
  if (input.description_en !== undefined)
    patch.description_en = input.description_en?.trim() || null;
  if (input.description_zh !== undefined)
    patch.description_zh = input.description_zh?.trim() || null;

  const { data, error } = await supabase
    .from("inbox_snippets")
    .update(patch)
    .eq("id", id)
    .is("deleted_at", null)
    .select(COLUMNS)
    .single();

  if (error) {
    if (error.code === "23505") {
      return {
        error: {
          field: "shortcut_conflict",
          message: `Shortcut "${input.shortcut}" is already in use.`,
        },
      };
    }
    throw new Error(`updateSnippet failed: ${error.message}`);
  }

  const snippet = data as Snippet;
  await writeAuditLog({
    actor_id: admin.id,
    action: "inbox.snippet_updated",
    entity: "inbox_snippet",
    entity_id: snippet.id,
    before: {
      shortcut: existing.shortcut,
      title_en: existing.title_en,
    },
    after: { shortcut: snippet.shortcut, title_en: snippet.title_en },
  });

  return { snippet };
}

export async function deleteSnippet(
  id: string,
  admin: AdminContext,
): Promise<{ ok: boolean; notFound?: boolean }> {
  const existing = await getSnippetById(id);
  if (!existing) return { ok: false, notFound: true };

  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("inbox_snippets")
    .update({
      deleted_at: new Date().toISOString(),
      updated_by: admin.id,
    })
    .eq("id", id)
    .is("deleted_at", null);

  if (error) throw new Error(`deleteSnippet failed: ${error.message}`);

  await writeAuditLog({
    actor_id: admin.id,
    action: "inbox.snippet_deleted",
    entity: "inbox_snippet",
    entity_id: id,
    before: { shortcut: existing.shortcut, title_en: existing.title_en },
  });

  return { ok: true };
}

// Resolves the variable substitution context for a single conversation.
// Reads the participant + their most-recent enrollment's event. Missing
// values are simply absent from the returned dict — the client resolver
// leaves `{key}` raw when a value is missing.
export async function loadSnippetContextForConversation(
  conversationId: string,
): Promise<{ context: SnippetContext; preferredLanguage: "en" | "zh" }> {
  const supabase = createSupabaseServiceClient();

  const { data: conv, error: convErr } = await supabase
    .from("conversations")
    .select("participant_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (convErr) throw new Error(`loadSnippetContext: ${convErr.message}`);
  if (!conv?.participant_id) {
    return { context: {}, preferredLanguage: "en" };
  }

  const { data: participant } = await supabase
    .from("participants")
    .select("name_en, name_cn, region_id, phone, email, language")
    .eq("id", conv.participant_id)
    .maybeSingle();

  const context: SnippetContext = {};
  if (participant?.name_en) context.name = participant.name_en;
  if (participant?.name_cn) context.name_zh = participant.name_cn;
  if (!context.name && participant?.name_cn) context.name = participant.name_cn;
  if (!context.name_zh && participant?.name_en) context.name_zh = participant.name_en;
  if (participant?.region_id) context.region_id = participant.region_id;
  if (participant?.phone) context.phone = participant.phone;
  if (participant?.email) context.email = participant.email;

  // Most-recent enrollment (any status) → event details. We don't filter on
  // status so admins can answer questions about pending/cancelled enrolments
  // too.
  const { data: enrollments } = await supabase
    .from("enrollments")
    .select("event_id, created_at")
    .eq("participant_id", conv.participant_id)
    .order("created_at", { ascending: false })
    .limit(1);

  const eventId = enrollments?.[0]?.event_id;
  if (eventId) {
    const { data: event } = await supabase
      .from("events")
      .select("title_en, title_cn, start_date, venue")
      .eq("id", eventId)
      .maybeSingle();
    if (event?.title_en) context.event_title = event.title_en;
    if (event?.title_cn) context.event_title_zh = event.title_cn;
    if (event?.start_date) context.event_date = event.start_date;
    if (event?.venue) context.event_venue = event.venue;
  }

  const lang = participant?.language;
  const preferredLanguage: "en" | "zh" = lang === "zh" || lang === "both" ? "zh" : "en";
  return { context, preferredLanguage };
}
