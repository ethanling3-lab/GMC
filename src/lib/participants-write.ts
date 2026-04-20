import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Shared participant upsert helper. Both the public /api/register route and
// the admin manual-enrol route funnel through here so the participant insert
// shape (and the migration-009 fallback for referrer columns) is in one place.

export type ParticipantInsertInput = {
  name_en: string;
  name_cn?: string | null;
  email: string;
  phone: string;
  region: string;
  language?: string | null;
  gender?: string | null;
  birth_date?: string | null;
  occupation?: string | null;
  industry?: string | null;
  status?: "new" | "info_verified" | "cs_enriched" | "active" | "inactive";
  referrer_name?: string | null;
  referrer_contact?: string | null;
  is_old_student?: boolean;
};

export type ParticipantUpsertResult = {
  id: string;
  region_id: string | null;
  /** True when a new participant row was created, false when an existing one was matched + updated. */
  created: boolean;
};

function buildPayload(input: ParticipantInsertInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name_cn: input.name_cn ?? null,
    name_en: input.name_en,
    email: input.email,
    phone: input.phone,
    region: input.region,
    language: input.language ?? null,
    gender: input.gender ?? null,
    birth_date: input.birth_date || null,
    occupation: input.occupation || null,
    industry: input.industry || null,
    status: input.status ?? "new",
  };
  if (input.referrer_name && input.referrer_name.trim()) {
    payload.referrer_name = input.referrer_name.trim();
  }
  if (input.referrer_contact && input.referrer_contact.trim()) {
    payload.referrer_contact = input.referrer_contact.trim();
  }
  if (typeof input.is_old_student === "boolean") {
    payload.is_old_student = input.is_old_student;
  }
  return payload;
}

// Strips referrer_* and retries when the column doesn't exist (pre-009).
async function safeUpdate(
  client: SupabaseClient,
  id: string,
  payload: Record<string, unknown>,
) {
  const res = await client.from("participants").update(payload).eq("id", id);
  if (res.error && (res.error as { code?: string }).code === "42703") {
    const { referrer_name, referrer_contact, ...rest } = payload;
    void referrer_name;
    void referrer_contact;
    return client.from("participants").update(rest).eq("id", id);
  }
  return res;
}

async function safeInsert(
  client: SupabaseClient,
  payload: Record<string, unknown>,
) {
  const primary = await client
    .from("participants")
    .insert(payload)
    .select("id, region_id")
    .single();
  if (primary.error && (primary.error as { code?: string }).code === "42703") {
    const { referrer_name, referrer_contact, ...rest } = payload;
    void referrer_name;
    void referrer_contact;
    return client
      .from("participants")
      .insert(rest)
      .select("id, region_id")
      .single();
  }
  return primary;
}

/**
 * Upserts a participant by (email, phone). Returns the canonical id +
 * region_id, plus whether the row was newly created. The caller is
 * responsible for any audit logging — this helper is intentionally silent so
 * it can be used from public + admin paths the same way.
 */
export async function upsertParticipant(
  client: SupabaseClient,
  input: ParticipantInsertInput,
): Promise<ParticipantUpsertResult> {
  const payload = buildPayload(input);

  const { data: existing } = await client
    .from("participants")
    .select("id, region_id")
    .eq("email", input.email)
    .eq("phone", input.phone)
    .maybeSingle();

  if (existing) {
    const upd = await safeUpdate(client, existing.id, payload);
    if (upd.error) throw new Error(upd.error.message);
    return {
      id: existing.id,
      region_id: existing.region_id,
      created: false,
    };
  }

  const ins = await safeInsert(client, payload);
  if (ins.error || !ins.data) {
    throw new Error(ins.error?.message ?? "participant_insert_failed");
  }
  return {
    id: ins.data.id,
    region_id: ins.data.region_id,
    created: true,
  };
}

/**
 * Looks up a participant by id and returns the canonical id + region_id,
 * applying the same `participantPayload` overlay used during upsert. This
 * is the prefill-token path used by /api/register.
 */
export async function updateExistingParticipant(
  client: SupabaseClient,
  id: string,
  input: ParticipantInsertInput,
): Promise<ParticipantUpsertResult | null> {
  const { data: row } = await client
    .from("participants")
    .select("id, region_id")
    .eq("id", id)
    .maybeSingle();
  if (!row) return null;
  const payload = buildPayload(input);
  const upd = await safeUpdate(client, row.id, payload);
  if (upd.error) throw new Error(upd.error.message);
  return { id: row.id, region_id: row.region_id, created: false };
}
