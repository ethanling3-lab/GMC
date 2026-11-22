import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "../supabase";
import { tableNoByGroupId } from "../floor-plan/table-numbers";
import { groupNumber } from "../group-number";
import {
  NOT_CANCELLED_FILTER,
  PAID_OR_FILTER,
  UNGROUPED_GROUP_ID,
  isPaidEnrollment,
  type CheckInAbsentRow,
  type CheckInGroupRow,
  type CheckInMethod,
  type CheckInRecent,
  type CheckInStats,
  type DeskState,
  type ExitTotalRow,
  type OutNowRow,
  type SessionCounts,
} from "./types";
import { dayOptions, defaultDay, isIsoDay, todayInEventTz, type DayOption } from "./day";
import { SESSIONS, isSession, sessionOf, type Session } from "./mode";
import { EVENT_STATE_COLUMNS, deskContextFromRow, type EventStateRow } from "./gate";
import { minutesBetween } from "./check-in-write";

// Server-only loaders for the check-in dashboard (/admin/events/[id]/check-in)
// and the scanner stations. Everything is scoped to ONE event day and ONE
// registration (Morning / Afternoon): a person checked in on Day 1 morning is
// "not yet here" again that afternoon, and again on Day 2.
//
// "Expected" = paid attendees (see isPaidEnrollment), plus anyone the desk let
// in that day on an unpaid override — otherwise an override would push a
// group past 100%.

type GroupNos = { group_no: number | null; table_no: number | null };

export type Seat = GroupNos & { group_id: string | null; seat_no: number | null };

type EventMeta = {
  id: string;
  slug: string;
  title_en: string | null;
  title_cn: string | null;
  start_date: string | null;
  end_date: string | null;
  check_in_method: "qr" | "face" | "both";
  state: EventStateRow;
};

export type CheckInSnapshot = {
  /** The registration the session-scoped parts below are for. */
  session: Session;
  stats: CheckInStats;
  recent: CheckInRecent[];
  groups: CheckInGroupRow[];
  absent: CheckInAbsentRow[];
  bySession: SessionCounts;
  desk: DeskState;
  /** Out of class right now (any session today; only on today's view). */
  outNow: OutNowRow[];
  /** Per-person out-of-class totals for the day, worst first. */
  exitTotals: ExitTotalRow[];
};

export type CheckInPageData = CheckInSnapshot & {
  event: EventMeta;
  days: DayOption[];
  day: string;
};

async function loadEvent(
  supabase: SupabaseClient,
  eventId: string,
): Promise<EventMeta | null> {
  const { data, error } = await supabase
    .from("events")
    .select(
      `id, slug, title_en, title_cn, start_date, end_date, check_in_method, ${EVENT_STATE_COLUMNS}`,
    )
    .eq("id", eventId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id as string,
    slug: data.slug as string,
    title_en: (data.title_en as string | null) ?? null,
    title_cn: (data.title_cn as string | null) ?? null,
    start_date: (data.start_date as string | null) ?? null,
    end_date: (data.end_date as string | null) ?? null,
    check_in_method:
      (data.check_in_method as "qr" | "face" | "both" | null) ?? "face",
    state: data as unknown as EventStateRow,
  };
}

function deskState(state: EventStateRow): DeskState {
  const ctx = deskContextFromRow(state);
  return {
    today: ctx.day,
    mode: ctx.mode,
    testMode: ctx.testMode,
    locked: ctx.locked,
    longAbsenceMinutes: ctx.longAbsenceMinutes,
    modeSetAt: ctx.modeSetAt,
  };
}

/** Dates that already hold check-ins for this event (for the day switcher). */
async function loadDaysWithCheckIns(
  supabase: SupabaseClient,
  eventId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("check_ins")
    .select("check_in_date")
    .eq("event_id", eventId);
  if (error) throw new Error(error.message);
  return [...new Set((data ?? []).map((r) => r.check_in_date as string))];
}

/**
 * Event + day options + the snapshot for `requestedDay` (or the default day:
 * today during the event, else Day 1) and `requestedSession` (or the session
 * the desks are in now). Null when the event doesn't exist.
 */
