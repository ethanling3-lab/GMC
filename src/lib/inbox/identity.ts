import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelKey } from "./channels";
import { writeAuditLog } from "@/lib/audit";

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

  // 3. Auto-create a lead participant + identifier.
  const { data: created, error: createErr } = await service
    .from("participants")
    .insert({
      status: "lead",
      // Set phone at creation time for WhatsApp so later queries match naturally.
      phone: channel === "whatsapp" ? normalized : null,
      email: channel === "email" ? normalized : null,
    })
    .select("id")
    .single();
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
    // Ensure leading '+', digits-only suffix — keeps us compatible with
    // participants.phone which stores '+<digits>'.
    const digits = trimmed.replace(/[^\d]/g, "");
    return digits ? `+${digits}` : trimmed;
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
    const { data } = await service
      .from("participants")
      .select("id")
      .eq("phone", normalized)
      .neq("status", "inactive")
      .limit(1)
      .maybeSingle();
    return (data as { id: string } | null)?.id ?? null;
  }
  if (channel === "email") {
    const { data } = await service
      .from("participants")
      .select("id")
      .eq("email", normalized)
      .neq("status", "inactive")
      .limit(1)
      .maybeSingle();
    return (data as { id: string } | null)?.id ?? null;
  }
  // LINE has no natural companion column on participants.
  return null;
}
