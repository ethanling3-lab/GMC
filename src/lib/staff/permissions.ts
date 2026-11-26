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
  // Year calendar (Phase 1) — read-only for limited roles; writes are
  // Super Admin APIs, which are never listed here.
  /^\/admin\/calendar$/,
  // Programmes + their course lists — read-only (writes are Super Admin APIs).
  /^\/admin\/programmes$/,
  new RegExp(`^/admin/programmes/(?!new$)${ID}$`),
  /^\/admin\/participants$/,
  new RegExp(`^/admin/participants/(?!new$|import$|assign$)${ID}$`),
  /^\/admin\/events$/,
  new RegExp(`^/admin/events/(?!new$)${ID}/(logistics|check-in|check-in/scan|my-participants)$`),
  // Instalments of their own customers, read-only (Phase 2, 2026-11-26).
  /^\/admin\/finance\/instalments$/,
];

const FINANCE_PAGES: readonly RegExp[] = [
  // Year calendar (Phase 1) — read-only for limited roles; writes are
  // Super Admin APIs, which are never listed here.
  /^\/admin\/calendar$/,
  // Programmes + their course lists — read-only.
  /^\/admin\/programmes$/,
  new RegExp(`^/admin/programmes/(?!new$)${ID}$`),
  /^\/admin\/finance$/,
  new RegExp(`^/admin/finance/imports/${ID}$`),
  /^\/admin\/events$/,
  new RegExp(`^/admin/events/(?!new$)${ID}/enrollments$`),
  // Phase 2 payments (2026-11-26): payment counter, instalments, templates.
  new RegExp(`^/admin/events/(?!new$)${ID}/counter$`),
  /^\/admin\/finance\/(instalments|templates|purchases)$/,
  new RegExp(`^/admin/finance/purchases/${ID}$`),
];

const CS_API: readonly ApiRule[] = [
  { path: /^\/api\/admin\/participants\/search$/, methods: READ },
  { path: /^\/api\/admin\/participants\/leaders\/search$/, methods: READ },
  { path: new RegExp(`^/api/admin/participants/${ID}$`), methods: ["PATCH"] },
  { path: new RegExp(`^/api/admin/participants/${ID}/photo$`), methods: WRITE },
  { path: /^\/api\/admin\/flight-info$/, methods: ["POST", "DELETE"] },
  { path: /^\/api\/admin\/flight-followups$/, methods: ["PATCH"] },
  { path: new RegExp(`^/api/admin/events/${ID}/check-in$`), methods: ["GET", "POST", "DELETE"] },
  { path: new RegExp(`^/api/admin/events/${ID}/check-in/search$`), methods: READ },
  { path: /^\/api\/admin\/finance\/instalments\/export$/, methods: READ },
];

const FINANCE_API: readonly ApiRule[] = [
  { path: /^\/api\/admin\/finance\/imports$/, methods: WRITE },
  { path: /^\/api\/admin\/finance\/search-enrollments$/, methods: READ },
  { path: new RegExp(`^/api/admin/finance/transactions/${ID}$`), methods: ["PATCH"] },
  { path: new RegExp(`^/api/admin/enrollments/${ID}/slip$`), methods: READ },
  { path: new RegExp(`^/api/admin/events/${ID}/enrollments/export$`), methods: READ },
  // Phase 2 payments (2026-11-26).
  { path: new RegExp(`^/api/admin/events/${ID}/counter/checkout$`), methods: WRITE },
  { path: new RegExp(`^/api/admin/events/${ID}/counter/(person|takings)$`), methods: READ },
  { path: /^\/api\/admin\/payments\/people$/, methods: READ },
  { path: new RegExp(`^/api/admin/payments/${ID}$`), methods: ["PATCH"] },
  { path: new RegExp(`^/api/admin/participants/${ID}/purchases$`), methods: WRITE },
  { path: new RegExp(`^/api/admin/purchases/${ID}$`), methods: ["PATCH"] },
  { path: new RegExp(`^/api/admin/purchases/${ID}/payments$`), methods: WRITE },
  { path: /^\/api\/admin\/finance\/templates$/, methods: ["GET", "POST"] },
  { path: new RegExp(`^/api/admin/finance/templates/${ID}$`), methods: ["PATCH"] },
  { path: /^\/api\/admin\/finance\/instalments\/export$/, methods: READ },
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