export async function loadCheckInPage(
  eventId: string,
  requestedDay?: string | null,
  requestedSession?: string | null,
): Promise<CheckInPageData | null> {
  const supabase = createSupabaseServiceClient();
  const [event, withCheckIns] = await Promise.all([
    loadEvent(supabase, eventId),
    loadDaysWithCheckIns(supabase, eventId),
  ]);
  if (!event) return null;

  const desk = deskState(event.state);
  const days = dayOptions(event.start_date, event.end_date, withCheckIns, desk.testMode);
  const day =
    requestedDay && isIsoDay(requestedDay) && days.some((d) => d.day === requestedDay)
      ? requestedDay
      : defaultDay(days, withCheckIns);
  const session = isSession(requestedSession)
    ? requestedSession
    : day === desk.today
      ? sessionOf(desk.mode) ?? "am"
      : "am";
  const snapshot = await loadDaySnapshot(eventId, day, session);
  return { event, days, day, ...snapshot };
}

// --- Day snapshot ------------------------------------------------------------

export type ExpectedRow = {
  enrollment_id: string;
  participant_id: string;
  region_id: string | null;
  name_cn: string | null;
  name_en: string | null;
  phone: string | null;
};

export type DayCheckIn = {
  id: string;
  enrollment_id: string;
  participant_id: string;
  session: Session;
  checked_in_at: string;
  method: CheckInMethod;
  unpaid_override: boolean;
  is_test: boolean;
  region_id: string | null;
  name_cn: string | null;
  name_en: string | null;
  phone: string | null;
};

export async function loadSeats(
  supabase: SupabaseClient,
  eventId: string,
): Promise<Map<string, Seat>> {
  const [{ data, error }, tableNos] = await Promise.all([
    supabase
      .from("event_seat_assignments")
      .select("participant_id, group_id, seat_no, event_groups(group_no)")
      .eq("event_id", eventId),
    tableNoByGroupId(supabase, { eventId }),
  ]);
  if (error) throw new Error(error.message);
  const out = new Map<string, Seat>();
  for (const s of (data ?? []) as unknown as Array<{
    participant_id: string;
    group_id: string | null;
    seat_no: number | null;
    event_groups: { group_no: number | null } | null;
  }>) {
    out.set(s.participant_id, {
      group_id: s.group_id,
      seat_no: s.seat_no,
      group_no: s.event_groups?.group_no ?? null,
      table_no: s.group_id ? tableNos.get(s.group_id) ?? null : null,
    });
  }
  return out;
}

export async function loadPaid(
  supabase: SupabaseClient,
  eventId: string,
): Promise<ExpectedRow[]> {
  const { data, error } = await supabase
    .from("enrollments")
    .select(
      "id, participant_id, participant:participants!inner(region_id, name_cn, name_en, phone)",
    )
    .eq("event_id", eventId)
    .or(PAID_OR_FILTER)
    .not("status", "in", NOT_CANCELLED_FILTER);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Array<{
    id: string;
    participant_id: string;
    participant: Omit<ExpectedRow, "enrollment_id" | "participant_id">;
  }>).map((e) => ({
    enrollment_id: e.id,
    participant_id: e.participant_id,
    ...e.participant,
  }));
}

export async function loadDayCheckIns(
  supabase: SupabaseClient,
  eventId: string,
  day: string,
): Promise<DayCheckIn[]> {
  const { data, error } = await supabase
    .from("check_ins")
    .select(
      "id, enrollment_id, participant_id, session, checked_in_at, method, unpaid_override, is_test, " +
        "participants!inner(region_id, name_cn, name_en, phone)",
    )
    .eq("event_id", eventId)
    .eq("check_in_date", day)
    .order("checked_in_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Array<
    Omit<DayCheckIn, "region_id" | "name_cn" | "name_en" | "phone"> & {
      participants: Pick<DayCheckIn, "region_id" | "name_cn" | "name_en" | "phone">;
    }
  >).map(({ participants, ...c }) => ({ ...c, ...participants }));
}

function countStats(
  day: string,
  session: Session,
  paidCount: number,
  checkIns: Pick<DayCheckIn, "method" | "unpaid_override">[],
): CheckInStats {
  const by_method = { qr: 0, manual: 0, face_match: 0 };
  let unpaid_overrides = 0;
  for (const c of checkIns) {
    by_method[c.method] += 1;
    if (c.unpaid_override) unpaid_overrides += 1;
  }
  return {
    day,
    session,
    total_eligible: paidCount + unpaid_overrides,
    total_checked_in: checkIns.length,
    unpaid_overrides,
    by_method,
  };
}

