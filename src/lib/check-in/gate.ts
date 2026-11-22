import "server-only";
import { createSupabaseServiceClient } from "../supabase";
import { isEventDay, todayInEventTz } from "./day";
import { isCheckInMode, sessionOf, type CheckInMode, type Session } from "./mode";

// One choke point for every desk write (check-in, out/back scan). Reads the
// event's live state and decides what a scan right now is allowed to do:
//
//   locked   — today isn't one of the event's dates and test mode is off.
//              Nothing is written. This is what keeps a live event's records
//              on its real dates.
//   testMode — writes are allowed on any day and flagged is_test, so a
//              rehearsal can be cleared before the real event.
//
// The day is always the server's own event-local date; the client never
// chooses where a write lands.

export type DeskContext = {
  eventId: string;
  startDate: string | null;
  endDate: string | null;
  day: string;
  mode: CheckInMode;
  /** null during an official break. */
  session: Session | null;
  testMode: boolean;
  locked: boolean;
  longAbsenceMinutes: number;
  modeSetAt: string | null;
};

export async function resolveDeskContext(eventId: string): Promise<DeskContext | null> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("events")
    .select(
      "id, start_date, end_date, check_in_mode, check_in_mode_set_at, check_in_test_mode, long_absence_minutes",
    )
    .eq("id", eventId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return deskContextFromRow(data as EventStateRow);
}

export type EventStateRow = {
  id: string;
  start_date: string | null;
  end_date: string | null;
  check_in_mode: string | null;
  check_in_mode_set_at: string | null;
  check_in_test_mode: boolean | null;
  long_absence_minutes: number | null;
};

export const EVENT_STATE_COLUMNS =
  "check_in_mode, check_in_mode_set_at, check_in_test_mode, long_absence_minutes";

export function deskContextFromRow(row: EventStateRow, now: Date = new Date()): DeskContext {
  const day = todayInEventTz(now);
  const mode: CheckInMode = isCheckInMode(row.check_in_mode) ? row.check_in_mode : "am_registration";
  const testMode = row.check_in_test_mode === true;
  return {
    eventId: row.id,
    startDate: row.start_date,
    endDate: row.end_date,
    day,
    mode,
    session: sessionOf(mode),
    testMode,
    locked: !testMode && !isEventDay(row.start_date, row.end_date, day),
    longAbsenceMinutes: row.long_absence_minutes ?? 15,
    modeSetAt: row.check_in_mode_set_at,
  };
}

/** Roles that run the event: switch the desk mode and change check-in settings. */
export function canRunEvent(role: string): boolean {
  return role === "super_admin" || role === "regional_lead";
}
