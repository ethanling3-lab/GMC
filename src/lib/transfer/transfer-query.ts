import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Loader for the /admin/transfer-lists list view. One row per event that has
// either an arrival_day or departure_day set (events that need transfer
// logistics). Aggregates each event's draft/final list state for both
// directions plus a flight_info pax count to surface "ready to generate"
// signals.

export type TransferEventRow = {
  id: string;
  slug: string;
  title_en: string | null;
  title_cn: string | null;
  arrival_day: string | null;
  departure_day: string | null;
  city: string | null;
  status: string;
  main_venue_hotel_name: string | null;
  transfer_sheet_id: string | null;
  transfer_sheet_url: string | null;
  transfer_synced_at: string | null;
  // Total approved/paid enrolments — denominator for "X/Y confirmed" pills.
  total_enrolled: number;
  arrival: TransferDirectionState;
  departure: TransferDirectionState;
};

export type TransferDirectionState = {
  list_id: string | null;
  status: "draft" | "final" | null;
  generated_at: string | null;
  total_groups: number;
  total_pax: number;
  flight_count: number;
  flight_count_confirmed: number;
};

type EventQueryRow = {
  id: string;
  slug: string;
  title_en: string | null;
  title_cn: string | null;
  arrival_day: string | null;
  departure_day: string | null;
  city: string | null;
  status: string;
  main_venue_hotel_name: string | null;
  transfer_sheet_id: string | null;
  transfer_sheet_url: string | null;
  transfer_synced_at: string | null;
};

export async function loadTransferListsOverview(
  supabase: SupabaseClient,
): Promise<TransferEventRow[]> {
  const { data: events, error } = await supabase
    .from("events")
    .select(
      "id, slug, title_en, title_cn, arrival_day, departure_day, city, status, main_venue_hotel_name, transfer_sheet_id, transfer_sheet_url, transfer_synced_at",
    )
    .neq("status", "archived")
    .order("start_date", { ascending: false, nullsFirst: false })
    .returns<EventQueryRow[]>();
  if (error) {
    throw new Error(`loadTransferListsOverview: ${error.message}`);
  }
  if (!events || events.length === 0) return [];

  const eventIds = events.map((e) => e.id);

  const { data: lists, error: listErr } = await supabase
    .from("transfer_lists")
    .select("id, event_id, direction, status, generated_at")
    .in("event_id", eventIds);
  if (listErr) {
    throw new Error(`loadTransferListsOverview lists: ${listErr.message}`);
  }

  const listIds = (lists ?? []).map((l) => l.id);
  const rowCounts = new Map<string, { groups: number; pax: number }>();
  if (listIds.length > 0) {
    const { data: rows, error: rowsErr } = await supabase
      .from("transfer_list_rows")
      .select("transfer_list_id, flight_info_ids")
      .in("transfer_list_id", listIds);
    if (rowsErr) {
      throw new Error(`loadTransferListsOverview rows: ${rowsErr.message}`);
    }
    for (const r of rows ?? []) {
      const cur = rowCounts.get(r.transfer_list_id) ?? { groups: 0, pax: 0 };
      cur.groups += 1;
      cur.pax += (r.flight_info_ids ?? []).length;
      rowCounts.set(r.transfer_list_id, cur);
    }
  }

  // Flight count per (event, direction) — joined via enrollments.
  const { data: flights, error: flErr } = await supabase
    .from("flight_info")
    .select(
      "direction, confirmed_at, enrollment:enrollments!inner(event_id)",
    )
    .in("enrollment.event_id", eventIds)
    .returns<
      Array<{
        direction: "arrival" | "departure";
        confirmed_at: string | null;
        enrollment: { event_id: string } | null;
      }>
    >();
  if (flErr) {
    throw new Error(`loadTransferListsOverview flights: ${flErr.message}`);
  }
  const flightTotals = new Map<string, { total: number; confirmed: number }>();
  for (const f of flights ?? []) {
    const eid = f.enrollment?.event_id;
    if (!eid) continue;
    const key = `${eid}:${f.direction}`;
    const cur = flightTotals.get(key) ?? { total: 0, confirmed: 0 };
    cur.total += 1;
    if (f.confirmed_at) cur.confirmed += 1;
    flightTotals.set(key, cur);
  }

  // Approved/paid enrolment counts per event — drives the "X enrolled"
  // chip and the denominator on the per-direction confirmed-flight ratio.
  const { data: enrolRows } = await supabase
    .from("enrollments")
    .select("event_id")
    .in("event_id", eventIds)
    .in("status", ["approved", "paid"])
    .returns<Array<{ event_id: string }>>();
  const enrolByEvent = new Map<string, number>();
  for (const r of enrolRows ?? []) {
    enrolByEvent.set(r.event_id, (enrolByEvent.get(r.event_id) ?? 0) + 1);
  }

  return events.map((e) => {
    const arrivalList = (lists ?? []).find(
      (l) => l.event_id === e.id && l.direction === "arrival",
    );
    const departureList = (lists ?? []).find(
      (l) => l.event_id === e.id && l.direction === "departure",
    );
    const af = flightTotals.get(`${e.id}:arrival`) ?? { total: 0, confirmed: 0 };
    const df = flightTotals.get(`${e.id}:departure`) ?? { total: 0, confirmed: 0 };
    return {
      ...e,
      total_enrolled: enrolByEvent.get(e.id) ?? 0,
      arrival: {
        list_id: arrivalList?.id ?? null,
        status: (arrivalList?.status as "draft" | "final" | null) ?? null,
        generated_at: arrivalList?.generated_at ?? null,
        total_groups: arrivalList ? rowCounts.get(arrivalList.id)?.groups ?? 0 : 0,
        total_pax: arrivalList ? rowCounts.get(arrivalList.id)?.pax ?? 0 : 0,
        flight_count: af.total,
        flight_count_confirmed: af.confirmed,
      },
      departure: {
        list_id: departureList?.id ?? null,
        status: (departureList?.status as "draft" | "final" | null) ?? null,
        generated_at: departureList?.generated_at ?? null,
        total_groups: departureList
          ? rowCounts.get(departureList.id)?.groups ?? 0
          : 0,
        total_pax: departureList
          ? rowCounts.get(departureList.id)?.pax ?? 0
          : 0,
        flight_count: df.total,
        flight_count_confirmed: df.confirmed,
      },
    };
  });
}

