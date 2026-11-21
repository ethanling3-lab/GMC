// Event-day helpers for per-day check-in. Pure — safe on server and client.
//
// A "day" is a calendar date (YYYY-MM-DD) in the event's local time. GMC runs
// in Singapore and Malaysia, which share UTC+8 with no DST, so one zone covers
// every event. The server stamps check_ins.check_in_date from its own clock
// with todayInEventTz(); the client never chooses the day it writes to.

export const EVENT_TZ = "Asia/Singapore";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDay(v: unknown): v is string {
  return typeof v === "string" && ISO_DAY.test(v) && !Number.isNaN(Date.parse(v));
}

/** Today's date in the event time zone, as YYYY-MM-DD. */
export function todayInEventTz(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: EVENT_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Every date from start to end inclusive (start only when end is missing). */
export function eventDays(start: string | null, end: string | null): string[] {
  if (!start || !isIsoDay(start)) return [];
  const last = end && isIsoDay(end) && end >= start ? end : start;
  const out: string[] = [];
  // Cap guards against a mistyped end date producing thousands of pills.
  for (let d = start; d <= last && out.length < 31; d = addDays(d, 1)) {
    out.push(d);
  }
  return out;
}

export type DayOption = {
  day: string;
  /** 1-based position within the event's dates; null for off-schedule days. */
  index: number | null;
};

/**
 * Days the check-in page offers: the event's own dates, any other date that
 * already has check-ins (a test scan, a pre-event registration desk) so those
 * arrivals are never invisible, and always today — the only day a desk can
 * scan for, so it must be reachable even before the event starts.
 */
export function dayOptions(
  start: string | null,
  end: string | null,
  daysWithCheckIns: string[],
  today: string = todayInEventTz(),
): DayOption[] {
  const scheduled = eventDays(start, end);
  const all = new Set([...scheduled, ...daysWithCheckIns.filter(isIsoDay), today]);
  return [...all].sort().map((day) => {
    const i = scheduled.indexOf(day);
    return { day, index: i === -1 ? null : i + 1 };
  });
}

/**
 * Today when it matters — an event day, or a day that already has arrivals —
 * else Day 1, so an organiser previewing before the event sees the event,
 * not an empty "today".
 */
export function defaultDay(
  options: DayOption[],
  daysWithCheckIns: string[],
  now: Date = new Date(),
): string {
  const today = todayInEventTz(now);
  const todayOpt = options.find((o) => o.day === today);
  if (todayOpt && (todayOpt.index !== null || daysWithCheckIns.includes(today))) {
    return today;
  }
  return options.find((o) => o.index !== null)?.day ?? today;
}

/** "Sat 12 Apr" — short weekday + date for a YYYY-MM-DD. */
export function shortDate(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** "Day 2 · 第2天" for a scheduled day, or the date itself when off-schedule. */
export function dayLabel(option: DayOption): string {
  return option.index !== null
    ? `Day ${option.index} · 第${option.index}天`
    : shortDate(option.day);
}
