import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import {
  loadTransferDetail,
  type TransferDetailDirection,
  type TransferDetailRow,
  type TransferRowFlight,
} from "@/lib/transfer/transfer-query";
import { GenerateButton } from "@/components/admin/transfer/GenerateButton";
import { StatusToggle } from "@/components/admin/transfer/StatusToggle";
import { DeleteButton } from "@/components/admin/transfer/DeleteButton";
import { ExportButton } from "@/components/admin/transfer/ExportButton";
import { RowEditDialog } from "@/components/admin/transfer/RowEditDialog";

export const metadata: Metadata = { title: "Transfer list" };
export const dynamic = "force-dynamic";

type RouteParams = { eventId: string };
type SearchParams = { dir?: string };

export default async function TransferListDetailPage({
  params,
  searchParams,
}: {
  params: Promise<RouteParams>;
  searchParams: Promise<SearchParams>;
}) {
  const admin = await requireAdmin();
  if (
    admin.role !== "super_admin" &&
    admin.role !== "regional_lead" &&
    admin.role !== "instructor"
  ) {
    redirect("/admin");
  }

  const { eventId } = await params;
  const sp = await searchParams;
  const dir: "arrival" | "departure" = sp.dir === "departure" ? "departure" : "arrival";

  const supabase = await createSupabaseServerClient();
  const detail = await loadTransferDetail(supabase, eventId);
  if (!detail) notFound();

  const ev = detail.event;
  const title =
    ev.title_en || ev.title_cn
      ? `${ev.title_en ?? ""}${ev.title_en && ev.title_cn ? " · " : ""}${ev.title_cn ?? ""}`
      : ev.slug;

  const active = dir === "arrival" ? detail.arrival : detail.departure;
  const isReadOnly =
    admin.role !== "super_admin" && admin.role !== "regional_lead";
  const designatedHotelEntries = Object.entries(
    (ev as unknown as { designated_hotels?: Record<string, string> })
      .designated_hotels ?? {},
  );

  return (
    <div>
      <div className="flex flex-col gap-3">
        <Link
          href="/admin/transfer-lists"
          className="inline-flex items-center gap-2 text-[10.5px] tracking-[0.22em] uppercase text-[var(--ink-faint)] hover:text-[var(--cinnabar)] transition-colors w-fit"
          style={{ color: "var(--ink-faint)" }}
        >
          ← Transfer lists
        </Link>
        <div className="flex items-end justify-between gap-6 flex-wrap">
          <div>
            <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
              <span className="w-5 h-px bg-current" />
              Logistics · 接送 · {ev.slug}
            </div>
            <h1 className="mt-3 font-display text-[32px] md:text-[36px] leading-[1.05] tracking-[-0.015em] text-[var(--ink)]">
              {title}
            </h1>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[12px] text-[var(--ink-soft)]">
              <Meta label="Arrival" value={ev.arrival_day ? formatDate(ev.arrival_day) : "—"} />
              <Meta label="Departure" value={ev.departure_day ? formatDate(ev.departure_day) : "—"} />
              <Meta
                label="Main venue"
                value={ev.main_venue_hotel_name ?? "—"}
                tone={ev.main_venue_hotel_name ? "ink" : "warn"}
              />
              {ev.city ? <Meta label="City" value={ev.city} /> : null}
            </div>
            {designatedHotelEntries.length > 0 ? (
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)] mr-1">
                  Designated
                </span>
                {designatedHotelEntries.map(([key, name]) => (
                  <span
                    key={key}
                    className="inline-flex items-center h-[20px] px-2 rounded-[var(--radius-pill)] bg-[var(--paper-deep)] text-[10.5px] tracking-[0.04em] text-[var(--ink-mute)]"
                  >
                    {name}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          {ev.transfer_sheet_url ? (
            <a
              href={ev.transfer_sheet_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 h-9 px-4 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[12px] tracking-[0.1em] uppercase text-[var(--ink-soft)] hover:text-[var(--cinnabar-deep)] hover:border-[var(--cinnabar)]/30 transition-colors"
              style={{ color: "var(--ink-soft)" }}
            >
              <span>Open Sheet</span>
              <span aria-hidden="true">↗</span>
            </a>
          ) : null}
        </div>
      </div>

      {!ev.main_venue_hotel_name ? (
        <div className="mt-6 rounded-[var(--radius-md)] border border-[var(--gold)]/40 bg-[var(--gold-soft)] px-4 py-3 text-[12.5px] text-[var(--ink-soft)] leading-[1.6]">
          Set <strong className="text-[var(--ink)]">Main venue hotel name</strong> on the event before generating —
          all departures depart from this hotel and non-designated arrivals
          drop here too.
          <Link
            href={`/admin/events/${ev.id}/edit`}
            className="ml-2 underline decoration-dotted"
            style={{ color: "var(--cinnabar-deep)" }}
          >
            Edit event
          </Link>
        </div>
      ) : null}

      <div className="mt-8 flex items-center gap-1 border-b border-[var(--paper-shadow)]">
        <TabLink
          href={`/admin/transfer-lists/${ev.id}?dir=arrival`}
          active={dir === "arrival"}
          label="Arrivals"
          labelZh="接机"
          state={detail.arrival}
        />
        <TabLink
          href={`/admin/transfer-lists/${ev.id}?dir=departure`}
          active={dir === "departure"}
          label="Departures"
          labelZh="送机"
          state={detail.departure}
        />
      </div>

      <DirectionPanel
        eventId={ev.id}
        eventHasSheet={Boolean(ev.transfer_sheet_id)}
        dir={dir}
        state={active}
        readOnly={isReadOnly}
        canEditRows={!isReadOnly}
      />
    </div>
  );
}

function Meta({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ink" | "warn";
}) {
  const valueCls =
    tone === "warn"
      ? "text-[var(--cinnabar-deep)]"
      : "text-[var(--ink)]";
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[9.5px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
        {label}
      </span>
      <span className={`text-[12.5px] tabular-nums ${valueCls}`}>{value}</span>
    </span>
  );
}

function TabLink({
  href,
  active,
  label,
  labelZh,
  state,
}: {
  href: string;
  active: boolean;
  label: string;
  labelZh: string;
  state: TransferDetailDirection;
}) {
  const cls = active
    ? "text-[var(--ink)] border-b-2 border-[var(--cinnabar)]"
    : "text-[var(--ink-mute)] border-b-2 border-transparent hover:text-[var(--ink)]";
  return (
    <Link
      href={href}
      className={`inline-flex items-baseline gap-2 px-4 py-3 -mb-px text-[13px] tracking-[0.04em] transition-colors ${cls}`}
      style={{ color: "inherit" }}
    >
      <span>{label}</span>
      <span className="text-[10px] tracking-[0.18em] uppercase text-[var(--ink-faint)]">
        {labelZh}
      </span>
      {state.list ? (
        <span className="ml-1 text-[10.5px] tracking-[0.12em] uppercase text-[var(--cinnabar-deep)] tabular-nums">
          {state.list.status} · {state.rows.length}
        </span>
      ) : null}
    </Link>
  );
}

function DirectionPanel({
  eventId,
  eventHasSheet,
  dir,
  state,
  readOnly,
  canEditRows,
}: {
  eventId: string;
  eventHasSheet: boolean;
  dir: "arrival" | "departure";
  state: TransferDetailDirection;
  readOnly: boolean;
  canEditRows: boolean;
}) {
  const totalPax = state.rows.reduce(
    (acc, r) => acc + (r.flight_info_ids?.length ?? 0),
    0,
  );

  return (
    <section className="mt-6 rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] p-6 shadow-[var(--shadow-paper-1)]">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
            <span className="w-4 h-px bg-current" />
            {dir === "arrival" ? "Arrivals · 接机安排" : "Departures · 送机安排"}
          </div>
          <h2 className="mt-2 font-display text-[22px] leading-[1.2] tracking-[-0.01em] text-[var(--ink)]">
            {state.list
              ? `${state.rows.length} groups · ${totalPax} pax`
              : "Not generated yet"}
          </h2>
          {state.list ? (
            <div className="mt-1 text-[11px] tracking-[0.14em] uppercase text-[var(--ink-faint)]">
              Generated {formatDateTime(state.list.generated_at)} · {state.list.status}
            </div>
          ) : null}
        </div>
        {!readOnly ? (
          <div className="flex items-center gap-3 flex-wrap">
            <GenerateButton
              eventId={eventId}
              direction={dir}
              hasExisting={Boolean(state.list)}
              hasFlights={state.rows.length > 0 || !state.list}
              variant="primary"
            />
            {state.list ? (
              <>
                <StatusToggle listId={state.list.id} status={state.list.status} />
                <ExportButton listId={state.list.id} hasSheet={eventHasSheet} />
                <DeleteButton listId={state.list.id} />
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {!state.list ? (
        <div className="mt-8 rounded-[var(--radius-md)] border border-dashed border-[var(--paper-shadow)] bg-[var(--paper)]/60 px-6 py-10 text-center">
          <div className="font-display text-[18px] text-[var(--ink-soft)] leading-[1.3]">
            Nothing to show yet.
          </div>
          <p className="mt-2 max-w-[44ch] mx-auto text-[12.5px] leading-[1.6] text-[var(--ink-mute)]">
            {readOnly
              ? "Generation is restricted to super and regional admins."
              : `Confirmed ${dir} flights are bucketed into 30-min groups, sized to the smallest fitting vehicle, and ordered by ${dir === "arrival" ? "landing" : "hotel-departure"} time.`}
          </p>
        </div>
      ) : state.rows.length === 0 ? (
        <p className="mt-6 text-[13px] text-[var(--ink-mute)]">
          The list is empty — no confirmed flights for this direction.
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="text-left text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
                <th className="pb-3 pr-3 font-normal">#</th>
                <th className="pb-3 pr-3 font-normal">
                  {dir === "arrival" ? "Landing" : "Hotel dep."}
                </th>
                <th className="pb-3 pr-3 font-normal">Vehicle</th>
                <th className="pb-3 pr-3 font-normal text-right">Pax</th>
                <th className="pb-3 pr-3 font-normal">
                  {dir === "arrival" ? "Drop-off" : "Pickup"}
                </th>
                <th className="pb-3 pr-3 font-normal">Flights</th>
                <th className="pb-3 pr-3 font-normal">Remark</th>
                {canEditRows && state.list ? (
                  <th className="pb-3 pr-3 font-normal" aria-label="Edit" />
                ) : null}
              </tr>
            </thead>
            <tbody>
              {state.rows.map((r) => (
                <RowGroup
                  key={r.id}
                  row={r}
                  dir={dir}
                  listId={state.list?.id ?? ""}
                  canEdit={canEditRows && Boolean(state.list)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RowGroup({
  row,
  dir,
  listId,
  canEdit,
}: {
  row: TransferDetailRow;
  dir: "arrival" | "departure";
  listId: string;
  canEdit: boolean;
}) {
  return (
    <tr className={`border-t border-[var(--paper-shadow)] align-top ${row.vip ? "bg-[var(--cinnabar-wash)]/40" : ""}`}>
      <td className="py-3 pr-3 tabular-nums text-[var(--ink-mute)] align-top">
        <div className="flex items-center gap-1.5">
          <span>{row.group_no}</span>
          {row.admin_edited ? (
            <span
              title="Manually edited — regenerate will skip this row unless forced"
              className="inline-flex items-center h-[16px] px-1 rounded-[var(--radius-pill)] border border-[var(--gold)]/40 bg-[var(--gold-soft)] text-[8.5px] tracking-[0.16em] uppercase text-[var(--ink-soft)]"
            >
              edited
            </span>
          ) : null}
        </div>
      </td>
      <td className="py-3 pr-3 tabular-nums text-[var(--ink)] align-top whitespace-nowrap">
        {row.landing_or_takeoff_at ? formatTimeBlock(row.landing_or_takeoff_at) : "—"}
        {row.terminal ? (
          <div className="text-[10px] tracking-[0.18em] uppercase text-[var(--ink-faint)] mt-0.5">
            {row.terminal}
          </div>
        ) : null}
      </td>
      <td className="py-3 pr-3 align-top">
        <div className="text-[var(--ink)]">{row.vehicle_type ?? "—"}</div>
        {row.vip ? (
          <div className="mt-1 inline-flex items-center h-[18px] px-1.5 rounded-[var(--radius-pill)] border border-[var(--cinnabar)]/30 bg-[var(--paper)] text-[9.5px] tracking-[0.18em] uppercase text-[var(--cinnabar-deep)]">
            VIP
          </div>
        ) : null}
      </td>
      <td className="py-3 pr-3 text-right tabular-nums align-top text-[var(--ink-soft)]">
        {row.flights.length}
      </td>
      <td className="py-3 pr-3 align-top text-[var(--ink-soft)] leading-[1.4]">
        {row.destination ?? "—"}
      </td>
      <td className="py-3 pr-3 align-top">
        <ul className="flex flex-col gap-1.5">
          {row.flights.map((f) => (
            <li key={f.id} className="leading-[1.35]">
              <PassengerLine flight={f} dir={dir} />
            </li>
          ))}
        </ul>
      </td>
      <td className="py-3 pr-3 align-top text-[var(--ink-mute)] leading-[1.5] max-w-[28ch]">
        {row.remark ?? ""}
      </td>
      {canEdit ? (
        <td className="py-3 pr-3 align-top">
          <RowEditDialog
            listId={listId}
            direction={dir}
            row={{
              id: row.id,
              vehicle_type: row.vehicle_type,
              landing_or_takeoff_at: row.landing_or_takeoff_at,
              terminal: row.terminal,
              destination: row.destination,
              remark: row.remark,
              vip: row.vip,
            }}
          />
        </td>
      ) : null}
    </tr>
  );
}

function PassengerLine({
  flight,
  dir,
}: {
  flight: TransferRowFlight;
  dir: "arrival" | "departure";
}) {
  const p = flight.participant;
  const id = p?.region_id ?? "—";
  const name = p?.name_en || p?.name_cn || p?.id?.slice(0, 8) || "—";
  const flightLine = formatFlightShort(flight);
  return (
    <div>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="font-mono text-[10.5px] text-[var(--cinnabar-deep)] tabular-nums">
          {id}
        </span>
        <span className="text-[12.5px] text-[var(--ink)]">{name}</span>
        {p?.region ? (
          <span className="text-[10px] tracking-[0.18em] uppercase text-[var(--ink-faint)]">
            {p.region}
          </span>
        ) : null}
      </div>
      <div className="text-[11px] tabular-nums text-[var(--ink-mute)]">
        {flightLine}
      </div>
    </div>
  );
}

function formatFlightShort(f: TransferRowFlight): string {
  const fn = f.flight_number ?? "????";
  const o = f.origin_airport ?? "?";
  const d = f.destination_airport ?? "?";
  const t = f.scheduled_at ? formatTimeBlock(f.scheduled_at).split(" ")[1] : "????";
  return `${fn} · ${o}→${d} · ${t}`;
}

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Returns "14 Apr · 0915" using UTC components (the local-clock-face values
// the admin entered round-trip through scheduled_at — see lib/transfer/time.ts).
function formatTimeBlock(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const h = String(d.getUTCHours()).padStart(2, "0");
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  return `${day} · ${h}${m}`;
}