// Loader for the per-event detail page. Returns the event + both directions'
// lists hydrated with rows + joined flight_info → participant.

export type TransferDetailDirection = {
  direction: "arrival" | "departure";
  list:
    | {
        id: string;
        status: "draft" | "final";
        generated_at: string;
        rules_snapshot: Record<string, unknown>;
      }
    | null;
  rows: TransferDetailRow[];
};

export type ManualPassenger = {
  name: string;
  region_id?: string | null;
  note?: string | null;
};

export type TransferDetailRow = {
  id: string;
  group_no: number;
  vehicle_type: string | null;
  landing_or_takeoff_at: string | null;
  terminal: string | null;
  destination: string | null;
  remark: string | null;
  vip: boolean;
  admin_edited: boolean;
  flight_info_ids: string[];
  flights: TransferRowFlight[];
  manual_passengers: ManualPassenger[];
};

export type TransferRowFlight = {
  id: string;
  enrollment_id: string;
  flight_number: string | null;
  airline: string | null;
  origin_airport: string | null;
  destination_airport: string | null;
  scheduled_at: string | null;
  terminal: string | null;
  hotel_key: string | null;
  is_vip: boolean;
  participant: {
    id: string;
    region_id: string | null;
    name_cn: string | null;
    name_en: string | null;
    region: string | null;
  } | null;
};

export type TransferDetail = {
  event: TransferEventRow;
  arrival: TransferDetailDirection;
  departure: TransferDetailDirection;
};

