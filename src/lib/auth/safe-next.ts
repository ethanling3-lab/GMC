// Where a member may be sent after signing in. Only our own member pages and
// an event's one-click register page; anything else (other sites, "//host",
// admin pages) falls back to /me.
const EVENT_REGISTER = /^\/events\/[A-Za-z0-9._~%-]+\/register$/;

export function safeMemberNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/me";
  if (next === "/me" || next.startsWith("/me/") || next.startsWith("/me?")) return next;
  if (EVENT_REGISTER.test(next)) return next;
  return "/me";
}