/** Counter only — the lightweight poll. */
export async function loadStats(
  eventId: string,
  day: string,
  session: Session,
): Promise<CheckInStats> {
  const supabase = createSupabaseServiceClient();
  const [{ count, error }, { data: rows, error: cErr }] = await Promise.all([
    supabase
      .from("enrollments")
      .select("id", { count: "exact", head: true })
      .eq("event_id", eventId)
      .or(PAID_OR_FILTER)
      .not("status", "in", NOT_CANCELLED_FILTER),
    supabase
      .from("check_ins")
      .select("method, unpaid_override")
      .eq("event_id", eventId)
      .eq("check_in_date", day)
      .eq("session", session),
  ]);
  if (error) throw new Error(error.message);
  if (cErr) throw new Error(cErr.message);
  return countStats(day, session, count ?? 0, (rows ?? []) as unknown as DayCheckIn[]);
}

/** Everything the dashboard shows for one day + session, from one read. */
export async function loadDaySnapshot(
  eventId: string,
  day: string,
  session: Session,
): Promise<CheckInSnapshot> {
  const supabase = createSupabaseServiceClient();
  const [
    paid,
    dayCheckIns,
    seats,
    { data: groupRows, error: gErr },
    { data: eventRow, error: eErr },
    exits,
  ] = await Promise.all([
    loadPaid(supabase, eventId),
    loadDayCheckIns(supabase, eventId, day),
    loadSeats(supabase, eventId),
    supabase
      .from("event_groups")
      .select("id, group_no, group_class, name_en, name_cn")
      .eq("event_id", eventId),
    supabase
      .from("events")
      .select(`id, start_date, end_date, ${EVENT_STATE_COLUMNS}`)
      .eq("id", eventId)
      .maybeSingle(),
    loadDayExits(supabase, eventId, day),
  ]);
  if (gErr) throw new Error(gErr.message);
  if (eErr) throw new Error(eErr.message);
  if (!eventRow) throw new Error("event_not_found");
  const desk = deskState(eventRow as unknown as EventStateRow);

  const bySession = {} as SessionCounts;
  for (const s of SESSIONS) {
    const rows = dayCheckIns.filter((c) => c.session === s);
    const overrides = rows.filter((c) => c.unpaid_override).length;
    bySession[s] = { arrived: rows.length, expected: paid.length + overrides };
  }

  const checkIns = dayCheckIns.filter((c) => c.session === session);
  const stats = countStats(day, session, paid.length, checkIns);
  const arrived = new Set(checkIns.map((c) => c.enrollment_id));

  // Expected people = paid + today's overrides (who aren't in `paid`).
  const expected: ExpectedRow[] = [
    ...paid,
    ...checkIns
      .filter((c) => c.unpaid_override)
      .map((c) => ({
        enrollment_id: c.enrollment_id,
        participant_id: c.participant_id,
        region_id: c.region_id,
        name_cn: c.name_cn,
        name_en: c.name_en,
        phone: c.phone,
      })),
  ];

  // ---- Groups ---------------------------------------------------------------
  const tally = new Map<string, { expected: number; arrived: number }>();
  const ungrouped = { expected: 0, arrived: 0 };
  for (const e of expected) {
    const gid = seats.get(e.participant_id)?.group_id ?? null;
    const t = gid ? tally.get(gid) ?? { expected: 0, arrived: 0 } : ungrouped;
    t.expected += 1;
    if (arrived.has(e.enrollment_id)) t.arrived += 1;
    if (gid) tally.set(gid, t);
  }
  const tableByGroup = new Map<string, number | null>();
  for (const s of seats.values()) {
    if (s.group_id) tableByGroup.set(s.group_id, s.table_no);
  }

  const groups: CheckInGroupRow[] = ((groupRows ?? []) as Array<{
    id: string;
    group_no: number | null;
    group_class: string | null;
    name_en: string | null;
    name_cn: string | null;
  }>).map((g) => ({
    group_id: g.id,
    group_no: g.group_no,
    table_no: tableByGroup.get(g.id) ?? null,
    group_class: g.group_class,
    name_en: g.name_en,
    name_cn: g.name_cn,
    expected_count: tally.get(g.id)?.expected ?? 0,
    checked_in_count: tally.get(g.id)?.arrived ?? 0,
  }));
  groups.sort(byDisplayNumber);
  if (ungrouped.expected > 0) {
    groups.push({
      group_id: UNGROUPED_GROUP_ID,
      group_no: null,
      table_no: null,
      group_class: null,
      name_en: "Ungrouped",
      name_cn: "未分组",
      expected_count: ungrouped.expected,
      checked_in_count: ungrouped.arrived,
    });
  }

  // ---- Not yet here (everyone, not a top-N) ---------------------------------
  const absent: CheckInAbsentRow[] = paid
    .filter((e) => !arrived.has(e.enrollment_id))
    .map((e) => {
      const seat = seats.get(e.participant_id);
      return {
        enrollment_id: e.enrollment_id,
        participant_id: e.participant_id,
        region_id: e.region_id,
        name_cn: e.name_cn,
        name_en: e.name_en,
        phone: e.phone,
        group_no: seat?.group_no ?? null,
        table_no: seat?.table_no ?? null,
      };
    });
  absent.sort((a, b) => {
    const g = byDisplayNumber(a, b);
    if (g !== 0) return g;
    return (a.name_cn ?? a.name_en ?? "").localeCompare(b.name_cn ?? b.name_en ?? "");
  });

  // ---- Recent ------------------------------------------------------------------
  const recent: CheckInRecent[] = checkIns.slice(0, 20).map((c) => {
    const seat = seats.get(c.participant_id);
    return {
      enrollment_id: c.enrollment_id,
      participant_id: c.participant_id,
      region_id: c.region_id,
      name_cn: c.name_cn,
      name_en: c.name_en,
      group_no: seat?.group_no ?? null,
      table_no: seat?.table_no ?? null,
      checked_in_at: c.checked_in_at,
      method: c.method,
      unpaid_override: c.unpaid_override,
    };
  });

  const { outNow, exitTotals } = summariseExits(
    exits,
    seats,
    desk.longAbsenceMinutes,
    // A still-open exit on a past day is a leftover — it'll close as
    // no-return on the next mode switch; don't show it as "out now".
    day === desk.today,
  );

  return { session, stats, recent, groups, absent, bySession, desk, outNow, exitTotals };
}

