import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelKey } from "./channels";
import { writeAuditLog } from "@/lib/audit";
import { waIdToE164 } from "@/lib/whatsapp/phone";

// Channel-agnostic identity resolver. Given an inbound (channel, identifier)
// pair, find the participant that owns it. If none exists, create a new
// participant with status='lead', register the identifier, and log the
// auto-creation to the audit trail.
//
// Secondary resolution path: for WhatsApp phone numbers, fall back to
// participants.phone before giving up and auto-creating. This covers the
// common case where the participant's phone is already on file from
// registration but they haven't messaged us on WhatsApp before.

export type ResolvedIdentity = {
  participant_id: string;
  created: boolean;
  linked_existing: boolean;
};

export async function resolveIdentity(
  service: SupabaseClient,
  channel: ChannelKey,
  identifier: string,
): Promise<ResolvedIdentity> {
  const normalized = normalize(channel, identifier);

  // 1. Exact match on contact_identifiers.
  const { data: existing } = await service
    .from("contact_identifiers")
    .select("participant_id")
    .eq("channel", channel)
    .eq("identifier", normalized)
    .maybeSingle();
  if (existing?.participant_id) {
    return {
      participant_id: existing.participant_id as string,
      created: false,
      linked_existing: false,
    };
  }

  // 2. Soft fallback — match by existing participant field when the channel
  //    identifier has a natural companion column.
  const softMatch = await softMatchExistingParticipant(service, channel, normalized);
  if (softMatch) {
    // Attach the identifier so the next message short-circuits at step 1.
    await service.from("contact_identifiers").insert({
      participant_id: softMatch,
      channel,
      identifier: normalized,
      verified_at: new Date().toISOString(),
    });
    await writeAuditLog({
      actor_id: null,
      action: "inbox.identifier_linked_existing",
      entity: "participants",
      entity_id: softMatch,
      metadata: { channel, identifier: normalized },
    });
    return { participant_id: softMatch, created: false, linked_existing: true };
  }

  // 3. Auto-create an unverified participant + identifier.
  const leadRow: Record<string, unknown> = {
    // Was status:'lead' before migration 053. Same meaning, narrower column:
    // nothing has confirmed this identifier belongs to a real distinct person,
    // so the AI must not be handed personal-data tools for this conversation.
    identity_confidence: "unverified",
    // Set phone at creation time for WhatsApp so later queries match naturally.
    phone: channel === "whatsapp" ? normalized : null,
    // A wa_id is already canonical, so the auto-created lead is immediately
    // matchable by the indexed lookup above — no backfill pass needed.
    phone_e164: channel === "whatsapp" ? normalized : null,
    email: channel === "email" ? normalized : null,
  };
  let { data: created, error: createErr } = await service
    .from("participants")
    .insert(leadRow)
    .select("id")
    .single();
  if (createErr && (createErr as { code?: string }).code === "42703") {
    // phone_e164 doesn't exist yet (deployed ahead of migration 052).
    const { phone_e164, ...rest } = leadRow;
    void phone_e164;
    ({ data: created, error: createErr } = await service
      .from("participants")
      .insert(rest)
      .select("id")
      .single());
  }
  if (createErr || !created) {
    throw new Error(`identity: participant insert failed: ${createErr?.message}`);
  }

  const { error: linkErr } = await service.from("contact_identifiers").insert({
    participant_id: created.id,
    channel,
    identifier: normalized,
    verified_at: new Date().toISOString(),
  });
  if (linkErr) {
    throw new Error(`identity: identifier insert failed: ${linkErr.message}`);
  }

  await writeAuditLog({
    actor_id: null,
    action: "inbox.participant_autocreated",
    entity: "participants",
    entity_id: created.id,
    metadata: { channel, identifier: normalized, via: "inbox_ingest" },
  });

  return {
    participant_id: created.id as string,
    created: true,
    linked_existing: false,
  };
}

function normalize(channel: ChannelKey, raw: string): string {
  const trimmed = raw.trim();
  if (channel === "whatsapp") {
    // Inbound identifiers are Meta wa_ids — already international, digits
    // only. See waIdToE164 for why they don't go through normalizePhone.
    return waIdToE164(trimmed);
  }
  if (channel === "email") return trimmed.toLowerCase();
  // LINE user ids are case-sensitive — don't touch them.
  return trimmed;
}

async function softMatchExistingParticipant(
  service: SupabaseClient,
  channel: ChannelKey,
  normalized: string,
): Promise<string | null> {
  if (channel === "whatsapp") {
    // Match on phone_e164 (migration 052) OR the raw phone. The raw-only
    // equality this used to do is why participants stored as '+65 86111315'
    // never matched an inbound '+6586111315' — resolveIdentity fell through
    // to step 3 and auto-created a DUPLICATE participant for someone already
    // registered, then hung their conversation off the wrong record.
    //
    // `phone` stays in the OR so an inbound message still resolves on a
    // database where the 052 backfill hasn't run.
    //
    // There is deliberately NO status/lifecycle filter here. This used to
    // carry `.neq("status","inactive")`, which meant an inactive participant
    // who messaged us failed to match their own record and step 3 created a
    // SECOND row for the same human — the exact duplicate-participant bug 052
    // set out to kill, reintroduced through a different column. A person is
    // reachable whatever we think of their engagement level.
    const { data, error } = await service
      .from("participants")
      .select("id")
      .or(`phone_e164.eq.${normalized},phone.eq.${normalized}`)
      .limit(1)
      .maybeSingle();
    // 42703 = phone_e164 doesn't exist yet (code deployed ahead of 052).
    // Retry on the raw column alone rather than auto-creating a duplicate.
    if (error && (error as { code?: string }).code === "42703") {
      const retry = await service
        .from("participants")
        .select("id")
        .eq("phone", normalized)
        .limit(1)
        .maybeSingle();
      return (retry.data as { id: string } | null)?.id ?? null;
    }
    return (data as { id: string } | null)?.id ?? null;
  }
  if (channel === "email") {
    const { data } = await service
      .from("participants")
      .select("id")
      .eq("email", normalized)
      .limit(1)
      .maybeSingle();
    return (data as { id: string } | null)?.id ?? null;
  }
  // LINE has no natural companion column on participants.
  return null;
}
