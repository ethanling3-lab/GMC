import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toE164OrNull } from "@/lib/whatsapp/phone";

// Shared participant upsert helper. Both the public /api/register route and
// the admin manual-enrol route funnel through here so the participant insert
// shape (and the migration-009 fallback for referrer columns) is in one place.
//
// This is also where `phone_e164` is derived (migration 052). Deriving it at
// WRITE time is what lets the inbound webhook match an incoming wa_id with a
// single indexed equality — a normalise-on-read helper cannot be indexed, and
// that is exactly why identity.softMatchExistingParticipant was silently
// auto-creating duplicate participants for anyone whose stored number carried
// a space. See src/lib/whatsapp/phone.ts.

export type ParticipantInsertInput = {
  name_en: string;
  name_cn?: string | null;
  email: string;
  phone: string;
  region: string;
  language_fluency?: "en" | "cn" | "both" | null;
  gender?: string | null;
  birth_date?: string | null;
  occupation?: string | null;
  industry?: string | null;
  status?: "new" | "info_verified" | "cs_enriched" | "active" | "inactive";
  referrer_name?: string | null;
  referrer_contact?: string | null;
  is_old_student?: boolean;
  facial_recognition_consent?: boolean;
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
    // Raw `phone` above is kept verbatim — it is the evidence when a send
    // fails. Null here means unnormalisable (contradictory country code, or
    // no country code and an unknown region); the row still saves, and
    // scripts/backfill-phone-e164.ts lists it for a human.
    phone_e164: toE164OrNull(input.phone, input.region),
    region: input.region,
    language_fluency: input.language_fluency ?? null,
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
  if (typeof input.facial_recognition_consent === "boolean") {
    payload.facial_recognition_consent = input.facial_recognition_consent;
  }
  return payload;
}

// Columns that may not exist yet on a database this build is deployed
// against: referrer_* predate migration 009, phone_e164 arrives in 052. On
// 42703 (column does not exist) they are dropped and the write is retried, so
// the app stays deployable ahead of its migrations.
function withoutOptionalColumns(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const { referrer_name, referrer_contact, phone_e164, ...rest } = payload;
  void referrer_name;
  void referrer_contact;
  void phone_e164;
  return rest;
}

async function safeUpdate(
  client: SupabaseClient,
  id: string,
  payload: Record<string, unknown>,
) {
  const res = await client.from("participants").update(payload).eq("id", id);
  if (res.error && (res.error as { code?: string }).code === "42703") {
    return client
      .from("participants")
      .update(withoutOptionalColumns(payload))
      .eq("id", id);
  }
  return res;
}

async function safeInsert(
  client: SupabaseClient,
  payload: Record<string, unknown>,
) {
  // Migration 012 dropped the auto-assign trigger, so participant inserts
  // land with region_id = NULL until an admin approves. The participant_id
  // is allocated by the database default; nothing to retry here.
  // 42703 = column does not exist. Drop the optional columns and retry once.
  const primary = await client
    .from("participants")
    .insert(payload)
    .select("id, region_id")
    .single();
  if (primary.error && (primary.error as { code?: string }).code === "42703") {
    return client
      .from("participants")
      .insert(withoutOptionalColumns(payload))
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
