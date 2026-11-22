// Live desk mode for an event (events.check_in_mode). Pure — server + client.
//
// GMC days run: Morning registration → Morning class → (lunch) → Afternoon
// registration → Afternoon class, with official breaks announced on stage in
// between. The organizer moves the event through these; every desk follows.
//
//   registration → a scan checks the person in for that session
//   class        → a scan logs them out of class, the next one logs them back
//   break        → nothing is recorded (official breaks aren't logged)

export const CHECK_IN_MODES = [
  "am_registration",
  "am_class",
  "break",
  "pm_registration",
  "pm_class",
] as const;

export type CheckInMode = (typeof CHECK_IN_MODES)[number];

export type Session = "am" | "pm";

export const SESSIONS: readonly Session[] = ["am", "pm"];

export function isCheckInMode(v: unknown): v is CheckInMode {
  return typeof v === "string" && (CHECK_IN_MODES as readonly string[]).includes(v);
}

export function isSession(v: unknown): v is Session {
  return v === "am" || v === "pm";
}

/** Session a mode belongs to; null for an official break. */
export function sessionOf(mode: CheckInMode): Session | null {
  if (mode === "am_registration" || mode === "am_class") return "am";
  if (mode === "pm_registration" || mode === "pm_class") return "pm";
  return null;
}

export function isRegistration(mode: CheckInMode): boolean {
  return mode === "am_registration" || mode === "pm_registration";
}

export function isClass(mode: CheckInMode): boolean {
  return mode === "am_class" || mode === "pm_class";
}

export const MODE_LABEL: Record<CheckInMode, { en: string; cn: string }> = {
  am_registration: { en: "Morning registration", cn: "早上签到" },
  am_class: { en: "Morning class", cn: "早上上课" },
  break: { en: "Official break", cn: "官方休息" },
  pm_registration: { en: "Afternoon registration", cn: "下午签到" },
  pm_class: { en: "Afternoon class", cn: "下午上课" },
};

export const SESSION_LABEL: Record<Session, { en: string; cn: string }> = {
  am: { en: "Morning", cn: "早上" },
  pm: { en: "Afternoon", cn: "下午" },
};

export function modeLabel(mode: CheckInMode): string {
  const l = MODE_LABEL[mode];
  return `${l.en} · ${l.cn}`;
}
