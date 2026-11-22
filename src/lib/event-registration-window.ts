// The Event Editor's enrollment open/close dates. Blank means no limit.
// Staff can still add someone manually from the event's Enrolments page.

export type RegistrationBlock = "not_open_yet" | "closed";

export function registrationBlock(
  event: {
    enrollment_opens_at?: string | null;
    enrollment_closes_at?: string | null;
  },
  now: Date = new Date(),
): RegistrationBlock | null {
  const opens = event.enrollment_opens_at
    ? new Date(event.enrollment_opens_at).getTime()
    : null;
  const closes = event.enrollment_closes_at
    ? new Date(event.enrollment_closes_at).getTime()
    : null;
  if (opens !== null && now.getTime() < opens) return "not_open_yet";
  if (closes !== null && now.getTime() > closes) return "closed";
  return null;
}

export function registrationBlockLabel(
  block: RegistrationBlock,
  locale: "zh" | "en",
): string {
  if (block === "not_open_yet") {
    return locale === "zh" ? "报名尚未开放" : "Registration not open yet";
  }
  return locale === "zh" ? "报名已截止" : "Registration closed";
}
