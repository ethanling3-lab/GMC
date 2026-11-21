import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { ensureQrToken } from "@/lib/check-in/qr-token";
import { tableNoByGroupId } from "@/lib/floor-plan/table-numbers";
import { groupNumber } from "@/lib/group-number";
import { mapWithConcurrency } from "@/lib/concurrency";
import type { SeatRole } from "@/components/admin/layout/types";
import {
  DEFAULT_BADGE_SETTINGS,
  TOKEN_PREFIX_LEN,
  type BadgePayload,
  type BadgePrintStatus,
  type BadgeRow,
  type BadgeSettings,
} from "./types";

// Who gets a badge: PAID enrollments only. The badge carries the check-in QR,
// and the QR must never reach someone who hasn't paid (it rides the
// payment-received email for the same reason). Same predicate the reminder
// cron uses to decide who receives a QR (src/lib/reminders/cron-run.ts) —
// status='paid' OR payment_status='paid', since the two can diverge — minus
// anyone cancelled/rejected after paying.
//
// Ordering mirrors how the printed stack gets sorted into piles before the
// event: group display number → seat → role → region_id, ungrouped last.

export const BADGE_BUCKET = "event-floor-plans";
const SIGNED_URL_TTL = 60 * 60;

const ROLE_PRIORITY: Record<SeatRole, number> = {
  zu_zhang: 0,
  fu_zu_zhang: 1,
  participant: 2,
  pai_zhang: 3,
};

export type BadgeScope =
  | { kind: "all" }
  | { kind: "changed" }
  | { kind: "ids"; enrollmentIds: string[] };

type SettingsRow = {
  bg_storage_path: string | null;
  bg_original_filename: string | null;
  ink_color: string;
  qr_plate: boolean;
  plate_fill: string;
  plate_ink: string;
  name_center_pct: number | string;
  qr_top_pct: number | string;
  qr_size_mm: number | string;
};

export async function loadBadgeSettings(
  supabase: SupabaseClient,
  eventId: string,
): Promise<BadgeSettings & { bg_storage_path: string | null }> {
  const { data } = await supabase
    .from("event_badge_settings")
    .select(
      "bg_storage_path, bg_original_filename, ink_color, qr_plate, plate_fill, plate_ink, name_center_pct, qr_top_pct, qr_size_mm",
    )
    .eq("event_id", eventId)
    .maybeSingle<SettingsRow>();
  if (!data) return { ...DEFAULT_BADGE_SETTINGS, bg_storage_path: null };

  let bg_url: string | null = null;
  if (data.bg_storage_path) {
    const { data: signed } = await supabase.storage
      .from(BADGE_BUCKET)
      .createSignedUrl(data.bg_storage_path, SIGNED_URL_TTL);
    bg_url = signed?.signedUrl ?? null;
  }
  return {
    ink_color: data.ink_color,
    qr_plate: data.qr_plate,
    plate_fill: data.plate_fill,
    plate_ink: data.plate_ink,
    // numeric columns come back as strings from PostgREST
    name_center_pct: Number(data.name_center_pct),
    qr_top_pct: Number(data.qr_top_pct),
    qr_size_mm: Number(data.qr_size_mm),
    bg_url,
    bg_original_filename: data.bg_original_filename,
    bg_storage_path: data.bg_storage_path,
  };
}

