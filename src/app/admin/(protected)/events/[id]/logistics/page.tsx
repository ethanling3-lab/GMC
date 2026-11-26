import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import {
  loadTransferDetail,
  type ManualPassenger,
  type TransferDetailDirection,
  type TransferDetailRow,
  type TransferRowFlight,
} from "@/lib/transfer/transfer-query";
import { GenerateButton } from "@/components/admin/transfer/GenerateButton";
import { StatusToggle } from "@/components/admin/transfer/StatusToggle";
import { DeleteButton } from "@/components/admin/transfer/DeleteButton";
import { ExportButton } from "@/components/admin/transfer/ExportButton";
import { RowEditDialog } from "@/components/admin/transfer/RowEditDialog";
import { VehicleSelect } from "@/components/admin/transfer/VehicleSelect";
import {
  EditFlightButton,
  FlightEditorDialog,
  type EnrolmentOption,
  type FlightDetails,
} from "@/components/admin/transfer/FlightEditorDialog";
import { AddManualRowDialog } from "@/components/admin/transfer/AddManualRowDialog";
import { EditManualPassengerDialog } from "@/components/admin/transfer/EditManualPassengerDialog";
import { DeleteFlightButton } from "@/components/admin/transfer/DeleteFlightButton";
import {
  MovePassengerDialog,
  type MoveTargetOption,
} from "@/components/admin/transfer/MovePassengerDialog";
import { FlightWorklist } from "@/components/admin/transfer/FlightWorklist";
import { FlightFlagsPanel, type ReviewFlag } from "@/components/admin/transfer/FlightFlagsPanel";
import { loadOpenFlightFlags } from "@/lib/transfer/flight-flags";
import { loadFlightSubmissionStatus } from "@/lib/transfer/flight-status";
import {
  TRANSFER_ELIGIBLE_OR,
  TRANSFER_EXCLUDED_STATUSES,
} from "@/lib/transfer/eligibility";
import {
  DEFAULT_RULES,
  parseRulesOverride,
} from "@/lib/transfer/types";
import { CrumbLabel } from "@/components/admin/BreadcrumbContext";
import { customHotelName, removedHotelKey } from "@/lib/transfer/hotels";

export const metadata: Metadata = { title: "Logistics · 接送 — Admin" };
export const dynamic = "force-dynamic";

type RouteParams = { id: string };
type SearchParams = { dir?: string };

