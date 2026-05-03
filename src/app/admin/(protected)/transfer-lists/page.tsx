import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import {
  loadTransferListsOverview,
  type TransferEventRow,
  type TransferDirectionState,
} from "@/lib/transfer/transfer-query";

export const metadata: Metadata = { title: "Transfer lists" };
export const dynamic = "force-dynamic";

export default async function TransferListsIndexPage() {
  const admin = await requireAdmin();
  if (
    admin.role !== "super_admin" &&
    admin.role !== "regional_lead" &&
    admin.role !== "instructor"
  ) {
    redirect("/admin");
  }

  const supabase = await createSupabaseServerClient();
  const events = await loadTransferListsOverview(supabase);

  const needingTransfers = events.filter(
    (e) => e.arrival_day || e.departure_day,
  );

  return (
    <div>
      <div className="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
            <span className="w-5 h-px bg-current" />
            Logistics · 接送
          </div>
          <h1 className="mt-4 font-display text-[36px] md:text-[40px] leading-[1.05] tracking-[-0.015em] text-[var(--ink)]">
            Get everyone there, on time.
          </h1>
          <p className="mt-4 max-w-[62ch] text-[14.5px] leading-[1.7] text-[var(--ink-soft)]">
            Generate airport transfer lists from confirmed flight info.
            Consolidates within 30-min windows, applies the 3-hour departure
            rule, isolates VIPs, and exports to a per-event Google Sheet.
          </p>
        </div>
        <div className="text-right">
          <div className="text-[9px] tracking-[0.28em] uppercase text-[var(--ink-faint)]">
            Events
          </div>
          <div className="mt-1 font-display text-[20px] leading-[1.1] text-[var(--ink)] tabular-nums">
            {needingTransfers.length}
          </div>
        </div>
      </div>

      <section className="mt-10 rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] p-6 shadow-[var(--shadow-paper-1)]">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
              <span className="w-4 h-px bg-current" />
              Per event · 按活动
            </div>
            <h2 className="mt-2 font-display text-[22px] leading-[1.2] tracking-[-0.01em] text-[var(--ink)]">
              Events with travel
            </h2>
          </div>
          <span className="text-[11px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
            {needingTransfers.length} event
            {needingTransfers.length === 1 ? "" : "s"}
          </span>
        </div>

        {needingTransfers.length === 0 ? (
          <p className="mt-5 text-[13px] leading-[1.7] text-[var(--ink-mute)]">
            No events have an arrival or departure day set yet. Add those on
            an event to surface it here.
          </p>
        ) : (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="text-left text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
                  <th className="pb-3 font-normal">Event</th>
                  <th className="pb-3 font-normal">Travel days</th>
                  <th className="pb-3 font-normal">Enrolled</th>
                  <th className="pb-3 font-normal">Arrivals · 接机</th>
                  <th className="pb-3 font-normal">Departures · 送机</th>
                  <th className="pb-3 font-normal text-right">Sheet</th>
                </tr>
              </thead>
              <tbody>
                {needingTransfers.map((e) => (
                  <EventRow key={e.id} row={e} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function EventRow({ row }: { row: TransferEventRow }) {
  const title =
    row.title_en || row.title_cn
      ? `${row.title_en ?? ""}${row.title_en && row.title_cn ? " · " : ""}${row.title_cn ?? ""}`
      : row.slug;
  const arr = row.arrival_day ? formatDate(row.arrival_day) : "—";
  const dep = row.departure_day ? formatDate(row.departure_day) : "—";
  return (
    <tr className="border-t border-[var(--paper-shadow)] hover:bg-[var(--paper-deep)]/50 transition-colors">
      <td className="py-3 pr-4">
        <Link
          href={`/admin/transfer-lists/${row.id}`}
          className="text-[13.5px] text-[var(--ink)] leading-[1.3] hover:text-[var(--cinnabar)] transition-colors"
          style={{ color: "inherit" }}
        >
          <span className="hover:text-[var(--cinnabar)] transition-colors">
            {title}
          </span>
        </Link>
        <div className="mt-0.5 text-[10.5px] tracking-[0.14em] uppercase text-[var(--ink-faint)]">
          {row.status} · {row.city ?? "—"}
          {row.main_venue_hotel_name ? ` · ${row.main_venue_hotel_name}` : ""}
        </div>
      </td>
      <td className="py-3 pr-4 text-[12px] text-[var(--ink-soft)] tabular-nums leading-[1.4]">
        <div>
          <span className="text-[10px] tracking-[0.18em] uppercase text-[var(--ink-faint)] mr-1.5">
            ARR
          </span>
          {arr}
        </div>
        <div>
          <span className="text-[10px] tracking-[0.18em] uppercase text-[var(--ink-faint)] mr-1.5">
            DEP
          </span>
          {dep}
        </div>
      </td>
      <td className="py-3 pr-4">
        <span className="font-display text-[16px] tabular-nums text-[var(--ink)]">
          {row.total_enrolled}
        </span>
      </td>
      <td className="py-3 pr-4">
        <DirectionPill state={row.arrival} totalEnrolled={row.total_enrolled} />
      </td>
      <td className="py-3 pr-4">
        <DirectionPill state={row.departure} totalEnrolled={row.total_enrolled} />
      </td>
      <td className="py-3 text-right">
        {row.transfer_sheet_url ? (
          <a
            href={row.transfer_sheet_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-[11px] tracking-[0.12em] uppercase text-[var(--cinnabar-deep)] hover:text-[var(--cinnabar)] transition-colors"
            style={{ color: "var(--cinnabar-deep)" }}
          >
            Open
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
              <path d="M3 1.5h4.5V6M7.5 1.5L3 6M1.5 4v3.5h3.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        ) : (
          <span className="text-[var(--ink-faint)]">—</span>
        )}
      </td>
    </tr>
  );
}

function DirectionPill({
  state,
  totalEnrolled,
}: {
  state: TransferDirectionState;
  totalEnrolled?: number;
}) {
  // Always render the X/Y confirmed ratio against the enrolled denominator
  // when available — that's the most useful single number for "should I
  // chase someone or generate the list?"
  const ratio = totalEnrolled
    ? `${state.flight_count_confirmed}/${totalEnrolled}`
    : `${state.flight_count_confirmed}/${state.flight_count || "0"}`;
  const gap = totalEnrolled
    ? Math.max(0, totalEnrolled - state.flight_count_confirmed)
    : 0;

  if (!state.list_id) {
    if (state.flight_count_confirmed === 0 && state.flight_count === 0) {
      return (
        <span className="inline-flex items-center gap-1.5 text-[11px] tracking-[0.14em] uppercase text-[var(--ink-faint)] tabular-nums">
          {totalEnrolled ? `0/${totalEnrolled}` : "No flights"}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] tracking-[0.12em] uppercase text-[var(--ink-mute)] tabular-nums">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--gold)]" aria-hidden="true" />
        {ratio} ready
      </span>
    );
  }
  const tone =
    state.status === "final"
      ? "border-[#5b9a5d]/30 bg-[#5b9a5d]/8 text-[#3a6b3b]"
      : "border-[var(--cinnabar)]/25 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]";
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={`inline-flex items-center gap-1.5 px-2 h-[22px] rounded-[var(--radius-pill)] border ${tone} text-[10.5px] tracking-[0.14em] uppercase tabular-nums`}
      >
        <span className="font-medium">{state.status}</span>
        <span className="text-[var(--ink-faint)]">·</span>
        <span>{state.total_pax} pax</span>
      </span>
      {gap > 0 ? (
        <span className="text-[10.5px] tracking-[0.12em] uppercase text-[var(--gold)] tabular-nums">
          {gap} pending
        </span>
      ) : null}
    </span>
  );
}

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