export async function loadBadges(
  eventId: string,
  scope: BadgeScope = { kind: "all" },
): Promise<BadgePayload> {
  const supabase = createSupabaseServiceClient();

  const { data: ev, error: evErr } = await supabase
    .from("events")
    .select("id, slug, title_en, title_cn")
    .eq("id", eventId)
    .maybeSingle();
  if (evErr || !ev) throw new Error(evErr?.message ?? "event_not_found");

  const { bg_storage_path: _path, ...settings } = await loadBadgeSettings(
    supabase,
    eventId,
  );
  const event = {
    id: ev.id as string,
    slug: ev.slug as string,
    title: (ev.title_cn ?? ev.title_en ?? ev.slug) as string,
  };

  // ---- Paid enrollments ----------------------------------------------------
  let enrolQuery = supabase
    .from("enrollments")
    .select("id, participant_id, qr_token, created_at")
    .eq("event_id", eventId)
    .or("status.eq.paid,payment_status.eq.paid")
    .not("status", "in", "(cancelled,rejected)");
  if (scope.kind === "ids") {
    if (scope.enrollmentIds.length === 0) {
      return { event, settings, rows: [], missing_token_count: 0, duplicate_enrollment_count: 0 };
    }
    enrolQuery = enrolQuery.in("id", scope.enrollmentIds);
  }
  const { data: enrols, error: enrErr } = await enrolQuery;
  if (enrErr) throw new Error(enrErr.message);
  // One badge per PERSON. Nothing in the schema stops a participant holding
  // two paid enrollments for the same event; without this they'd get two
  // badges with two different QRs. Keep the earliest enrollment.
  const allEnrollments = ((enrols ?? []) as Array<{
    id: string;
    participant_id: string;
    qr_token: string | null;
    created_at: string;
  }>).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const seenPeople = new Set<string>();
  const enrollments = allEnrollments.filter((e) => {
    if (seenPeople.has(e.participant_id)) return false;
    seenPeople.add(e.participant_id);
    return true;
  });
  const duplicate_enrollment_count = allEnrollments.length - enrollments.length;
  if (enrollments.length === 0) {
    return { event, settings, rows: [], missing_token_count: 0, duplicate_enrollment_count: 0 };
  }

  // Legacy paid rows may predate QR minting — mint lazily, bounded so 500
  // first-time mints don't open 500 concurrent updates.
  const needToken = enrollments.filter((e) => !e.qr_token);
  if (needToken.length > 0) {
    const minted = await mapWithConcurrency(
      needToken,
      (e) => ensureQrToken(supabase, e.id),
      { concurrency: 8, deadlineMs: 20_000 },
    );
    needToken.forEach((e, i) => {
      e.qr_token = minted.results[i] ?? null;
    });
  }

  const participantIds = enrollments.map((e) => e.participant_id);

  // ---- Participants ----------------------------------------------------------
  const { data: parts, error: pErr } = await supabase
    .from("participants")
    .select("id, name_cn, name_en, region_id")
    .in("id", participantIds);
  if (pErr) throw new Error(pErr.message);
  const participantById = new Map(
    ((parts ?? []) as Array<{
      id: string;
      name_cn: string | null;
      name_en: string | null;
      region_id: string | null;
    }>).map((p) => [p.id, p]),
  );

  // ---- Seats + groups ---------------------------------------------------------
  const { data: seats, error: sErr } = await supabase
    .from("event_seat_assignments")
    .select("participant_id, seat_no, role, group_id, event_groups(group_no)")
    .eq("event_id", eventId)
    .in("participant_id", participantIds);
  if (sErr) throw new Error(sErr.message);
  type SeatRow = {
    participant_id: string;
    seat_no: number | null;
    role: SeatRole;
    group_id: string | null;
    event_groups: { group_no: number } | null;
  };
  const seatByPid = new Map<string, SeatRow>();
  for (const s of (seats ?? []) as unknown as SeatRow[]) {
    seatByPid.set(s.participant_id, s);
  }
  const tableNos = await tableNoByGroupId(supabase, { eventId });

  // ---- Previous prints ----------------------------------------------------------
  const { data: prints, error: prErr } = await supabase
    .from("badge_prints")
    .select(
      "enrollment_id, printed_name, printed_display_no, printed_seat_no, printed_token_prefix, print_count",
    )
    .eq("event_id", eventId)
    .in(
      "enrollment_id",
      enrollments.map((e) => e.id),
    );
  if (prErr) throw new Error(prErr.message);
  type PrintRow = {
    enrollment_id: string;
    printed_name: string;
    printed_display_no: number | null;
    printed_seat_no: number | null;
    printed_token_prefix: string;
    print_count: number;
  };
  const printByEnrollment = new Map(
    ((prints ?? []) as PrintRow[]).map((p) => [p.enrollment_id, p]),
  );

  // ---- Build rows ------------------------------------------------------------------
  type Sortable = BadgeRow & { _placed: boolean; _role: number };
  let missing_token_count = 0;
  const rows: Sortable[] = [];
  for (const e of enrollments) {
    if (!e.qr_token) {
      missing_token_count++;
      continue;
    }
    const p = participantById.get(e.participant_id);
    const seat = seatByPid.get(e.participant_id);
    const g = groupNumber({
      group_no: seat?.event_groups?.group_no ?? null,
      table_no: seat?.group_id ? tableNos.get(seat.group_id) ?? null : null,
    });
    const name = (p?.name_cn?.trim() || p?.name_en?.trim() || "").trim();
    const seat_no = seat?.seat_no ?? null;

    const prev = printByEnrollment.get(e.id);
    let status: BadgePrintStatus = "new";
    if (prev) {
      const same =
        prev.printed_name === name &&
        prev.printed_display_no === g.no &&
        prev.printed_seat_no === seat_no &&
        prev.printed_token_prefix === e.qr_token.slice(0, TOKEN_PREFIX_LEN);
      status = same ? "unchanged" : "changed";
    }

    rows.push({
      enrollment_id: e.id,
      participant_id: e.participant_id,
      name,
      region_id: p?.region_id ?? null,
      display_no: g.no,
      seat_no,
      token: e.qr_token,
      status,
      print_count: prev?.print_count ?? 0,
      _placed: g.placed,
      _role: seat?.role ? ROLE_PRIORITY[seat.role] : ROLE_PRIORITY.participant,
    });
  }

  rows.sort((a, b) => {
    const an = a.display_no ?? Number.POSITIVE_INFINITY;
    const bn = b.display_no ?? Number.POSITIVE_INFINITY;
    if (an !== bn) return an - bn;
    // A table number and an unplaced group's own number can coincide —
    // keep the seated table's badges together, ahead of the unplaced group.
    if (a._placed !== b._placed) return a._placed ? -1 : 1;
    const as = a.seat_no ?? Number.POSITIVE_INFINITY;
    const bs = b.seat_no ?? Number.POSITIVE_INFINITY;
    if (as !== bs) return as - bs;
    if (a._role !== b._role) return a._role - b._role;
    return (a.region_id ?? "").localeCompare(b.region_id ?? "");
  });

  // Belt and braces: enrollments.qr_token has a unique index, so this can't
  // happen — but a duplicated QR on a printed badge would check in the wrong
  // person, so refuse to produce a PDF rather than trust it silently.
  const tokens = new Set<string>();
  for (const r of rows) {
    if (tokens.has(r.token)) throw new Error("duplicate_qr_token");
    tokens.add(r.token);
  }

  const filtered =
    scope.kind === "changed"
      ? rows.filter((r) => r.status !== "unchanged")
      : rows;

  return {
    event,
    settings,
    rows: filtered.map(({ _placed: _a, _role: _b, ...r }) => r),
    missing_token_count,
    duplicate_enrollment_count,
  };
}
