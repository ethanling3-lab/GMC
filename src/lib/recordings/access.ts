import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { sgDay, validUntilDay } from "@/lib/pricing/tiers";

// Who can watch a replay · 回播 (Phase 4, Ethan 2026-11-26). The ONE place
// the rule lives — /me/recordings, the player, the signed-URL route, the
// course pages and the admin page all ask here.
//
//   1. Member: the recording's "members get it automatically" is on, they
//      have an approved or paid registration for the event, and their
//      programme is valid today. Ends by itself when validity ends.
//   2. Added by hand: a live grant whose last day (if any) hasn't passed.

export const LIVE_ENROLMENT = ["approved", "paid"] as const;

export type WatchVia = "member" | "granted";

export type Watchable = {
  id: string;
  event_id: string;
  event_title_en: string | null;
  event_title_cn: string | null;
  title_en: string | null;
  title_cn: string | null;
  duration_seconds: number | null;
  /** Newest reason first: member access wins when both apply. */
  via: WatchVia;
  /** Last day they can watch (null = no end). */
  until: string | null;
  since: string;
};

type MemberInfo = { valid: boolean; until: string | null; programme: string | null };

/** Their programme today: valid (no expiry, or expiry not passed), and until when. */
export async function memberStatus(service: SupabaseClient, participantId: string, today = sgDay()): Promise<MemberInfo> {
  const { data } = await service
    .from("participants")
    .select("programme_id, programme_expires_at, programmes(name_cn)")
    .eq("id", participantId)
    .maybeSingle();
  const row = data as unknown as {
    programme_id: string | null;
    programme_expires_at: string | null;
    programmes: { name_cn: string } | Array<{ name_cn: string }> | null;
  } | null;
  if (!row?.programme_id) return { valid: false, until: null, programme: null };
  const until = validUntilDay(row.programme_expires_at);
  const prog = Array.isArray(row.programmes) ? row.programmes[0] : row.programmes;
  return { valid: !until || until >= today, until, programme: prog?.name_cn ?? null };
}

const later = (a: string | null, b: string | null) => (a === null || b === null ? null : a > b ? a : b);

type RecRow = {
  id: string;
  event_id: string;
  title_en: string | null;
  title_cn: string | null;
  duration_seconds: number | null;
  created_at: string;
  members_auto: boolean;
  deleted_at: string | null;
  events: { title_en: string | null; title_cn: string | null } | null;
};
const REC_COLS = "id, event_id, title_en, title_cn, duration_seconds, created_at, members_auto, deleted_at, events(title_en, title_cn)";

/** Every replay this person can watch today, newest first. */
export async function loadWatchable(participantId: string, opts: { eventId?: string } = {}): Promise<Watchable[]> {
  const service = createSupabaseServiceClient();
  const today = sgDay();
  const member = await memberStatus(service, participantId, today);
  const out = new Map<string, Watchable>();
  const put = (r: RecRow, via: WatchVia, until: string | null, since: string) => {
    if (r.deleted_at) return;
    if (opts.eventId && r.event_id !== opts.eventId) return;
    const prev = out.get(r.id);
    if (prev) {
      prev.until = later(prev.until, until);
      if (via === "member") prev.via = "member";
      return;
    }
    out.set(r.id, {
      id: r.id,
      event_id: r.event_id,
      event_title_en: r.events?.title_en ?? null,
      event_title_cn: r.events?.title_cn ?? null,
      title_en: r.title_en,
      title_cn: r.title_cn,
      duration_seconds: r.duration_seconds,
      via,
      until,
      since,
    });
  };

  // 1. Member access.
  if (member.valid) {
    let q = service.from("enrollments").select("event_id").eq("participant_id", participantId).in("status", [...LIVE_ENROLMENT]);
    if (opts.eventId) q = q.eq("event_id", opts.eventId);
    const { data: enrs } = await q;
    const eventIds = [...new Set((enrs ?? []).map((e) => (e as { event_id: string }).event_id))];
    if (eventIds.length) {
      const { data: recs } = await service
        .from("event_recordings")
        .select(REC_COLS)
        .in("event_id", eventIds)
        .eq("members_auto", true)
        .is("deleted_at", null);
      for (const r of (recs ?? []) as unknown as RecRow[]) put(r, "member", member.until, r.created_at);
    }
  }

  // 2. Added by hand.
  const { data: grants } = await service
    .from("event_recording_access")
    .select(`granted_at, expires_on, recording:event_recordings(${REC_COLS})`)
    .eq("participant_id", participantId)
    .is("revoked_at", null);
  for (const g of (grants ?? []) as unknown as Array<{ granted_at: string; expires_on: string | null; recording: RecRow | null }>) {
    if (!g.recording) continue;
    if (g.expires_on && g.expires_on < today) continue;
    put(g.recording, "granted", g.expires_on, g.granted_at);
  }

  return [...out.values()].sort((a, b) => (a.since < b.since ? 1 : -1));
}

