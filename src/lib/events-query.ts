import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EventMode, EventStatus, EventType } from "./events-shared";

export type { EventStatus, EventType, EventMode } from "./events-shared";
export { STATUS_LABEL, TYPE_LABEL } from "./events-shared";

export type EventFilters = {
  q?: string;
  status?: EventStatus;
  type?: EventType;
  mode?: EventMode;
  sort?: "recent" | "oldest" | "start_soonest" | "start_latest" | "title";
  /** "active" (default) hides archived, "archived" shows only archived, "all" shows both. */
  archived?: "active" | "archived" | "all";
};

export const DEFAULT_PAGE_SIZE = 25;

const STATUS_VALUES: EventStatus[] = ["draft", "open", "closed", "archived"];
const TYPE_VALUES: EventType[] = [
  "retreat",
  "course",
  "single_class",
  "delivery_class",
  "other",
];
const MODE_VALUES: EventMode[] = ["online", "offline"];
const SORT_VALUES = [
  "recent",
  "oldest",
  "start_soonest",
  "start_latest",
  "title",
] as const;

export function parseFilters(
  sp: URLSearchParams | Record<string, string | string[] | undefined>,
): EventFilters {
  const get = (k: string): string | undefined => {
    if (sp instanceof URLSearchParams) return sp.get(k) ?? undefined;
    const v = sp[k];
    if (Array.isArray(v)) return v[0];
    return v ?? undefined;
  };

  const q = get("q")?.trim() || undefined;

  const statusRaw = get("status");
  const status =
    statusRaw && (STATUS_VALUES as string[]).includes(statusRaw)
      ? (statusRaw as EventStatus)
      : undefined;

  const typeRaw = get("type");
  const type =
    typeRaw && (TYPE_VALUES as string[]).includes(typeRaw)
      ? (typeRaw as EventType)
      : undefined;

  const modeRaw = get("mode");
  const mode =
    modeRaw && (MODE_VALUES as string[]).includes(modeRaw)
      ? (modeRaw as EventMode)
      : undefined;

  const sortRaw = get("sort");
  const sort =
    sortRaw && (SORT_VALUES as readonly string[]).includes(sortRaw)
      ? (sortRaw as EventFilters["sort"])
      : "recent";

  const archivedRaw = get("archived");
  const archived: EventFilters["archived"] =
    archivedRaw === "archived" || archivedRaw === "all"
      ? archivedRaw
      : "active";

  return { q, status, type, mode, sort, archived };
}

export function parsePage(
  sp: URLSearchParams | Record<string, string | string[] | undefined>,
): number {
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyEventFilters<T extends { ilike: any; eq: any; or: any; order: any; neq: any }>(
  query: T,
  filters: EventFilters,
): T {
  let q = query;

  if (filters.q) {
    const needle = `%${filters.q.replace(/[%_]/g, "\\$&")}%`;
    q = q.or(
      [
        `title_en.ilike.${needle}`,
        `title_cn.ilike.${needle}`,
        `slug.ilike.${needle}`,
        `venue.ilike.${needle}`,
        `city.ilike.${needle}`,
      ].join(","),
    );
  }

  if (filters.status) q = q.eq("status", filters.status);
  if (filters.type) q = q.eq("type", filters.type);
  if (filters.mode) q = q.eq("mode", filters.mode);

  // Archived scope — "active" hides status=archived; "archived" shows only
  // archived; "all" no-ops. Note: the events table uses the status enum for
  // archive state (not a separate archived_at column like participants).
  const archivedMode = filters.archived ?? "active";
  if (archivedMode === "active") q = q.neq("status", "archived");
  else if (archivedMode === "archived") q = q.eq("status", "archived");

  switch (filters.sort) {
    case "oldest":
      q = q.order("created_at", { ascending: true });
      break;
    case "start_soonest":
      q = q.order("start_date", { ascending: true, nullsFirst: false });
      break;
    case "start_latest":
      q = q.order("start_date", { ascending: false, nullsFirst: false });
      break;
    case "title":
      q = q.order("title_en", { ascending: true, nullsFirst: false });
      break;
    case "recent":
    default:
      q = q.order("created_at", { ascending: false });
  }

  return q;
}

