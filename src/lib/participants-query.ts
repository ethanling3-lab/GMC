import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ParticipantStatus =
  | "new"
  | "info_verified"
  | "cs_enriched"
  | "active"
  | "inactive"
  | "lead";

export type MotivationTag =
  | "clean"
  | "insurance"
  | "direct_sales"
  | "spiritual"
  | "other";

export type ParticipantFilters = {
  q?: string;
  region?: string;
  status?: ParticipantStatus;
  motivation?: MotivationTag;
  sort?: "recent" | "oldest" | "region_id" | "name" | "qualification";
  /** "active" (default) hides archived, "archived" shows only archived, "all" shows both. */
  archived?: "active" | "archived" | "all";
};

export const DEFAULT_PAGE_SIZE = 50;

const STATUS_VALUES: ParticipantStatus[] = [
  "new",
  "info_verified",
  "cs_enriched",
  "active",
  "inactive",
  "lead",
];

const MOTIVATION_VALUES: MotivationTag[] = [
  "clean",
  "insurance",
  "direct_sales",
  "spiritual",
  "other",
];

const REGION_VALUES = ["MY", "SG", "TW", "HK", "CN"] as const;

const SORT_VALUES = [
  "recent",
  "oldest",
  "region_id",
  "name",
  "qualification",
] as const;

export function parseFilters(sp: URLSearchParams | Record<string, string | string[] | undefined>): ParticipantFilters {
  const get = (k: string): string | undefined => {
    if (sp instanceof URLSearchParams) return sp.get(k) ?? undefined;
    const v = sp[k];
    if (Array.isArray(v)) return v[0];
    return v ?? undefined;
  };

  const q = get("q")?.trim() || undefined;

  const regionRaw = get("region");
  const region =
    regionRaw && (REGION_VALUES as readonly string[]).includes(regionRaw)
      ? regionRaw
      : undefined;

  const statusRaw = get("status");
  const status =
    statusRaw && (STATUS_VALUES as string[]).includes(statusRaw)
      ? (statusRaw as ParticipantStatus)
      : undefined;

  const motivationRaw = get("motivation");
  const motivation =
    motivationRaw && (MOTIVATION_VALUES as string[]).includes(motivationRaw)
      ? (motivationRaw as MotivationTag)
      : undefined;

  const sortRaw = get("sort");
  const sort =
    sortRaw && (SORT_VALUES as readonly string[]).includes(sortRaw)
      ? (sortRaw as ParticipantFilters["sort"])
      : "recent";

  const archivedRaw = get("archived");
  const archived: ParticipantFilters["archived"] =
    archivedRaw === "archived" || archivedRaw === "all" ? archivedRaw : "active";

  return { q, region, status, motivation, sort, archived };
}

export function parsePage(sp: URLSearchParams | Record<string, string | string[] | undefined>): number {
  const raw =
    sp instanceof URLSearchParams
      ? sp.get("page")
      : Array.isArray(sp.page)
        ? sp.page[0]
        : sp.page;
  const n = raw ? parseInt(raw, 10) : 1;
  if (!Number.isFinite(n) || n < 1) return 1;
  return n;
}

type QueryBuilder = ReturnType<SupabaseClient["from"]>;

/**
 * Applies filters + sort to a participants select query.
 * Pass the *select* builder, not a raw .from() — caller controls which columns.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyParticipantFilters<T extends { ilike: any; eq: any; or: any; order: any; is: any; not: any }>(
  query: T,
  filters: ParticipantFilters,
): T {
  let q = query;

  if (filters.q) {
    const needle = `%${filters.q.replace(/[%_]/g, "\\$&")}%`;
    q = q.or(
      [
        `name_en.ilike.${needle}`,
        `name_cn.ilike.${needle}`,
        `region_id.ilike.${needle}`,
        `email.ilike.${needle}`,
        `phone.ilike.${needle}`,
      ].join(","),
    );
  }

  if (filters.region) q = q.eq("region", filters.region);
  if (filters.status) q = q.eq("status", filters.status);
  else {
    // Hide inbox-created leads from the student master by default. Leads are
    // pre-participants (autocreated from first WhatsApp/LINE inbound) and
    // don't belong in the roster until an admin links them to a real
    // participant. Admins can still reach them via an explicit `?status=lead`
    // filter on the URL.
    q = q.not("status", "eq", "lead");
  }
  if (filters.motivation) q = q.eq("motivation_tag", filters.motivation);

  // Archived scope — default excludes archived.
  const archivedMode = filters.archived ?? "active";
  if (archivedMode === "active") q = q.is("archived_at", null);
  else if (archivedMode === "archived") q = q.not("archived_at", "is", null);
  // "all" adds no filter

  switch (filters.sort) {
    case "oldest":
      q = q.order("created_at", { ascending: true });
      break;
    case "region_id":
      q = q.order("region_id", { ascending: true, nullsFirst: false });
      break;
    case "name":
      q = q.order("name_en", { ascending: true, nullsFirst: false });
      break;
    case "qualification":
      // Order by max(financial, influence) descending. PostgREST can't
      // sort on a computed expression, so we approximate with a two-key
      // sort that puts higher financial scorers first, then influence.
      // Close enough for a roster scan; admins use the curate modal for
      // exact filtering.
      q = q.order("financial_score", { ascending: false, nullsFirst: false });
      q = q.order("influence_score", { ascending: false, nullsFirst: false });
      break;
    case "recent":
    default:
      q = q.order("created_at", { ascending: false });
  }

  return q;
}

/**
 * Applies role-based scoping. Regional leads see only their region.
 * Customer service sees only participants assigned to them.
 * Super admin + finance + instructor see everything.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyRoleScope<T extends { eq: any }>(
  query: T,
  role: string,
  adminId: string,
  region: string | null,
): T {
  if (role === "regional_lead" && region) {
    return query.eq("region", region);
  }
  if (role === "customer_service") {
    return query.eq("assigned_cs_id", adminId);
  }
  return query;
}
