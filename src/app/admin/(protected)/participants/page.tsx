import type { Metadata } from "next";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { FiltersBar } from "@/components/admin/participants/FiltersBar";
import { Pagination } from "@/components/admin/participants/Pagination";
import {
  applyParticipantFilters,
  applyRoleScope,
  DEFAULT_PAGE_SIZE,
  parseFilters,
  parsePage,
  type ParticipantStatus,
} from "@/lib/participants-query";

export const metadata: Metadata = { title: "Participants" };
export const dynamic = "force-dynamic";

type ParticipantRow = {
  id: string;
  region_id: string | null;
  name_cn: string | null;
  name_en: string | null;
  region: string | null;
  email: string | null;
  status: ParticipantStatus;
  overall_score: number | null;
  motivation_tag: string | null;
  archived_at: string | null;
  created_at: string;
};

const STATUS_LABEL: Record<ParticipantStatus, string> = {
  new: "New",
  info_verified: "Info Verified",
  cs_enriched: "CS Enriched",
  active: "Active",
  inactive: "Inactive",
};

const STATUS_TONE: Record<
  ParticipantStatus,
  { dot: string; bg: string; ring: string; text: string }
> = {
  new: {
    dot: "bg-[var(--cinnabar)]",
    bg: "bg-[var(--cinnabar-wash)]",
    ring: "border-[var(--cinnabar)]/25",
    text: "text-[var(--cinnabar-deep)]",
  },
  info_verified: {
    dot: "bg-[var(--jade)]",
    bg: "bg-[var(--jade-wash)]",
    ring: "border-[var(--jade)]/25",
    text: "text-[var(--jade-deep)]",
  },
  cs_enriched: {
    dot: "bg-[var(--cinnabar-soft)]",
    bg: "bg-[var(--gold-soft)]",
    ring: "border-[var(--cinnabar-soft)]/35",
    text: "text-[var(--cinnabar-deep)]",
  },
  active: {
    dot: "bg-[var(--ink)]",
    bg: "bg-[var(--paper-deep)]",
    ring: "border-[var(--ink-faint)]/40",
    text: "text-[var(--ink)]",
  },
  inactive: {
    dot: "bg-[var(--ink-faint)]",
    bg: "bg-[var(--paper)]",
    ring: "border-[var(--paper-shadow)]",
    text: "text-[var(--ink-mute)]",
  },
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function combinedName(r: ParticipantRow): string {
  const en = r.name_en?.trim();
  const cn = r.name_cn?.trim();
  if (en && cn) return `${en} · ${cn}`;
  return en || cn || "—";
}

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ParticipantsPage({ searchParams }: PageProps) {
  const admin = await requireAdmin();
  const sp = await searchParams;

  const filters = parseFilters(sp);
  const page = parsePage(sp);
  const pageSize = DEFAULT_PAGE_SIZE;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const supabase = await createSupabaseServerClient();

  const baseSelect =
    "id, region_id, name_cn, name_en, region, email, status, overall_score, motivation_tag, archived_at, created_at";

  // Filtered + scoped query
  let q = supabase.from("participants").select(baseSelect, { count: "exact" });
  q = applyRoleScope(q, admin.role, admin.id, admin.region);
  q = applyParticipantFilters(q, filters);
  q = q.range(from, to);

  const { data, count, error } = await q;
  const rows = (error ? [] : (data ?? [])) as ParticipantRow[];
  const total = count ?? 0;

  // Also fetch unfiltered total for "X of Y matching" meta
  let totalQ = supabase.from("participants").select("id", { count: "exact", head: true });
  totalQ = applyRoleScope(totalQ, admin.role, admin.id, admin.region);
  const { count: scopeTotal } = await totalQ;

  return (
    <div>
      {/* Page header */}
      <div className="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
            <span className="w-5 h-px bg-current" />
            Student master · 学员
          </div>
          <h1 className="mt-4 font-display text-[40px] md:text-[44px] leading-[1.05] tracking-[-0.015em] text-[var(--ink)]">
            Participants
          </h1>
          <p className="mt-4 text-[14px] leading-[1.7] text-[var(--ink-soft)] max-w-[62ch]">
            Shared across every event. Region IDs are assigned on registration and
            used for all external references.
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <Link
            href="/admin/participants/new"
            className="inline-flex items-center gap-2 h-10 px-4 rounded-[var(--radius-pill)]
                       border border-[var(--paper-shadow)] bg-[var(--paper-warm)]
                       text-[12.5px] tracking-[0.04em] font-medium text-[var(--ink)]
                       hover:border-[var(--cinnabar)]/40 hover:bg-[var(--cinnabar-wash)] hover:text-[var(--cinnabar-deep)]
                       focus-visible:shadow-[var(--shadow-focus)]
                       transition-[background-color,border-color,color,transform] duration-[var(--dur-fast)]
                       active:scale-[0.98]"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M6 2v8M2 6h8" />
            </svg>
            New
          </Link>
          <Link
            href="/admin/participants/import"
            className="inline-flex items-center gap-2 h-10 px-4 rounded-[var(--radius-pill)]
                       bg-[var(--cinnabar)] hover:bg-[var(--cinnabar-deep)] text-[var(--paper-warm)]
                       text-[12.5px] tracking-[0.04em] font-medium
                       shadow-[0_4px_14px_rgba(37,99,235,0.25)]
                       focus-visible:shadow-[var(--shadow-focus)]
                       transition-[background-color,transform] duration-[var(--dur-fast)]
                       active:scale-[0.98]"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M6 1.5l1.2 2.8L10 5.5l-2.8 1.2L6 9.5 4.8 6.7 2 5.5l2.8-1.2L6 1.5z" />
            </svg>
            AI Import
          </Link>

          <div
            className="rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)]
                       px-5 py-3.5 text-right shadow-[var(--shadow-paper-1)]"
          >
            <div className="text-[9px] tracking-[0.28em] uppercase text-[var(--ink-faint)]">
              {admin.role === "regional_lead" ? `Region · ${admin.region ?? "—"}` : "Total"}
            </div>
            <div className="mt-0.5 font-display text-[28px] leading-[1] tracking-[-0.015em] text-[var(--ink)]">
              {(scopeTotal ?? 0).toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <FiltersBar
        initialQ={filters.q ?? ""}
        activeCount={total}
        totalCount={scopeTotal ?? null}
        initialArchived={filters.archived ?? "active"}
      />

      {/* Table */}
      <div
        className="mt-6 rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)]
                   shadow-[var(--shadow-paper-1)] overflow-hidden"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px] text-[var(--ink-soft)]">
            <thead className="bg-[var(--paper-deep)]/70 text-[9px] tracking-[0.22em] uppercase text-[var(--ink-mute)]">
              <tr>
                <th scope="col" className="px-5 py-3.5 font-medium">Region ID</th>
                <th scope="col" className="px-5 py-3.5 font-medium">Name</th>
                <th scope="col" className="px-5 py-3.5 font-medium">Region</th>
                <th scope="col" className="px-5 py-3.5 font-medium">Contact</th>
                <th scope="col" className="px-5 py-3.5 font-medium">Status</th>
                <th scope="col" className="px-5 py-3.5 font-medium text-right">Score</th>
                <th scope="col" className="px-5 py-3.5 font-medium text-right">Registered</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-16 text-center">
                    <div className="inline-flex flex-col items-center gap-3">
                      <span
                        className="inline-flex items-center justify-center w-10 h-10 rounded-full
                                   border border-[var(--paper-shadow)] bg-[var(--paper)]
                                   text-[var(--cinnabar)]"
                        aria-hidden="true"
                      >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="8" cy="6" r="2.6" />
                          <path d="M3 13.2a5 5 0 0 1 10 0" />
                        </svg>
                      </span>
                      <div className="text-[13px] text-[var(--ink)]">
                        {filters.q || filters.region || filters.status || filters.motivation
                          ? "No participants match these filters"
                          : "No participants yet"}
                      </div>
                      <div className="text-[12px] text-[var(--ink-mute)] max-w-[44ch]">
                        {filters.q || filters.region || filters.status || filters.motivation
                          ? "Try widening the filters or clearing search."
                          : "Public registrations will appear here as soon as the first student submits."}
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const tone = STATUS_TONE[r.status];
                  const isArchived = Boolean(r.archived_at);
                  return (
                    <tr
                      key={r.id}
                      className={`border-t border-[var(--paper-shadow)]
                                 hover:bg-[var(--paper-deep)]/55
                                 transition-colors duration-[var(--dur-fast)]
                                 has-[a:focus-visible]:bg-[var(--paper-deep)]/55
                                 ${isArchived ? "opacity-70" : ""}`}
                    >
                      <td className="px-5 py-3.5 font-mono text-[12px] text-[var(--ink)] whitespace-nowrap">
                        <Link
                          href={`/admin/participants/${r.id}`}
                          className="inline-block min-w-full hover:text-[var(--cinnabar)] transition-colors duration-[var(--dur-fast)] focus-visible:shadow-[var(--shadow-focus)] rounded-sm"
                        >
                          {r.region_id ?? (
                            <span className="text-[var(--ink-faint)]">—</span>
                          )}
                        </Link>
                      </td>
                      <td className="px-5 py-3.5 text-[var(--ink)] font-medium">
                        <Link
                          href={`/admin/participants/${r.id}`}
                          className="hover:text-[var(--cinnabar)] transition-colors duration-[var(--dur-fast)] focus-visible:shadow-[var(--shadow-focus)] rounded-sm"
                        >
                          {combinedName(r)}
                        </Link>
                      </td>
                      <td className="px-5 py-3.5 text-[var(--ink-mute)]">
                        {r.region ?? (
                          <span className="text-[var(--ink-faint)]">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-[var(--ink-mute)] max-w-[200px] truncate">
                        {r.email ?? (
                          <span className="text-[var(--ink-faint)]">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full border
                                        text-[10px] tracking-[0.14em] uppercase
                                        ${tone.bg} ${tone.ring} ${tone.text}`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${tone.dot}`}
                              aria-hidden="true"
                            />
                            {STATUS_LABEL[r.status]}
                          </span>
                          {isArchived ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full border border-[var(--ink-faint)]/30 bg-[var(--paper-deep)] text-[9px] tracking-[0.18em] uppercase text-[var(--ink-mute)]">
                              Archived
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-right tabular-nums">
                        {typeof r.overall_score === "number" ? (
                          <span className="font-display text-[15px] text-[var(--ink)]">
                            {r.overall_score}
                            <span className="text-[var(--ink-faint)] text-[11px] ml-0.5">/10</span>
                          </span>
                        ) : (
                          <span className="text-[var(--ink-faint)]">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-right text-[var(--ink-mute)] whitespace-nowrap">
                        {formatDate(r.created_at)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination page={page} pageSize={pageSize} total={total} />
    </div>
  );
}
