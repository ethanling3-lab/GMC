import type { Metadata } from "next";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { FiltersBar } from "@/components/admin/participants/FiltersBar";
import { Pagination } from "@/components/admin/participants/Pagination";
import {
  ParticipantsTable,
  type ParticipantRow,
} from "@/components/admin/participants/ParticipantsTable";
import {
  applyParticipantFilters,
  applyRoleScope,
  DEFAULT_PAGE_SIZE,
  parseFilters,
  parsePage,
} from "@/lib/participants-query";

export const metadata: Metadata = { title: "Participants" };
export const dynamic = "force-dynamic";

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
            Shared across every event. Student IDs are assigned on registration —
            editable by admins and used for all external references.
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

      <ParticipantsTable
        rows={rows}
        adminRole={admin.role}
        hasFilters={Boolean(
          filters.q || filters.region || filters.status || filters.motivation,
        )}
      />

      <Pagination page={page} pageSize={pageSize} total={total} />
    </div>
  );
}
