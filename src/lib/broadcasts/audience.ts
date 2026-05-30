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
  applyRoleScope,
  type ParticipantFilters,
} from "@/lib/participants-query";

// Audience resolver — returns the (participant × channel) leaves the
// fan-out will deliver to. Two modes; both end at the same Recipient
// shape. Strict region gate: a regional_lead's master-tab filter is
// auto-forced to admin.region; in event-cohort mode, we let them target
// any event they can already see in /admin/events (the enrolment list is
// what it is), but we surface an "X out of region" soft warning via
// excluded_out_of_region.
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

  const effectiveFilter = applyRegionGate(admin, filter);

  const baseRows: BaseRow[] =
    effectiveFilter.mode === "event_cohort"
      ? (await loadEventCohort(service, effectiveFilter)).map(eventRowToBase)
      : await loadParticipantMaster(service, admin, effectiveFilter);

  // Region gate for event-cohort: regional_lead sees the whole cohort but
  // we count out-of-region for the soft warning.
  let excluded_out_of_region = 0;
  let visibleRows = baseRows;
  if (admin.role === "regional_lead" && admin.region) {
    if (effectiveFilter.mode === "event_cohort") {
      // Soft-warn count, but keep all rows in the cohort.
      excluded_out_of_region = baseRows.filter((r) => r.region && r.region !== admin.region).length;
    } else {
      // Master mode: strict — already filtered to admin.region above, but
      // double-defense in case the filter coerce slipped.
      visibleRows = baseRows.filter((r) => r.region === admin.region);
    }
  }

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
      const fallback = r.phone ? toE164(r.phone) : null;
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

function applyRegionGate(admin: AdminContext, filter: AudienceFilter): AudienceFilter {
  if (filter.mode !== "participant_master") return filter;
  if (admin.role !== "regional_lead" || !admin.region) return filter;
  // Strict gate: force the lead's region regardless of what was sent.
  return { ...filter, region: admin.region } as ParticipantMasterFilter;
}

async function loadParticipantMaster(
  service: SupabaseClient,
  admin: AdminContext,
  filter: ParticipantMasterFilter,
): Promise<BaseRow[]> {
  // Reuse participants-query.ts filters + role-scope. We translate the
  // master filter shape into ParticipantFilters where it overlaps.
  const pf: ParticipantFilters = {
    q: undefined,
    region: filter.region ?? undefined,
    status: filter.status && filter.status.length === 1 ? filter.status[0] : undefined,
    motivation: filter.motivation ?? undefined,
    sort: "recent",
    archived: "active",
  };

  let query = service
    .from("participants")
    .select(
      "id, name_cn, name_en, region_id, region, email, phone, language_fluency, status, is_old_student, programme_tier, archived_at, assigned_cs_id, motivation_tag, financial_score, influence_score",
    )
    .limit(5000);
  query = applyParticipantFilters(query, pf);
  query = applyRoleScope(query, admin.role, admin.id, admin.region);

  // Multi-status filter (participants-query.ts only supports single).
  if (filter.status && filter.status.length > 1) {
    query = query.in("status", filter.status);
  }

  // Master-tab-specific filters not covered by ParticipantFilters:
  if (filter.programme_tier) query = query.eq("programme_tier", filter.programme_tier);
  if (filter.is_old_student !== null) query = query.eq("is_old_student", filter.is_old_student);

  // Email-required pre-filter (a cheap reducer before address resolution).
  // We don't pre-filter on WhatsApp because the address lives in
  // contact_identifiers, not participants.
  if (filter.require_any_of_channels?.length === 1 && filter.require_any_of_channels[0] === "email") {
    query = query.not("email", "is", null);
  }

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
      if (!out.has(row.participant_id)) {
        out.set(row.participant_id, toE164(row.identifier));
      }
    }
  }
  return out;
}

// Cheap E.164-ish normalizer. Strips spaces, dashes, parens; preserves a
// leading +. WhatsApp accepts a raw digit string without +; we keep the +
// for display + audit clarity. Matches send.ts behavior.
function toE164(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const cleaned = trimmed.replace(/[\s\-().]/g, "");
  if (cleaned.startsWith("+")) return cleaned;
  // If it already looks like a digit-only number, prepend +.
  if (/^\d{6,15}$/.test(cleaned)) return `+${cleaned}`;
  return cleaned; // last resort — let the adapter complain
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
  if (filter.status?.length) pieces.push(filter.status.join("+"));
  if (filter.motivation) pieces.push(filter.motivation);
  if (filter.programme_tier) pieces.push(filter.programme_tier);
  if (filter.is_old_student === true) pieces.push("old students");
  if (filter.is_old_student === false) pieces.push("new students");
  return `Participants · ${pieces.join(" · ") || "all"}`;
}
