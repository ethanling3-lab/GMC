// Live desk mode for an event (events.check_in_mode). Pure — server + client.
//
// GMC days have two registrations: Morning, and Afternoon after lunch. The
// organizer moves the event between them and every desk follows; a scan
// checks the person in for whichever one is on.

export const CHECK_IN_MODES = ["am_registration", "pm_registration"] as const;

export type CheckInMode = (typeof CHECK_IN_MODES)[number];

export type Session = "am" | "pm";

export const SESSIONS: readonly Session[] = ["am", "pm"];

export function isSession(v: unknown): v is Session {
  return v === "am" || v === "pm";
}

/**
 * The stored value as a current mode. The column's check constraint still
 * allows the retired am_class / pm_class / break values, and an event may
 * hold one: class modes map to their session, anything else to Morning.
 */
export function normaliseMode(v: unknown): CheckInMode {
  return typeof v === "string" && v.startsWith("pm_") ? "pm_registration" : "am_registration";
}

export function sessionOf(mode: CheckInMode): Session {
  return mode === "pm_registration" ? "pm" : "am";
}

export const MODE_LABEL: Record<CheckInMode, { en: string; cn: string }> = {
  am_registration: { en: "Morning registration", cn: "早上签到" },
  pm_registration: { en: "Afternoon registration", cn: "下午签到" },
};

export const SESSION_LABEL: Record<Session, { en: string; cn: string }> = {
  am: { en: "Morning", cn: "早上" },
  pm: { en: "Afternoon", cn: "下午" },
};