export async function loadTransferDetail(
  supabase: SupabaseClient,
  eventId: string,
): Promise<TransferDetail | null> {
  const { data: events } = await supabase
    .from("events")
    .select(
      "id, slug, title_en, title_cn, arrival_day, departure_day, city, status, main_venue_hotel_name, transfer_sheet_id, transfer_sheet_url, transfer_synced_at",
    )
    .eq("id", eventId)
    .returns<EventQueryRow[]>();
  if (!events || events.length === 0) return null;
  const ev = events[0];

  // Fetch only this event's transfer_lists. Earlier this called
  // loadTransferListsOverview() which scans every event in the org just to
  // find one row — measurably slow on prod-sized data.
  const { data: eventLists } = await supabase
    .from("transfer_lists")
    .select("id, direction, status, generated_at")
    .eq("event_id", eventId)
    .returns<
      Array<{
        id: string;
        direction: "arrival" | "departure";
        status: "draft" | "final";
        generated_at: string;
      }>
    >();

  const arrivalListId =
    eventLists?.find((l) => l.direction === "arrival")?.id ?? null;
  const departureListId =
    eventLists?.find((l) => l.direction === "departure")?.id ?? null;

  // Build the EventRow shape the page expects. flight_count / *_confirmed
  // and total_groups / total_pax are only used on the overview page, not
  // here — defaulted to 0 to satisfy the type.
  const aggregated: TransferEventRow = {
    ...ev,
    total_enrolled: 0,
    arrival: {
      list_id: arrivalListId,
      status:
        (eventLists?.find((l) => l.direction === "arrival")?.status as
          | "draft"
          | "final"
          | null) ?? null,
      generated_at:
        eventLists?.find((l) => l.direction === "arrival")?.generated_at ?? null,
      total_groups: 0,
      total_pax: 0,
      flight_count: 0,
      flight_count_confirmed: 0,
    },
    departure: {
      list_id: departureListId,
      status:
        (eventLists?.find((l) => l.direction === "departure")?.status as
          | "draft"
          | "final"
          | null) ?? null,
      generated_at:
        eventLists?.find((l) => l.direction === "departure")?.generated_at ?? null,
      total_groups: 0,
      total_pax: 0,
      flight_count: 0,
      flight_count_confirmed: 0,
    },
  };

  const directions: ("arrival" | "departure")[] = ["arrival", "departure"];
  const out: Record<string, TransferDetailDirection> = {};

  for (const dir of directions) {
    const aggDir = dir === "arrival" ? aggregated.arrival : aggregated.departure;
    if (!aggDir.list_id) {
      out[dir] = { direction: dir, list: null, rows: [] };
      continue;
    }
    const { data: list } = await supabase
      .from("transfer_lists")
      .select("id, status, generated_at, rules_snapshot")
      .eq("id", aggDir.list_id)
      .maybeSingle<{
        id: string;
        status: "draft" | "final";
        generated_at: string;
        rules_snapshot: Record<string, unknown>;
      }>();

    type RowDb = {
      id: string;
      group_no: number;
      vehicle_type: string | null;
      landing_or_takeoff_at: string | null;
      terminal: string | null;
      destination: string | null;
      remark: string | null;
      vip: boolean;
      admin_edited: boolean;
      flight_info_ids: string[];
      manual_passengers: ManualPassenger[] | null;
    };
    const { data: rows } = await supabase
      .from("transfer_list_rows")
      .select(
        "id, group_no, vehicle_type, landing_or_takeoff_at, terminal, destination, remark, vip, admin_edited, flight_info_ids, manual_passengers",
      )
      .eq("transfer_list_id", aggDir.list_id)
      .order("group_no", { ascending: true })
      .returns<RowDb[]>();

    const allFlightIds = Array.from(
      new Set((rows ?? []).flatMap((r) => r.flight_info_ids ?? [])),
    );
    let flights: TransferRowFlight[] = [];
    if (allFlightIds.length > 0) {
      const { data: f } = await supabase
        .from("flight_info")
        .select(
          "id, enrollment_id, flight_number, airline, origin_airport, destination_airport, scheduled_at, terminal, hotel_key, is_vip, enrollment:enrollments!inner(participant:participants!inner(id, region_id, name_cn, name_en, region))",
        )
        .in("id", allFlightIds)
        .returns<
          Array<{
            id: string;
            enrollment_id: string;
            flight_number: string | null;
            airline: string | null;
            origin_airport: string | null;
            destination_airport: string | null;
            scheduled_at: string | null;
            terminal: string | null;
            hotel_key: string | null;
            is_vip: boolean;
            enrollment: {
              participant: {
                id: string;
                region_id: string | null;
                name_cn: string | null;
                name_en: string | null;
                region: string | null;
              } | null;
            } | null;
          }>
        >();
      flights = (f ?? []).map((row) => ({
        id: row.id,
        enrollment_id: row.enrollment_id,
        flight_number: row.flight_number,
        airline: row.airline,
        origin_airport: row.origin_airport,
        destination_airport: row.destination_airport,
        scheduled_at: row.scheduled_at,
        terminal: row.terminal,
        hotel_key: row.hotel_key,
        is_vip: row.is_vip,
        participant: row.enrollment?.participant ?? null,
      }));
    }

    out[dir] = {
      direction: dir,
      list: list ?? null,
      rows: (rows ?? []).map((r) => ({
        ...r,
        manual_passengers: r.manual_passengers ?? [],
        flights: (r.flight_info_ids ?? [])
          .map((fid: string) => flights.find((fl) => fl.id === fid))
          .filter((x): x is TransferRowFlight => Boolean(x)),
      })),
    };
  }

  return {
    event: aggregated,
    arrival: out.arrival,
    departure: out.departure,
  };
}
