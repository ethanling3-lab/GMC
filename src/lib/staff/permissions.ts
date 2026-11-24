// Who can open what. Enforced for every /admin page and /api/admin route by
// middleware.ts, so anything not listed here is blocked for limited roles.
// This file must stay free of server-only imports: middleware and client
// components both read it.

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type ApiRule = { path: RegExp; methods: readonly Method[] };

const ID = "[^/]+";
const READ: readonly Method[] = ["GET"];
const WRITE: readonly Method[] = ["POST"];

const CS_PAGES: readonly RegExp[] = [
  /^\/admin\/participants$/,
  new RegExp(`^/admin/participants/(?!new$|import$)${ID}$`),
  /^\/admin\/events$/,
  new RegExp(`^/admin/events/(?!new$)${ID}/(logistics|check-in|check-in/scan|my-participants)$`),
];

const FINANCE_PAGES: readonly RegExp[] = [
  /^\/admin\/finance$/,
  new RegExp(`^/admin/finance/imports/${ID}$`),
  /^\/admin\/events$/,
  new RegExp(`^/admin/events/(?!new$)${ID}/enrollments$`),
];

const CS_API: readonly ApiRule[] = [
  { path: /^\/api\/admin\/participants\/search$/, methods: READ },
  { path: new RegExp(`^/api/admin/participants/${ID}$`), methods: ["PATCH"] },
  { path: new RegExp(`^/api/admin/participants/${ID}/photo$`), methods: WRITE },
  { path: new RegExp(`^/api/admin/participants/${ID}/face-embedding$`), methods: WRITE },
  { path: new RegExp(`^/api/admin/participants/${ID}/face-reading$`), methods: ["POST", "PATCH"] },
  { path: /^\/api\/admin\/flight-info$/, methods: ["POST", "DELETE"] },
  { path: /^\/api\/admin\/flight-followups$/, methods: ["PATCH"] },
  { path: new RegExp(`^/api/admin/events/${ID}/check-in$`), methods: ["GET", "POST", "DELETE"] },
  { path: new RegExp(`^/api/admin/events/${ID}/check-in/search$`), methods: READ },
];

const FINANCE_API: readonly ApiRule[] = [
  { path: /^\/api\/admin\/finance\/imports$/, methods: WRITE },
  { path: /^\/api\/admin\/finance\/search-enrollments$/, methods: READ },
  { path: new RegExp(`^/api/admin/finance/transactions/${ID}$`), methods: ["PATCH"] },
  { path: new RegExp(`^/api/admin/enrollments/${ID}/slip$`), methods: READ },
  { path: new RegExp(`^/api/admin/events/${ID}/enrollments/export$`), methods: READ },
];

function normalise(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

/** Where a role lands after sign-in, or when it opens a page it can't use. */
export function landingPath(role: string): string | null {
  if (role === "super_admin") return "/admin";
  if (role === "customer_service") return "/admin/participants";
  if (role === "finance") return "/admin/finance";
  return null;
}

export function canOpenPage(role: string, rawPath: string): boolean {
  if (role === "super_admin") return true;
  const path = normalise(rawPath);
  if (role === "customer_service") return CS_PAGES.some((rule) => rule.test(path));
  if (role === "finance") return FINANCE_PAGES.some((rule) => rule.test(path));
  return false;
}

export function canCallApi(role: string, method: string, rawPath: string): boolean {
  if (role === "super_admin") return true;
  const path = normalise(rawPath);
  const rules =
    role === "customer_service" ? CS_API : role === "finance" ? FINANCE_API : [];
  return rules.some(
    (rule) => rule.path.test(path) && rule.methods.includes(method as Method),
  );
}

/** A limited role opening an event goes to its own working page for that event. */
export function eventHomePath(role: string, eventId: string): string | null {
  if (role === "customer_service") return `/admin/events/${eventId}/my-participants`;
  if (role === "finance") return `/admin/events/${eventId}/enrollments`;
  return null;
}

export const isSuperAdmin = (role: string) => role === "super_admin";