export default async function EventLogisticsPage({
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
    admin.role !== "customer_service" &&
    admin.role !== "instructor"
  ) {
    redirect("/admin/events");
  }

  const { id: eventId } = await params;
  const sp = await searchParams;
  const dir: "arrival" | "departure" = sp.dir === "departure" ? "departure" : "arrival";

  // Customer service covers every region on this page only, so it reads on the
  // server after the role check instead of widening their access across the CRM.
  const isCustomerService = admin.role === "customer_service";
  const supabase = isCustomerService
    ? createSupabaseServiceClient()
    : await createSupabaseServerClient();
  const [detail, submissionStatus, openFlags] = await Promise.all([
    loadTransferDetail(supabase, eventId),
    // CS see only their own customers' flights (Phase 3, 2026-11-26).
    loadFlightSubmissionStatus(supabase, eventId, { csId: isCustomerService ? admin.id : null }),
    admin.role === "instructor" ? Promise.resolve([]) : loadOpenFlightFlags(eventId),
  ]);
  if (!detail) notFound();

  // Look up the most recent inbox conversation per participant so the
  // "Inbox" link in FlightWorklist jumps straight into the thread.
  const participantIds = submissionStatus.enrolments
    .map((e) => e.participant_id)
    .filter((id): id is string => Boolean(id));
  const inboxByParticipant: Record<string, string> = {};
  // The inbox is Super Admin only, so customer service gets no thread links.
  if (participantIds.length > 0 && admin.role === "super_admin") {
    const { data: convs } = await supabase
      .from("conversations")
      .select("id, participant_id, last_message_at")
      .in("participant_id", participantIds)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .returns<
        Array<{ id: string; participant_id: string; last_message_at: string | null }>
      >();
    for (const c of convs ?? []) {
      if (!inboxByParticipant[c.participant_id]) {
        inboxByParticipant[c.participant_id] = c.id;
      }
    }
  }

  const ev = detail.event;
  const title =
    ev.title_en || ev.title_cn
      ? `${ev.title_en ?? ""}${ev.title_en && ev.title_cn ? " · " : ""}${ev.title_cn ?? ""}`
      : ev.slug;

  // Effective rules for the GenerateButton confirm dialog: defaults merged
  // with the event's per-event overrides (events.transfer_rules JSONB).
  const eventRulesOverride = parseRulesOverride(
    (ev as unknown as { transfer_rules?: unknown }).transfer_rules,
  );
  const effectiveRules = { ...DEFAULT_RULES, ...eventRulesOverride };

  const active = dir === "arrival" ? detail.arrival : detail.departure;
  const isReadOnly =
    admin.role !== "super_admin" && admin.role !== "regional_lead";
  const canFixFlights = !isReadOnly || isCustomerService;
  const designatedHotelEntries = Object.entries(
    (ev as unknown as { designated_hotels?: Record<string, string> })
      .designated_hotels ?? {},
  );

  // Enrolment options for the flight editor. Filter to active statuses so
  // admin doesn't see cancelled rows in the picker. Each carries its saved
  // flights so choosing someone loads them for checking and editing.
  type EnrolRow = {
    id: string;
    participant: {
      region_id: string | null;
      name_en: string | null;
      name_cn: string | null;
    } | null;
  };
  let enrolQ = supabase
    .from("enrollments")
    .select("id, participant:participants!inner(region_id, name_en, name_cn, assigned_cs_id)")
    .eq("event_id", eventId)
    .or(TRANSFER_ELIGIBLE_OR)
    .not("status", "in", TRANSFER_EXCLUDED_STATUSES);
  if (isCustomerService) enrolQ = enrolQ.eq("participant.assigned_cs_id", admin.id);
  const { data: enrolRows } = await enrolQ.returns<EnrolRow[]>();
  const enrollmentIds = (enrolRows ?? []).map((e) => e.id);
  const savedFlights = new Map<
    string,
    { arrival: FlightDetails | null; departure: FlightDetails | null }
  >();
  if (enrollmentIds.length > 0) {
    const { data: flightRows } = await supabase
      .from("flight_info")
      .select(
        "enrollment_id, direction, flight_number, airline, origin_airport, destination_airport, scheduled_at, terminal, hotel_key, is_vip, confirmed_at",
      )
      .in("enrollment_id", enrollmentIds)
      .returns<
        Array<
          Omit<FlightDetails, "confirmed"> & {
            enrollment_id: string;
            direction: "arrival" | "departure";
            confirmed_at: string | null;
          }
        >
      >();
    for (const { enrollment_id, direction, confirmed_at, ...flight } of flightRows ?? []) {
      const cur = savedFlights.get(enrollment_id) ?? { arrival: null, departure: null };
      cur[direction] = { ...flight, confirmed: Boolean(confirmed_at) };
      savedFlights.set(enrollment_id, cur);
    }
  }
  const enrolments: EnrolmentOption[] = (enrolRows ?? []).map((e) => {
    const nameEn = e.participant?.name_en ?? null;
    const nameCn = e.participant?.name_cn ?? null;
    const name = nameEn || nameCn || e.id.slice(0, 8);
    const region = e.participant?.region_id;
    const saved = savedFlights.get(e.id);
    return {
      enrollment_id: e.id,
      participant_label: region ? `${name} · ${region}` : name,
      name_en: nameEn,
      name_cn: nameCn,
      region_id: region ?? null,
      arrival_flight: saved?.arrival ?? null,
      departure_flight: saved?.departure ?? null,
    };
  });
  const designatedHotels =
    (ev as unknown as { designated_hotels?: Record<string, string> })
      .designated_hotels ?? {};

  // Only show flags for people this admin can see (regional leads see their region).
  const labelByEnrolment = new Map(
    submissionStatus.enrolments.map((e) => [
      e.enrollment_id,
      e.region_id ? `${e.name} · ${e.region_id}` : e.name,
    ]),
  );
  const reviewFlags: ReviewFlag[] = openFlags.flatMap((f) => {
    const participant_label = labelByEnrolment.get(f.enrollment_id);
    return participant_label ? [{ ...f, participant_label }] : [];
  });

  return (
    <div>
      <CrumbLabel segment={ev.id} label={title} />
      <div className="flex flex-col gap-3">
        <Link
          href={`/admin/events/${ev.id}`}
          className="inline-flex items-center gap-2 text-[10.5px] tracking-[0.22em] uppercase text-[var(--ink-faint)] hover:text-[var(--cinnabar)] transition-colors w-fit"
          style={{ color: "var(--ink-faint)" }}
        >
          ← Back to event
        </Link>
        <div className="flex items-end justify-between gap-6 flex-wrap">
          <div>
            <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
              <span className="w-5 h-px bg-current" />
              Logistics · 接送
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
            href={`/admin/events/${ev.id}`}
            className="ml-2 underline decoration-dotted"
            style={{ color: "var(--cinnabar-deep)" }}
          >
            Edit event
          </Link>
        </div>
      ) : null}

      {reviewFlags.length > 0 ? (
        <div className="mt-6">
          <FlightFlagsPanel
            flags={reviewFlags}
            canReview={!isReadOnly}
            mainVenueName={ev.main_venue_hotel_name}
            designatedHotels={designatedHotels}
          />
        </div>
      ) : null}

      <div className="mt-6">
        <FlightWorklist
          status={submissionStatus}
          inboxByParticipant={inboxByParticipant}
          eventTitle={ev.title_en || ev.title_cn || ev.slug}
          canWork={canFixFlights}
          defaultOpen={isCustomerService}
        />
      </div>

      <div className="mt-8 flex items-center gap-1 border-b border-[var(--paper-shadow)]">
        <TabLink
          href={`/admin/events/${ev.id}/logistics?dir=arrival`}
          active={dir === "arrival"}
          label="Arrivals"
          labelZh="接机"
          state={detail.arrival}
        />
        <TabLink
          href={`/admin/events/${ev.id}/logistics?dir=departure`}
          active={dir === "departure"}
          label="Departures"
          labelZh="送机"
          state={detail.departure}
        />
      </div>

      <DirectionPanel
        eventId={ev.id}
        eventSlug={ev.slug}
        eventHasSheet={Boolean(ev.transfer_sheet_id)}
        dir={dir}
        state={active}
        readOnly={isReadOnly}
        canEditRows={!isReadOnly}
        canFixFlights={canFixFlights}
        isCustomerService={isCustomerService}
        enrolments={enrolments}
        mainVenueName={ev.main_venue_hotel_name}
        designatedHotels={designatedHotels}
        effectiveRules={effectiveRules}
        confirmedFlightCount={
          dir === "arrival"
            ? submissionStatus.arrival.confirmed
            : submissionStatus.departure.confirmed
        }
        departureDay={ev.departure_day}
        leftOut={submissionStatus.enrolments
          .filter((e) => e[dir] === "needs_time")
          .map((e) => (e.region_id ? `${e.name} (${e.region_id})` : e.name))}
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
  eventSlug,
  eventHasSheet,
  dir,
  state,
  readOnly,
  canEditRows,
  canFixFlights,
  isCustomerService,
  enrolments,
  mainVenueName,
  designatedHotels,
  effectiveRules,
  confirmedFlightCount,
  departureDay,
  leftOut,
}: {
  eventId: string;
  eventSlug: string;
  eventHasSheet: boolean;
  dir: "arrival" | "departure";
  state: TransferDetailDirection;
  readOnly: boolean;
  canEditRows: boolean;
  canFixFlights: boolean;
  isCustomerService: boolean;
  enrolments: EnrolmentOption[];
  mainVenueName: string | null;
  designatedHotels: Record<string, string>;
  effectiveRules: {
    consolidation_window_minutes: number;
    departure_lead_hours: number;
    coach_cutoff_hour_local: number;
    coach_hotel_departure_local: string;
    coach_rule_enabled: boolean;
    oversize_strategy: "split" | "bus";
    other_hotel_pickup: "own" | "main";
  };
  confirmedFlightCount: number;
  departureDay: string | null;
  leftOut: string[];
}) {
  const totalPax = state.rows.reduce(
    (acc, r) =>
      acc +
      (r.flight_info_ids?.length ?? 0) +
      (r.manual_passengers?.length ?? 0),
    0,
  );

  // Saved rules only reach a list when it's regenerated, so say when they differ.
  const used = state.list?.rules_snapshot;
  const ruleChanges: string[] = [];
  if (used) {
    const note = (key: keyof typeof effectiveRules, label: string, unit = "") => {
      if (used[key] !== undefined && used[key] !== effectiveRules[key]) {
        ruleChanges.push(`${label} ${String(used[key])}${unit} to ${String(effectiveRules[key])}${unit}`);
      }
    };
    note("consolidation_window_minutes", "grouping", " min");
    if (dir === "departure") {
      note("departure_lead_hours", "lead time", " hours");
      note("coach_cutoff_hour_local", "coach cutoff", ":00");
      note("coach_hotel_departure_local", "coach pickup");
      if (used.departure_day !== undefined && used.departure_day !== departureDay) {
        ruleChanges.push(`departure day ${String(used.departure_day ?? "not set")} to ${departureDay ?? "not set"}`);
      }
    }
    const listFlights = state.rows.flatMap((r) => r.flights);
    const hotelNames = new Set<string | null>([
      mainVenueName,
      ...Object.values(designatedHotels),
      ...listFlights.map((f) => customHotelName(f.hotel_key)),
    ]);
    const staleHotel = state.rows.some(
      (r) =>
        !r.admin_edited &&
        r.flights.length > 0 &&
        (r.destination ?? "").split(" + ").some((name) => !hotelNames.has(name)),
    );
    if (staleHotel) ruleChanges.push("hotel names changed");
    const generatedAt = new Date(state.list!.generated_at).getTime();
    const changedFlights = listFlights.filter(
      (f) => new Date(f.updated_at).getTime() > generatedAt,
    ).length;
    if (changedFlights > 0) {
      ruleChanges.push(
        `${changedFlights} passenger ${changedFlights === 1 ? "flight" : "flights"} updated`,
      );
    }
  }
  const onRemovedHotel =
    dir === "arrival"
      ? state.rows
          .flatMap((r) => r.flights)
          .filter((f) => removedHotelKey(f.hotel_key, designatedHotels))
          .map(participantLabel)
      : [];

  // Universe of move-passenger targets for this direction. Each row in the
  // table both contributes one entry here AND consumes the full list (minus
  // itself) when its per-line MovePassengerDialog mounts. Derive once.
  const moveTargets: MoveTargetOption[] = state.rows.map((r) => ({
    row_id: r.id,
    group_no: r.group_no,
    vehicle_type: r.vehicle_type,
    landing_or_takeoff_at: r.landing_or_takeoff_at,
    destination: r.destination,
    pax_count:
      (r.flight_info_ids?.length ?? 0) + (r.manual_passengers?.length ?? 0),
    vip: r.vip,
    is_manual:
      (r.flight_info_ids?.length ?? 0) === 0 &&
      (r.manual_passengers?.length ?? 0) > 0,
  }));

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
              hasFlights={confirmedFlightCount > 0}
              variant="primary"
              effectiveRules={{
                ...effectiveRules,
                // Generate-window choices stick to what this list last used.
                oversize_strategy:
                  used?.oversize_strategy === "bus" ? "bus" : effectiveRules.oversize_strategy,
                other_hotel_pickup:
                  used?.other_hotel_pickup === "main" ? "main" : effectiveRules.other_hotel_pickup,
              }}
              confirmedFlightCount={confirmedFlightCount}
              leftOut={leftOut}
              editedCount={state.rows.filter((r) => r.admin_edited).length}
            />
            {state.list ? (
              <>
                <AddManualRowDialog listId={state.list.id} direction={dir} />
                <StatusToggle listId={state.list.id} status={state.list.status} />
                <ExportButton listId={state.list.id} hasSheet={eventHasSheet} />
                <a
                  href={`/api/admin/transfer-lists/event/${eventId}/export.xlsx`}
                  download
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[11px] tracking-[0.1em] uppercase text-[var(--ink-soft)] hover:text-[var(--ink)] hover:border-[var(--cinnabar)]/30 transition-colors"
                  style={{ color: "var(--ink-soft)" }}
                  title={`Download ${eventSlug}-transfers.xlsx`}
                >
                  <span aria-hidden="true">↓</span>
                  .xlsx
                </a>
                <DeleteButton listId={state.list.id} />
              </>
            ) : null}
          </div>
        ) : null}
        {canFixFlights ? (
          <FlightEditorDialog
            enrolments={enrolments}
            mainVenueName={mainVenueName}
            designatedHotels={designatedHotels}
            canSetVip={!isCustomerService}
          />
        ) : null}
      </div>

      {ruleChanges.length > 0 ? (
        <div
          role="status"
          className="mt-5 rounded-[var(--radius-md)] border border-[#A87A2A]/40 bg-[#A87A2A]/10 px-4 py-3 text-[12.5px] leading-[1.6] text-[#5F4312]"
        >
          <strong className="font-semibold">Changed since this list was generated:</strong>{" "}
          {ruleChanges.join(", ")}.{" "}
          {readOnly
            ? "An admin needs to regenerate this list."
            : state.list?.status === "final"
              ? "Move it back to draft, then regenerate to apply them."
              : "Regenerate to apply them."}
        </div>
      ) : null}

      {onRemovedHotel.length > 0 ? (
        <div
          role="alert"
          className="mt-5 rounded-[var(--radius-md)] border border-[#A87A2A]/40 bg-[#A87A2A]/10 px-4 py-3 text-[12.5px] leading-[1.6] text-[#5F4312]"
        >
          <strong className="font-semibold">Choose the correct hotel:</strong>{" "}
          {onRemovedHotel.join(", ")}.{" "}
          Their hotel is no longer on this event, so they&apos;re going to the
          main venue. Click the pencil beside their flight to change it.
        </div>
      ) : null}

      {leftOut.length > 0 ? (
        <div
          role="alert"
          className="mt-5 rounded-[var(--radius-md)] border border-[#A87A2A]/40 bg-[#A87A2A]/10 px-4 py-3 text-[12.5px] leading-[1.6] text-[#5F4312]"
        >
          <strong className="font-semibold">
            {leftOut.length} {leftOut.length === 1 ? "person has" : "people have"} no vehicle
          </strong>{" "}
          because their flight has no time: {leftOut.join(", ")}. Add the time
          {readOnly ? " in the worklist." : ", then regenerate this list."}
        </div>
      ) : null}

      {!state.list ? (
        <div className="mt-8 rounded-[var(--radius-md)] border border-dashed border-[var(--paper-shadow)] bg-[var(--paper)]/60 px-6 py-10 text-center">
          <div className="font-display text-[18px] text-[var(--ink-soft)] leading-[1.3]">
            Nothing to show yet.
          </div>
          <p className="mt-2 max-w-[44ch] mx-auto text-[12.5px] leading-[1.6] text-[var(--ink-mute)]">
            {readOnly
              ? "Generation is restricted to super and regional admins."
              : `Confirmed ${dir} flights are bucketed into ${effectiveRules.consolidation_window_minutes}-min groups, sized to the smallest fitting vehicle, and ordered by ${dir === "arrival" ? "landing" : "hotel-departure"} time.`}
          </p>
        </div>
      ) : state.rows.length === 0 ? (
        <p className="mt-6 text-[13px] text-[var(--ink-mute)]">
          The list is empty — no confirmed flights for this direction.
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-[var(--radius-md)] border border-[var(--paper-shadow)]">
          <table className="w-full border-collapse text-[11.5px] bg-[var(--paper)]">
            <thead className="sticky top-0 z-10 bg-[var(--paper-deep)]">
              <tr className="text-left text-[9.5px] tracking-[0.2em] uppercase text-[var(--ink-mute)]">
                <Th className="w-[42px] text-center">#</Th>
                <Th className="w-[110px]">
                  {dir === "arrival" ? "Landing" : "Hotel dep."}
                </Th>
                <Th className="w-[180px]">Vehicle</Th>
                <Th className="w-[40px] text-right">Pax</Th>
                <Th className="w-[160px]">
                  {dir === "arrival" ? "Drop-off" : "Pickup"}
                </Th>
                <Th className="w-[220px]">Passengers</Th>
                <Th className="min-w-[260px]">Flight</Th>
                <Th className="w-[200px]">Remark</Th>
                {canEditRows && state.list ? (
                  <Th className="w-[36px] text-center" aria-label="Edit">·</Th>
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
                  canFixFlights={canFixFlights}
                  isCustomerService={isCustomerService}
                  moveTargets={moveTargets}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Th({ children, className, ...rest }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      {...rest}
      className={`px-2 py-2 font-normal border-b border-r border-[var(--paper-shadow)] last:border-r-0 align-middle ${className ?? ""}`}
    >
      {children}
    </th>
  );
}

function Td({ children, className, ...rest }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      {...rest}
      className={`px-2 py-1.5 border-b border-r border-[var(--paper-shadow)] last:border-r-0 align-top ${className ?? ""}`}
    >
      {children}
    </td>
  );
}

function RowGroup({
  row,
  dir,
  listId,
  canEdit,
  canFixFlights,
  isCustomerService,
  moveTargets,
}: {
  row: TransferDetailRow;
  dir: "arrival" | "departure";
  listId: string;
  canEdit: boolean;
  canFixFlights: boolean;
  isCustomerService: boolean;
  moveTargets: MoveTargetOption[];
}) {
  // Compact label of THIS row, used as the "currently on:" sub-line in the
  // move dialog so admin can verify they're moving from the right place.
  const sourceLabel = (() => {
    const time = row.landing_or_takeoff_at
      ? formatTimeBlock(row.landing_or_takeoff_at)
      : "—";
    const veh = row.vehicle_type ?? "—";
    return `#${row.group_no} · ${veh} · ${time}`;
  })();
  const isManual = row.flights.length === 0 && row.manual_passengers.length > 0;
  const paxCount = row.flights.length + row.manual_passengers.length;
  const tintCls = row.vip
    ? "bg-[var(--cinnabar-wash)]/40"
    : isManual
      ? "bg-[var(--gold-soft)]/30"
      : "even:bg-[var(--paper-deep)]/40";

  // Build aligned line pairs: each entry yields one line in the Passengers
  // cell and one in the Flight cell, so the eye can track passenger ↔ flight
  // row by row across the split.
  const lines: Array<
    | { kind: "real"; flight: TransferRowFlight }
    | { kind: "manual"; pax: ManualPassenger; index: number }
  > = row.flights.length > 0
    ? row.flights.map((f) => ({ kind: "real" as const, flight: f }))
    : row.manual_passengers.map((p, i) => ({
        kind: "manual" as const,
        pax: p,
        index: i,
      }));

  return (
    <tr className={`group ${tintCls} hover:bg-[var(--paper-deep)]/70 transition-colors`}>
      <Td className="text-center tabular-nums text-[var(--ink-mute)]">
        <div className="inline-flex items-center gap-1.5 justify-center">
          <span>{row.group_no}</span>
          {row.admin_edited ? (
            <span
              title="Manually edited — regenerate skips this row unless forced"
              aria-label="Edited"
              className="inline-block w-[6px] h-[6px] rounded-full bg-[var(--gold)]"
            />
          ) : null}
        </div>
      </Td>
      <Td className="tabular-nums text-[var(--ink)] whitespace-nowrap">
        {row.landing_or_takeoff_at ? formatTimeBlock(row.landing_or_takeoff_at) : "—"}
        {row.terminal ? (
          <div className="text-[9px] tracking-[0.18em] uppercase text-[var(--ink-faint)] mt-0.5">
            {row.terminal}
          </div>
        ) : null}
      </Td>
      <Td>
        {canEdit ? (
          <VehicleSelect
            listId={listId}
            rowId={row.id}
            groupNo={row.group_no}
            vehicle={row.vehicle_type}
            pax={paxCount}
          />
        ) : (
          <div className="text-[var(--ink)] leading-[1.3]">{row.vehicle_type ?? "—"}</div>
        )}
        {row.vip ? (
          <span className="mt-1 inline-flex items-center h-[15px] px-1 rounded-[var(--radius-pill)] border border-[var(--cinnabar)]/30 bg-[var(--paper)] text-[8.5px] tracking-[0.18em] uppercase text-[var(--cinnabar-deep)]">
            VIP
          </span>
        ) : null}
        {isManual ? (
          <span className="mt-1 inline-flex items-center h-[15px] px-1 rounded-[var(--radius-pill)] border border-[var(--gold)]/40 bg-[var(--paper)] text-[8.5px] tracking-[0.18em] uppercase text-[var(--ink-soft)]">
            manual
          </span>
        ) : null}
      </Td>
      <Td className="text-right tabular-nums text-[var(--ink-soft)]">
        {paxCount}
      </Td>
      <Td className="text-[var(--ink-soft)] leading-[1.4]">
        {row.destination ?? "—"}
      </Td>
      <Td className="py-1">
        {lines.length === 0 ? (
          <span className="text-[var(--ink-faint)]">—</span>
        ) : (
          <ul className="flex flex-col">
            {lines.map((ln) => (
              <li
                key={ln.kind === "real" ? ln.flight.id : `m${ln.index}`}
                className="line-row group/line h-[24px] flex items-center gap-1.5 whitespace-nowrap"
              >
                {ln.kind === "real" ? (
                  <PassengerLine flight={ln.flight} />
                ) : (
                  <>
                    <ManualPassengerLine pax={ln.pax} />
                    {canEdit ? (
                      <span className="inline-flex items-center gap-0.5 opacity-40 hover:opacity-100 transition-opacity">
                        <EditManualPassengerDialog
                          listId={listId}
                          rowId={row.id}
                          index={ln.index}
                          passengers={row.manual_passengers}
                        />
                        <MovePassengerDialog
                          listId={listId}
                          sourceRowId={row.id}
                          sourceLabel={sourceLabel}
                          direction={dir}
                          subject={{
                            kind: "manual",
                            manual_index: ln.index,
                            label: manualPassengerLabel(ln.pax),
                          }}
                          targets={moveTargets}
                        />
                      </span>
                    ) : null}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Td>
      <Td className="py-1">
        {lines.length === 0 ? (
          <span className="text-[var(--ink-faint)]">—</span>
        ) : (
          <ul className="flex flex-col">
            {lines.map((ln) => (
              <li
                key={ln.kind === "real" ? `f${ln.flight.id}` : `mf${ln.index}`}
                className="line-row group/line h-[24px] flex items-center gap-2 whitespace-nowrap"
              >
                {ln.kind === "real" ? (
                  <>
                    <FlightLine flight={ln.flight} />
                    {canFixFlights ? (
                      <span className="inline-flex items-center gap-0.5 opacity-40 hover:opacity-100 transition-opacity">
                        <EditFlightButton
                          enrollment_id={ln.flight.enrollment_id}
                          direction={dir}
                          participant_label={participantLabel(ln.flight)}
                          flight={{
                            flight_number: ln.flight.flight_number,
                            airline: ln.flight.airline,
                            origin_airport: ln.flight.origin_airport,
                            destination_airport: ln.flight.destination_airport,
                            scheduled_at: ln.flight.scheduled_at,
                            terminal: ln.flight.terminal,
                            hotel_key: ln.flight.hotel_key,
                            is_vip: ln.flight.is_vip,
                            confirmed: true,
                          }}
                        />
                        {canEdit ? (
                          <MovePassengerDialog
                            listId={listId}
                            sourceRowId={row.id}
                            sourceLabel={sourceLabel}
                            direction={dir}
                            subject={{
                              kind: "real",
                              flight_info_id: ln.flight.id,
                              label: `${participantLabel(ln.flight)} · ${flightSummary(ln.flight)}`,
                            }}
                            targets={moveTargets}
                          />
                        ) : null}
                        <DeleteFlightButton
                          flagsAdmin={isCustomerService}
                          initial={{
                            enrollment_id: ln.flight.enrollment_id,
                            direction: dir,
                            participant_label: participantLabel(ln.flight),
                            flight_summary: flightSummary(ln.flight),
                          }}
                        />
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span className="text-[var(--ink-faint)]">—</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Td>
      <Td className="text-[var(--ink-mute)] leading-[1.5] max-w-[200px]">
        {row.remark ?? ""}
      </Td>
      {canEdit ? (
        <Td className="text-center">
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
        </Td>
      ) : null}
    </tr>
  );
}

function PassengerLine({ flight }: { flight: TransferRowFlight }) {
  const p = flight.participant;
  const id = p?.region_id ?? "—";
  const name = p?.name_en || p?.name_cn || p?.id?.slice(0, 8) || "—";
  return (
    <div className="flex items-baseline gap-2 whitespace-nowrap">
      <span className="font-mono text-[10px] text-[var(--cinnabar-deep)] tabular-nums">
        {id}
      </span>
      <span className="text-[11.5px] text-[var(--ink)]">{name}</span>
    </div>
  );
}

function FlightLine({ flight }: { flight: TransferRowFlight }) {
  const fn = flight.flight_number ?? "????";
  const o = flight.origin_airport ?? "?";
  const d = flight.destination_airport ?? "?";
  const t = flight.scheduled_at ? formatHHMM(flight.scheduled_at) : "????";
  return (
    <span className="text-[10.5px] tabular-nums text-[var(--ink-mute)]">
      {fn} {o}→{d} {t}
    </span>
  );
}

function ManualPassengerLine({ pax }: { pax: ManualPassenger }) {
  return (
    <div className="flex items-baseline gap-2 whitespace-nowrap">
      {pax.region_id ? (
        <span className="font-mono text-[10px] text-[var(--cinnabar-deep)] tabular-nums">
          {pax.region_id}
        </span>
      ) : null}
      <span className="text-[11.5px] text-[var(--ink)]">{pax.name}</span>
      {pax.note ? (
        <span className="text-[10px] text-[var(--ink-faint)] italic">
          {pax.note}
        </span>
      ) : null}
    </div>
  );
}

function participantLabel(flight: TransferRowFlight): string {
  const p = flight.participant;
  const name = p?.name_en || p?.name_cn || "—";
  return p?.region_id ? `${name} · ${p.region_id}` : name;
}

function manualPassengerLabel(pax: ManualPassenger): string {
  return pax.region_id ? `${pax.name} · ${pax.region_id}` : pax.name;
}

function flightSummary(flight: TransferRowFlight): string {
  const fn = flight.flight_number ?? "????";
  const o = flight.origin_airport ?? "?";
  const d = flight.destination_airport ?? "?";
  const t = flight.scheduled_at ? formatHHMM(flight.scheduled_at) : "????";
  return `${fn} ${o}→${d} ${t}`;
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

function formatTimeBlock(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  return `${day} · ${formatHHMM(iso)}`;
}

function formatHHMM(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