// --- Out of class ----------------------------------------------------------------

export type DayExit = {
  id: string;
  enrollment_id: string;
  participant_id: string;
  session: Session;
  out_at: string;
  back_at: string | null;
  closed_reason: "scanned_back" | "session_ended" | null;
  not_checked_in: boolean;
  is_test: boolean;
  region_id: string | null;
  name_cn: string | null;
  name_en: string | null;
};

export async function loadDayExits(
  supabase: SupabaseClient,
  eventId: string,
  day: string,
): Promise<DayExit[]> {
  const { data, error } = await supabase
    .from("class_exits")
    .select(
      "id, enrollment_id, participant_id, session, out_at, back_at, closed_reason, not_checked_in, is_test, " +
        "participants!inner(region_id, name_cn, name_en)",
    )
    .eq("event_id", eventId)
    .eq("exit_date", day)
    .order("out_at", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Array<
    Omit<DayExit, "region_id" | "name_cn" | "name_en"> & {
      participants: Pick<DayExit, "region_id" | "name_cn" | "name_en">;
    }
  >).map(({ participants, ...e }) => ({ ...e, ...participants }));
}

function summariseExits(
  exits: DayExit[],
  seats: Map<string, Seat>,
  longAbsenceMinutes: number,
  isToday: boolean,
  now: string = new Date().toISOString(),
): { outNow: OutNowRow[]; exitTotals: ExitTotalRow[] } {
  const outNow: OutNowRow[] = [];
  const totals = new Map<string, ExitTotalRow>();

  for (const e of exits) {
    const seat = seats.get(e.participant_id);
    const open = e.back_at === null;
    if (open && isToday) {
      outNow.push({
        exit_id: e.id,
        enrollment_id: e.enrollment_id,
        region_id: e.region_id,
        name_cn: e.name_cn,
        name_en: e.name_en,
        group_no: seat?.group_no ?? null,
        table_no: seat?.table_no ?? null,
        session: e.session,
        out_at: e.out_at,
        not_checked_in: e.not_checked_in,
      });
    }
    const minutes = minutesBetween(e.out_at, e.back_at ?? now);
    const t =
      totals.get(e.enrollment_id) ??
      ({
        enrollment_id: e.enrollment_id,
        region_id: e.region_id,
        name_cn: e.name_cn,
        name_en: e.name_en,
        group_no: seat?.group_no ?? null,
        table_no: seat?.table_no ?? null,
        trips: 0,
        total_minutes: 0,
        longest_minutes: 0,
        no_return: 0,
        long_trips: 0,
        still_out: false,
      } satisfies ExitTotalRow);
    t.trips += 1;
    t.total_minutes += minutes;
    t.longest_minutes = Math.max(t.longest_minutes, minutes);
    if (e.closed_reason === "session_ended") t.no_return += 1;
    if (minutes > longAbsenceMinutes) t.long_trips += 1;
    if (open && isToday) t.still_out = true;
    totals.set(e.enrollment_id, t);
  }

  // Longest out first — the people a trainer will ask about.
  const exitTotals = [...totals.values()].sort(
    (a, b) => b.total_minutes - a.total_minutes || b.trips - a.trips,
  );
  return { outNow, exitTotals };
}