/** Can this person watch this one recording today? (Player + signed URL.) */
export async function canWatch(participantId: string, recordingId: string): Promise<boolean> {
  const service = createSupabaseServiceClient();
  const { data: rec } = await service
    .from("event_recordings")
    .select("id, event_id, members_auto, deleted_at")
    .eq("id", recordingId)
    .maybeSingle();
  if (!rec || rec.deleted_at) return false;
  const list = await loadWatchable(participantId, { eventId: rec.event_id as string });
  return list.some((w) => w.id === recordingId);
}

// ─── Admin side ───────────────────────────────────────────────────────────

export type AudiencePerson = { id: string; name: string; region_id: string | null; until: string | null };
export type GrantRow = AudiencePerson & { grant_id: string; granted_at: string; note: string | null; expired: boolean };

/** Members who get this event's replays automatically today. */
export async function loadEventMembers(service: SupabaseClient, eventId: string): Promise<AudiencePerson[]> {
  const today = sgDay();
  const { data } = await service
    .from("enrollments")
    .select("participant:participants(id, name_cn, name_en, region_id, programme_id, programme_expires_at)")
    .eq("event_id", eventId)
    .in("status", [...LIVE_ENROLMENT]);
  const seen = new Set<string>();
  const out: AudiencePerson[] = [];
  for (const e of (data ?? []) as unknown as Array<{
    participant: { id: string; name_cn: string | null; name_en: string | null; region_id: string | null; programme_id: string | null; programme_expires_at: string | null } | null;
  }>) {
    const p = e.participant;
    if (!p || seen.has(p.id) || !p.programme_id) continue;
    const until = validUntilDay(p.programme_expires_at);
    if (until && until < today) continue;
    seen.add(p.id);
    out.push({ id: p.id, name: p.name_cn || p.name_en || "—", region_id: p.region_id, until });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Hand-added grants per recording (live ones; expired shown as such). */
export async function loadGrants(service: SupabaseClient, recordingIds: string[]): Promise<Map<string, GrantRow[]>> {
  const today = sgDay();
  const map = new Map<string, GrantRow[]>();
  if (!recordingIds.length) return map;
  const { data } = await service
    .from("event_recording_access")
    .select("id, recording_id, granted_at, expires_on, note, participant:participants(id, name_cn, name_en, region_id)")
    .in("recording_id", recordingIds)
    .is("revoked_at", null)
    .order("granted_at", { ascending: false });
  for (const g of (data ?? []) as unknown as Array<{
    id: string; recording_id: string; granted_at: string; expires_on: string | null; note: string | null;
    participant: { id: string; name_cn: string | null; name_en: string | null; region_id: string | null } | null;
  }>) {
    if (!g.participant) continue;
    const list = map.get(g.recording_id) ?? [];
    list.push({
      grant_id: g.id,
      id: g.participant.id,
      name: g.participant.name_cn || g.participant.name_en || "—",
      region_id: g.participant.region_id,
      until: g.expires_on,
      granted_at: g.granted_at,
      note: g.note,
      expired: Boolean(g.expires_on && g.expires_on < today),
    });
    map.set(g.recording_id, list);
  }
  return map;
}

/**
 * Add people by hand. One live grant per (recording, person): an existing
 * live grant gets the new last day/note instead of a second row (the live
 * index is partial, so a plain upsert can't target it).
 */
export async function grantByHand(
  service: SupabaseClient,
  recordingId: string,
  participantIds: string[],
  opts: { adminId: string; expiresOn: string | null; note: string | null },
): Promise<{ added: number; updated: number }> {
  const ids = [...new Set(participantIds)];
  if (!ids.length) return { added: 0, updated: 0 };
  const { data: live } = await service
    .from("event_recording_access")
    .select("id, participant_id")
    .eq("recording_id", recordingId)
    .in("participant_id", ids)
    .is("revoked_at", null);
  const have = new Map((live ?? []).map((r) => [(r as { participant_id: string }).participant_id, (r as { id: string }).id]));
  const now = new Date().toISOString();
  const fresh = ids.filter((id) => !have.has(id));
  if (fresh.length) {
    const { error } = await service.from("event_recording_access").insert(
      fresh.map((pid) => ({
        recording_id: recordingId,
        participant_id: pid,
        granted_by: opts.adminId,
        granted_at: now,
        expires_on: opts.expiresOn,
        note: opts.note,
      })),
    );
    if (error) throw new Error(error.message);
  }
  if (have.size) {
    const { error } = await service
      .from("event_recording_access")
      .update({ expires_on: opts.expiresOn, note: opts.note, granted_by: opts.adminId })
      .in("id", [...have.values()]);
    if (error) throw new Error(error.message);
  }
  return { added: fresh.length, updated: have.size };
}
