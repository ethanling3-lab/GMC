import type { Metadata } from "next";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { EventsFilterBar } from "@/components/admin/events/EventsFilterBar";
import { Pagination } from "@/components/admin/participants/Pagination";
import {
  applyEventFilters,
  DEFAULT_PAGE_SIZE,
  parseFilters,
  parsePage,
  STATUS_LABEL,
  TYPE_LABEL,
  type EventStatus,
  type EventType,
  type EventMode,
} from "@/lib/events-query";

export const metadata: Metadata = { title: "Events" };
export const dynamic = "force-dynamic";

type EventRow = {
  id: string;
  slug: string;
  title_en: string | null;
  title_cn: string | null;
  type: EventType;
  mode: EventMode;
  status: EventStatus;
  venue: string | null;
  city: string | null;
  country: string | null;
  start_date: string | null;
  end_date: string | null;
  capacity: number | null;
  price: number | null;
  currency: string;
  updated_at: string;
};

const STATUS_TONE: Record<
  EventStatus,
  { dot: string; bg: string; ring: string; text: string }
> = {
  draft: {
    dot: "bg-[var(--ink-faint)]",
    bg: "bg-[var(--paper)]",
    ring: "border-[var(--paper-shadow)]",
    text: "text-[var(--ink-mute)]",
  },
  open: {
    dot: "bg-[var(--jade)]",
    bg: "bg-[var(--jade-wash)]",
    ring: "border-[var(--jade)]/25",
    text: "text-[var(--jade-deep)]",
  },
  closed: {
    dot: "bg-[var(--cinnabar)]",
    bg: "bg-[var(--cinnabar-wash)]",
    ring: "border-[var(--cinnabar)]/25",
    text: "text-[var(--cinnabar-deep)]",
  },
  archived: {
    dot: "bg-[var(--ink)]",
    bg: "bg-[var(--paper-deep)]",
    ring: "border-[var(--ink-faint)]/40",
    text: "text-[var(--ink)]",
  },
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDateRange(start: string | null, end: string | null): string {
  if (!start && !end) return "—";
  if (start && end && start !== end) {
    return `${formatDate(start)} → ${formatDate(end)}`;
  }
  return formatDate(start ?? end);
}

function title(r: EventRow): string {
  const en = r.title_en?.trim();
  const cn = r.title_cn?.trim();
  if (en && cn) return `${en} · ${cn}`;
  return en || cn || r.slug;
}

function formatPrice(price: number | null, currency: string): string {
  if (price === null || price === undefined) return "—";
  return `${currency} ${price.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

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

      <div
        className="mt-6 rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)]
                   shadow-[var(--shadow-paper-1)] overflow-hidden"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px] text-[var(--ink-soft)]">
            <thead className="bg-[var(--paper-deep)]/70 text-[9px] tracking-[0.22em] uppercase text-[var(--ink-mute)]">
              <tr>
                <th scope="col" className="px-5 py-3.5 font-medium">Title</th>
                <th scope="col" className="px-5 py-3.5 font-medium">Type</th>
                <th scope="col" className="px-5 py-3.5 font-medium">Where</th>
                <th scope="col" className="px-5 py-3.5 font-medium">Dates</th>
                <th scope="col" className="px-5 py-3.5 font-medium">Status</th>
                <th scope="col" className="px-5 py-3.5 font-medium text-right">Capacity</th>
                <th scope="col" className="px-5 py-3.5 font-medium text-right">Price</th>
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
                          <rect x="2.5" y="3.5" width="11" height="10" rx="1.4" />
                          <path d="M2.5 6.5h11" />
                          <path d="M5.5 2v3M10.5 2v3" />
                        </svg>
                      </span>
                      <div className="text-[13px] text-[var(--ink)]">
                        {filters.q || filters.status || filters.type || filters.mode
                          ? "No events match these filters"
                          : "No events yet"}
                      </div>
                      <div className="text-[12px] text-[var(--ink-mute)] max-w-[44ch]">
                        {filters.q || filters.status || filters.type || filters.mode
                          ? "Try widening the filters or clearing search."
                          : canCreate
                            ? "Create the first event — add bilingual titles, dates, pricing, and a target audience filter."
                            : "Ask a super admin to create the first event."}
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const tone = STATUS_TONE[r.status];
                  const where = [r.venue, r.city, r.country]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <tr
                      key={r.id}
                      className="border-t border-[var(--paper-shadow)] hover:bg-[var(--paper-deep)]/55 transition-colors duration-[var(--dur-fast)] has-[a:focus-visible]:bg-[var(--paper-deep)]/55"
                    >
                      <td className="px-5 py-3.5">
                        <Link
                          href={`/admin/events/${r.id}`}
                          className="block hover:text-[var(--cinnabar)] transition-colors duration-[var(--dur-fast)] focus-visible:shadow-[var(--shadow-focus)] rounded-sm"
                        >
                          <div className="text-[var(--ink)] font-medium">
                            {title(r)}
                          </div>
                          <div className="mt-0.5 font-mono text-[11px] text-[var(--ink-faint)]">
                            /{r.slug}
                          </div>
                        </Link>
                      </td>
                      <td className="px-5 py-3.5 text-[var(--ink-mute)]">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[12px] text-[var(--ink)]">
                            {TYPE_LABEL[r.type].en}
                          </span>
                          <span className="text-[10px] tracking-[0.14em] uppercase text-[var(--ink-faint)]">
                            {r.mode === "online" ? "Online" : "In-person"}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-[var(--ink-mute)] max-w-[220px] truncate">
                        {where || (
                          <span className="text-[var(--ink-faint)]">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-[var(--ink-mute)] whitespace-nowrap">
                        {formatDateRange(r.start_date, r.end_date)}
                      </td>
                      <td className="px-5 py-3.5">
                        <span
                          className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full border
                                      text-[10px] tracking-[0.14em] uppercase
                                      ${tone.bg} ${tone.ring} ${tone.text}`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${tone.dot}`}
                            aria-hidden="true"
                          />
                          {STATUS_LABEL[r.status].en}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right tabular-nums">
                        {typeof r.capacity === "number" ? (
                          <span className="text-[var(--ink)]">
                            {r.capacity.toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-[var(--ink-faint)]">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-right tabular-nums text-[var(--ink)]">
                        {formatPrice(r.price, r.currency)}
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