// Order by the number staff actually see (table_no ?? group_no) — the number
// on the badge pile — ungrouped last. A table number and an unplaced group's
// own number can coincide; seated tables go first on a tie.
export function byDisplayNumber(a: GroupNos, b: GroupNos): number {
  const ga = groupNumber(a);
  const gb = groupNumber(b);
  const na = ga.no ?? Number.POSITIVE_INFINITY;
  const nb = gb.no ?? Number.POSITIVE_INFINITY;
  if (na !== nb) return na - nb;
  if (ga.placed !== gb.placed) return ga.placed ? -1 : 1;
  return 0;
}

// --- Manual search -------------------------------------------------------------

// Manual-search typeahead — the desk types a region_id fragment, name or
// phone and gets up to 30 matches among this event's paid AND
// approved-but-unpaid enrolments (`paid: false` → the desk must confirm an
// override). Already-checked-in rows (for this day) come back too, so staff
// can confirm or undo.
//
// Order: paid first, then the badge-pile order (group display number →
// seat → region ID), so an empty box lists the people a desk most likely
// needs, the way their badges are sorted. Sorting happens here, after the
// fetch, because group/seat live in other tables — ~500 rows is cheap.
export type ManualSearchRow = {
  enrollment_id: string;
  participant_id: string;
  region_id: string | null;
  name_cn: string | null;
  name_en: string | null;
  phone: string | null;
  group_no: number | null;
  table_no: number | null;
  seat_no: number | null;
  paid: boolean;
  /** Check-in for the requested session. */
  checked_in_at: string | null;
  check_in_id: string | null;
  /** Set while they're out of class (an open exit today). */
  out_since: string | null;
};

const SEARCH_LIMIT = 30;

