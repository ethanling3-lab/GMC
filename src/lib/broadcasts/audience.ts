import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminContext } from "@/lib/admin-guard";
import type {
  AudienceFilter,
  BroadcastChannel,
  EventCohortFilter,
  ParticipantMasterFilter,
} from "./types";
import { loadEventCohort, type EventCohortRow } from "./event-cohort-query";
import {
  applyParticipantFilters,
  type ParticipantFilters,
} from "@/lib/participants-query";
import { toE164OrNull } from "@/lib/whatsapp/phone";

// Audience resolver — returns the (participant × channel) leaves the
// fan-out will deliver to. Two modes; both end at the same Recipient shape.
//
// NO ROLE GATE. Any send-capable role resolves the full list in both modes.
// `excluded_out_of_region` survives as a SOFT SIGNAL only — it is counted and
// surfaced in the composer so a cross-region send is a visible choice, but it
// removes nobody. See the note in resolveAudience for the reasoning.
//
// Addresses:
//   - WhatsApp = contact_identifiers (channel='whatsapp', identifier=E.164)
//     If no contact_identifier row exists, falls back to participants.phone
//     (matching the soft-fallback in inbox/identity.ts).
//   - Email = participants.email
//
// A participant with no address for any selected channel is excluded
// (excluded_no_address counter). A participant with an address for one
// of two selected channels generates exactly one Recipient (the one they
// can be reached on) — not two.

export type AudienceRecipient = {
  participant_id: string;
  enrollment_id: string | null;
  name_cn: string | null;
  name_en: string | null;
  region_id: string | null;
  region: string | null;
  language_fluency: "en" | "cn" | "both" | null;
  // Per-channel resolved address. Null = recipient won't get this channel.
  addresses: Record<BroadcastChannel, string | null>;
};

export type AudienceResolution = {
  recipients: AudienceRecipient[];
  total_matched: number;
  excluded_no_address: number;
  excluded_out_of_region: number;
};

export type AudienceCountPreview = {
  matched: number;
  reachable: number;
};

export async function resolveAudience(
  service: SupabaseClient,
  admin: AdminContext,
  filter: AudienceFilter,
  channels: BroadcastChannel[],
): Promise<AudienceResolution> {
  if (channels.length === 0) {
    return { recipients: [], total_matched: 0, excluded_no_address: 0, excluded_out_of_region: 0 };
  }

  // OUTREACH IS NOT ROLE-SCOPED (decision, 2026-08-11).
  //
  // This used to force a regional_lead's audience to their own region and to
  // narrow a customer_service audience to their assigned participants. Both
  // gates are gone: any send-capable role may target the full list, because
  // "who can I reach" and "whose record may I edit" are different questions
  // and only the second one is a permission.
  //
  // The tradeoff is real and accepted — a regional lead can now message
  // another region. The mitigation is visibility, not prohibition: the
  // out-of-region count below is still computed and still surfaced in the
  // composer, so a cross-region send is always a visible choice rather than
  // an accident.
  const baseRows: BaseRow[] =
    filter.mode === "event_cohort"
      ? (await loadEventCohort(service, filter)).map(eventRowToBase)
      : await loadParticipantMaster(service, filter);

  let excluded_out_of_region = 0;
  if (admin.role === "regional_lead" && admin.region) {
    excluded_out_of_region = baseRows.filter((r) => r.region && r.region !== admin.region).length;
  }
  const visibleRows = baseRows;

  // Resolve addresses. WhatsApp via contact_identifiers join; email from
  // the participant row we already have.
  const participantIds = visibleRows.map((r) => r.participant_id);
  const whatsappAddresses = channels.includes("whatsapp")
    ? await loadWhatsAppAddresses(service, participantIds)
    : new Map<string, string>();

  const recipients: AudienceRecipient[] = [];
  let excluded_no_address = 0;
  for (const r of visibleRows) {
    const addresses: Record<BroadcastChannel, string | null> = {
      whatsapp: null,
      email: null,
    };
    if (channels.includes("whatsapp")) {
      // Identifier table is canonical; phone is fallback (mirrors the
      // soft-fallback in inbox/identity.ts:60-79).
      const fromIdentifier = whatsappAddresses.get(r.participant_id);
      // `r.region` supplies the country code for a number typed without one.
      // The old local toE164 knew no country, so it turned '0123456789' into
      // '+0123456789' and quietly counted that row as reachable.
      const fallback = toE164OrNull(r.phone, r.region);
      addresses.whatsapp = fromIdentifier ?? fallback;
    }
    if (channels.includes("email")) {
      addresses.email = r.email && r.email.trim() ? r.email.trim() : null;
    }
    const hasAny = channels.some((c) => addresses[c] !== null);
    if (!hasAny) {
      excluded_no_address++;
      continue;
    }
    recipients.push({
      participant_id: r.participant_id,
      enrollment_id: r.enrollment_id,
      name_cn: r.name_cn,
      name_en: r.name_en,
      region_id: r.region_id,
      region: r.region,
      language_fluency: r.language_fluency,
      addresses,
    });
  }

  return {
    recipients,
    total_matched: visibleRows.length,
    excluded_no_address,
    excluded_out_of_region,
  };
}

