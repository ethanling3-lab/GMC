import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MOTIVATIONS, type MotivationTag } from "@/lib/participants/motivations";
import { sgDay } from "@/lib/pricing/tiers";

/**
 * Replaces the old `participant_status` lifecycle enum (dropped in migration
 * 053). Not a lifecycle — it answers exactly one question: has this row been
 * confirmed to be a real, distinct person? See the migration for the full
 * rationale.
 */
export type IdentityConfidence = "unverified" | "verified";

export type { MotivationTag };

export type ParticipantFilters = {
  q?: string;
  region?: string;
  /** Omitted or `"all"` = everyone; "verified" / "unverified" narrow it. */
  identity?: IdentityConfidence | "all";
  motivation?: MotivationTag;
  /** "only" = parent-managed children (migration 084), "adults" = everyone else. */
  minors?: "only" | "adults";
  /**
   * Student status TODAY, same rule as pricing (participantPriceCategory):
   * a programme slug = that programme, still valid; "classic_member" = had a
   * programme, now expired (经典永流传); "returning_student" = no programme,
   * attended before (tick or a check-in); "new_student" = none of these.
   */
  status?: string;
  sort?: "recent" | "oldest" | "region_id" | "name" | "qualification";
  /** "active" (default) hides archived, "archived" shows only archived, "all" shows both. */
  archived?: "active" | "archived" | "all";
};

export const DEFAULT_PAGE_SIZE = 50;

const IDENTITY_VALUES: IdentityConfidence[] = ["unverified", "verified"];

const MOTIVATION_VALUES: readonly MotivationTag[] = MOTIVATIONS;

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

  const identityRaw = get("identity");
  const identity: ParticipantFilters["identity"] =
    identityRaw === "all"
      ? "all"
      : identityRaw && (IDENTITY_VALUES as string[]).includes(identityRaw)
        ? (identityRaw as IdentityConfidence)
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

  const minorsRaw = get("minors");
  const minors: ParticipantFilters["minors"] =
    minorsRaw === "only" || minorsRaw === "adults" ? minorsRaw : undefined;

  const statusRaw = get("status");
  const status = statusRaw && /^[a-z_]{1,60}$/.test(statusRaw) ? statusRaw : undefined;

  return { q, region, identity, motivation, minors, status, sort, archived };
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

/** Programmes the Student status filter can pick (slug → id). */
export type StatusContext = { programmes: Array<{ id: string; slug: string }> };

export const BASE_STATUS_VALUES = ["classic_member", "returning_student", "new_student"] as const;

export type StatusProgramme = { id: string; slug: string; name_cn: string | null; name_en: string | null };

export async function loadStatusContext(supabase: SupabaseClient): Promise<{ programmes: StatusProgramme[] }> {
  const { data } = await supabase
    .from("programmes")
    .select("id, slug, name_cn, name_en")
    .order("sort_order", { ascending: true, nullsFirst: false });
  return { programmes: (data ?? []) as Array<{ id: string; slug: string; name_cn: string | null; name_en: string | null }> };
}

/**
 * Applies filters + sort to a participants select query.
 * Pass the *select* builder, not a raw .from() — caller controls which columns.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyParticipantFilters<T extends { ilike: any; eq: any; or: any; order: any; is: any; not: any; contains: any; lt: any }>(
  query: T,
  filters: ParticipantFilters,
  ctx?: StatusContext,
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
  if (filters.identity === "all" || !filters.identity) {
    // Everyone. The roster shows everyone by default (Ethan, 2026-11-26);
    // "verified" / "unverified" narrow it. Broadcasts pass "all" explicitly.
  } else if (filters.identity) {
    q = q.eq("identity_confidence", filters.identity);
  }
  if (filters.motivation) q = q.contains("motivations", [filters.motivation]);
  if (filters.minors === "only") q = q.eq("is_minor", true);
  else if (filters.minors === "adults") q = q.eq("is_minor", false);

  if (filters.status) {
    // A programme is valid through its last day in SGT — same as pricing.
    const todayStart = `${sgDay()}T00:00:00+08:00`;
    switch (filters.status) {
      case "classic_member":
        q = q.not("programme_id", "is", null).lt("programme_expires_at", todayStart);
        break;
      case "returning_student":
        q = q.is("programme_id", null).or("is_old_student.is.true,has_checked_in.is.true");
        break;
      case "new_student":
        q = q
          .is("programme_id", null)
          .or("is_old_student.is.null,is_old_student.is.false")
          .eq("has_checked_in", false);
        break;
      default: {
        const prog = ctx?.programmes.find((p) => p.slug === filters.status);
        // Unknown programme → no rows, rather than silently everyone.
        q = q.eq("programme_id", prog?.id ?? "00000000-0000-0000-0000-000000000000");
        q = q.or(`programme_expires_at.is.null,programme_expires_at.gte.${todayStart}`);
      }
    }
  }

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