export async function searchEligibleForCheckIn(
  eventId: string,
  query: string,
  day: string,
  session: Session,
): Promise<ManualSearchRow[]> {
  const supabase = createSupabaseServiceClient();
  const q = query.trim();

  let req = supabase
    .from("enrollments")
    .select(
      "id, participant_id, status, payment_status, " +
        "participants!inner(region_id, name_cn, name_en, phone)",
    )
    .eq("event_id", eventId)
    .or(`${PAID_OR_FILTER},status.eq.approved`)
    .not("status", "in", NOT_CANCELLED_FILTER);

  if (q.length > 0) {
    const safe = q.replace(/[\\%_,]/g, "\\$&");
    req = req.or(
      [
        `region_id.ilike.%${safe}%`,
        `name_cn.ilike.%${safe}%`,
        `name_en.ilike.%${safe}%`,
        `phone.ilike.%${safe}%`,
      ].join(","),
      { referencedTable: "participants" },
    );
  }

  type Row = {
    id: string;
    participant_id: string;
    status: string;
    payment_status: string;
    participants: {
      region_id: string | null;
      name_cn: string | null;
      name_en: string | null;
      phone: string | null;
    };
  };

  // Today's check-ins for the whole event rather than `.in(enrollment_id, …)`
  // over every match — a 500-id list would blow the request URL.
  const [
    { data, error },
    { data: checkIns, error: cErr },
    seats,
    { data: openExits, error: xErr },
  ] = await Promise.all([
    req,
    supabase
      .from("check_ins")
      .select("id, enrollment_id, checked_in_at")
      .eq("event_id", eventId)
      .eq("check_in_date", day)
      .eq("session", session),
    loadSeats(supabase, eventId),
    supabase
      .from("class_exits")
      .select("enrollment_id, out_at")
      .eq("event_id", eventId)
      .eq("exit_date", day)
      .is("back_at", null),
  ]);
  if (error) throw new Error(error.message);
  if (cErr) throw new Error(cErr.message);
  if (xErr) throw new Error(xErr.message);
  const outSince = new Map(
    ((openExits ?? []) as Array<{ enrollment_id: string; out_at: string }>).map((x) => [
      x.enrollment_id,
      x.out_at,
    ]),
  );

  const checkInByEnrolment = new Map(
    ((checkIns ?? []) as Array<{ id: string; enrollment_id: string; checked_in_at: string }>).map(
      (c) => [c.enrollment_id, c],
    ),
  );

  const rows: ManualSearchRow[] = ((data ?? []) as unknown as Row[]).map((row) => {
    const checkIn = checkInByEnrolment.get(row.id) ?? null;
    const seat = seats.get(row.participant_id);
    return {
      enrollment_id: row.id,
      participant_id: row.participant_id,
      region_id: row.participants.region_id,
      name_cn: row.participants.name_cn,
      name_en: row.participants.name_en,
      phone: row.participants.phone,
      group_no: seat?.group_no ?? null,
      table_no: seat?.table_no ?? null,
      seat_no: seat?.seat_no ?? null,
      paid: isPaidEnrollment(row),
      checked_in_at: checkIn?.checked_in_at ?? null,
      check_in_id: checkIn?.id ?? null,
      out_since: outSince.get(row.id) ?? null,
    };
  });

  rows.sort((a, b) => {
    if (a.paid !== b.paid) return a.paid ? -1 : 1;
    const g = byDisplayNumber(a, b);
    if (g !== 0) return g;
    const sa = a.seat_no ?? Number.POSITIVE_INFINITY;
    const sb = b.seat_no ?? Number.POSITIVE_INFINITY;
    if (sa !== sb) return sa - sb;
    return (a.region_id ?? "").localeCompare(b.region_id ?? "");
  });

  return rows.slice(0, SEARCH_LIMIT);
}

// --- Public ticket page ----------------------------------------------------------

// Given a QR token, returns the enrollment + participant + event details for
// the public /checkin/[token] ticket card, plus TODAY's check-in if any (the
// attendee may hold one row per event day). Null if the token is unknown.
export async function loadTicketByToken(token: string): Promise<{
  event: {
    id: string;
    slug: string;
    title_en: string | null;
    title_cn: string | null;
    start_date: string | null;
    end_date: string | null;
    venue: string | null;
    city: string | null;
  };
  participant: {
    id: string;
    region_id: string | null;
    name_cn: string | null;
    name_en: string | null;
  };
  enrollment: {
    id: string;
    qr_token: string;
    status: string;
    payment_status: string;
  };
  check_in: {
    checked_in_at: string;
    method: CheckInMethod;
  } | null;
} | null> {
  if (!token) return null;
  const supabase = createSupabaseServiceClient();
  const { data: enrolment, error } = await supabase
    .from("enrollments")
    .select(
      "id, event_id, participant_id, qr_token, status, payment_status, " +
        "events!inner(id, slug, title_en, title_cn, start_date, end_date, venue, city), " +
        "participants!inner(id, region_id, name_cn, name_en)",
    )
    .eq("qr_token", token)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!enrolment) return null;
  const row = enrolment as unknown as {
    id: string;
    qr_token: string;
    status: string;
    payment_status: string;
    events: {
      id: string;
      slug: string;
      title_en: string | null;
      title_cn: string | null;
      start_date: string | null;
      end_date: string | null;
      venue: string | null;
      city: string | null;
    };
    participants: {
      id: string;
      region_id: string | null;
      name_cn: string | null;
      name_en: string | null;
    };
  };

  const { data: existing } = await supabase
    .from("check_ins")
    .select("checked_in_at, method")
    .eq("enrollment_id", row.id)
    .eq("check_in_date", todayInEventTz())
    .order("checked_in_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return {
    event: row.events,
    participant: row.participants,
    enrollment: {
      id: row.id,
      qr_token: row.qr_token,
      status: row.status,
      payment_status: row.payment_status,
    },
    check_in: existing
      ? {
          checked_in_at: (existing as { checked_in_at: string }).checked_in_at,
          method: (existing as { method: CheckInMethod }).method,
        }
      : null,
  };
}
