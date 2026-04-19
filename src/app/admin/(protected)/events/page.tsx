import type { Metadata } from "next";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { EventsFilterBar } from "@/components/admin/events/EventsFilterBar";
import {
  EventsTable,
  type EventRow,
} from "@/components/admin/events/EventsTable";
import { Pagination } from "@/components/admin/participants/Pagination";
import {
  applyEventFilters,
  DEFAULT_PAGE_SIZE,
  parseFilters,
  parsePage,
} from "@/lib/events-query";

export const metadata: Metadata = { title: "Events" };
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function EventsPage({ searchParams }: PageProps) {
  const admin = await requireAdmin();
  const sp = await searchParams;

  const filters = parseFilters(sp);
  const page = parsePage(sp);
  const pageSize = DEFAULT_PAGE_SIZE;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const supabase = await createSupabaseServerClient();

  const columns =
    "id, slug, title_en, title_cn, type, mode, status, venue, city, country, start_date, end_date, capacity, price, currency, updated_at";

  let q = supabase.from("events").select(columns, { count: "exact" });
  q = applyEventFilters(q, filters);
  q = q.range(from, to);

  const { data, count, error } = await q;
  const rows = (error ? [] : (data ?? [])) as EventRow[];
  const total = count ?? 0;

  const { count: scopeTotal } = await supabase
    .from("events")
    .select("id", { count: "exact", head: true });

  const canCreate = admin.role === "super_admin";

  return (
    <div>
      <div className="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
            <span className="w-5 h-px bg-current" />
            Programs · 活动
          </div>
          <h1 className="mt-4 font-display text-[40px] md:text-[44px] leading-[1.05] tracking-[-0.015em] text-[var(--ink)]">
            Events
          </h1>
          <p className="mt-4 text-[14px] leading-[1.7] text-[var(--ink-soft)] max-w-[62ch]">
            Retreats, courses, workshops, and seminars. Each event has its own
            pricing, payment methods, target audience filter, and optional
            accommodations — set them here before opening enrollment.
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {canCreate ? (
            <Link
              href="/admin/events/new"
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
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M6 2v8M2 6h8" />
              </svg>
              New event
            </Link>
          ) : null}

          <div
            className="rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)]
                       px-5 py-3.5 text-right shadow-[var(--shadow-paper-1)]"
          >
            <div className="text-[9px] tracking-[0.28em] uppercase text-[var(--ink-faint)]">
              Total
            </div>
            <div className="mt-0.5 font-display text-[28px] leading-[1] tracking-[-0.015em] text-[var(--ink)]">
              {(scopeTotal ?? 0).toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      <EventsFilterBar
        initialQ={filters.q ?? ""}
        activeCount={total}
        totalCount={scopeTotal ?? null}
        initialArchived={filters.archived ?? "active"}
      />

      <EventsTable
        rows={rows}
        hasFilters={Boolean(
          filters.q || filters.status || filters.type || filters.mode,
        )}
        canEdit={admin.role === "super_admin"}
        canCreate={canCreate}
      />

      <Pagination page={page} pageSize={pageSize} total={total} />
    </div>
  );
}