export async function previewAudienceCount(
  service: SupabaseClient,
  admin: AdminContext,
  filter: AudienceFilter,
  channels: BroadcastChannel[],
): Promise<AudienceCountPreview> {
  const res = await resolveAudience(service, admin, filter, channels);
  return { matched: res.total_matched, reachable: res.recipients.length };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

type BaseRow = {
  participant_id: string;
  enrollment_id: string | null;
  name_cn: string | null;
  name_en: string | null;
  region_id: string | null;
  region: string | null;
  email: string | null;
  phone: string | null;
  language_fluency: "en" | "cn" | "both" | null;
};

function eventRowToBase(r: EventCohortRow): BaseRow {
  return {
    participant_id: r.participant_id,
    enrollment_id: r.enrollment_id,
    name_cn: r.name_cn,
    name_en: r.name_en,
    region_id: r.region_id,
    region: r.region,
    email: r.email,
    phone: r.phone,
    language_fluency: r.language_fluency,
  };
}

async function loadParticipantMaster(
  service: SupabaseClient,
  filter: ParticipantMasterFilter,
): Promise<BaseRow[]> {
  // Reuse participants-query.ts filters. We translate the master filter shape
  // into ParticipantFilters where it overlaps.
  //
  // `identity: "all"` is REQUIRED here, not cosmetic. Leaving it unset would
  // take applyParticipantFilters' roster default of verified-only, which would
  // silently drop every WhatsApp-only contact from every broadcast — the exact
  // behaviour the lifecycle enum had and the reason it was dropped.
  const pf: ParticipantFilters = {
    q: undefined,
    region: filter.region ?? undefined,
    identity: "all",
    motivation: filter.motivation ?? undefined,
    sort: "recent",
    archived: filter.include_archived ? "all" : "active",
  };

  let query = service
    .from("participants")
    .select(
      "id, name_cn, name_en, region_id, region, email, phone, language_fluency, is_old_student, archived_at, assigned_cs_id, motivation_tag, financial_score, influence_score",
    )
    .limit(5000);
  query = applyParticipantFilters(query, pf);
  // NB: no applyRoleScope here — see the note in resolveAudience. Outreach
  // reaches everyone; role scoping governs record editing, not reachability.

  // Master-tab-specific filters not covered by ParticipantFilters:
  // programme filter value is a programme SLUG — resolve to the programme FK.
  // No match (deleted/unknown slug) yields no rows, which is correct.
  if (filter.programme_tier) {
    const { data: prog } = await service
      .from("programmes")
      .select("id")
      .eq("slug", filter.programme_tier)
      .is("deleted_at", null)
      .maybeSingle();
    query = prog?.id
      ? query.eq("programme_id", prog.id)
      : query.eq("programme_id", "00000000-0000-0000-0000-000000000000");
  }
  if (filter.is_old_student !== null) query = query.eq("is_old_student", filter.is_old_student);

  // NO channel pre-filter here, deliberately.
  //
  // This used to drop `email is null` rows when email was the only channel,
  // as "a cheap reducer before address resolution". The saving was negligible
  // and the cost was a dishonest preview: those rows never reached the
  // address-resolution loop in resolveAudience, so they were missing from
  // `total_matched` AND absent from `excluded_no_address`. A 436-person
  // audience with 32 unreachable people reported "404 matched · 0 no address"
  // — a silent exclusion that reads as complete coverage, which is the exact
  // failure mode the lifecycle-filter removal was about.
  //
  // Reachability is now decided in ONE place (the address loop), so every
  // person is either a recipient or a counted exclusion. Never re-add a
  // channel filter to this query.

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return ((data ?? []) as Array<{
    id: string;
    name_cn: string | null;
    name_en: string | null;
    region_id: string | null;
    region: string | null;
    email: string | null;
    phone: string | null;
    language_fluency: "en" | "cn" | "both" | null;
  }>).map((p) => ({
    participant_id: p.id,
    enrollment_id: null,
    name_cn: p.name_cn,
    name_en: p.name_en,
    region_id: p.region_id,
    region: p.region,
    email: p.email,
    phone: p.phone,
    language_fluency: p.language_fluency,
  }));
}

async function loadWhatsAppAddresses(
  service: SupabaseClient,
  participantIds: string[],
): Promise<Map<string, string>> {
  if (participantIds.length === 0) return new Map();
  // Chunk to keep the IN clause under PostgREST's URL limit.
  const out = new Map<string, string>();
  const CHUNK = 500;
  for (let i = 0; i < participantIds.length; i += CHUNK) {
    const slice = participantIds.slice(i, i + CHUNK);
    const { data, error } = await service
      .from("contact_identifiers")
      .select("participant_id, identifier, created_at")
      .eq("channel", "whatsapp")
      .in("participant_id", slice)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as Array<{ participant_id: string; identifier: string }>) {
      // First identifier wins (oldest = most likely the registration phone).
      // These come from Meta already in international form, so no region is
      // needed — but run them through the same normaliser so a hand-entered
      // identifier can't slip past in a different shape.
      if (!out.has(row.participant_id)) {
        const e164 = toE164OrNull(row.identifier, null);
        if (e164) out.set(row.participant_id, e164);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Audience summary string (for list page + audit metadata)
// ---------------------------------------------------------------------------

export function buildAudienceSummary(filter: AudienceFilter, eventTitle?: string | null): string {
  if (filter.mode === "event_cohort") {
    const statuses = filter.enrollment_statuses.length
      ? filter.enrollment_statuses.join(", ")
      : "all statuses";
    const tail = [statuses, filter.language, filter.tag_slug ? `#${filter.tag_slug}` : null]
      .filter(Boolean)
      .join(" · ");
    return `Event: ${eventTitle ?? filter.event_id.slice(0, 8)} · ${tail}`;
  }
  const pieces: string[] = [];
  if (filter.region) pieces.push(filter.region);
  if (filter.include_archived) pieces.push("incl. archived");
  if (filter.motivation) pieces.push(filter.motivation);
  if (filter.programme_tier) pieces.push(filter.programme_tier);
  if (filter.is_old_student === true) pieces.push("old students");
  if (filter.is_old_student === false) pieces.push("new students");
  return `Participants · ${pieces.join(" · ") || "all"}`;
}
