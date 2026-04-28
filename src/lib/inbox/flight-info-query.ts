import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Loader for the FlightInfoPanel in the inbox thread right rail.
// Returns the participant's enrolments alongside their current flight_info
// rows + the per-event hotel metadata (main_venue_hotel_name, designated_hotels)
// so the panel can render the hotel dropdown without a second roundtrip.

export type FlightInfoSlot = {
  id: string | null;
  flight_number: string | null;
  airline: string | null;
  origin_airport: string | null;
  destination_airport: string | null;
  scheduled_at: string | null;
  terminal: string | null;
  hotel_key: string | null;
  is_vip: boolean;
  source: "manual" | "ai_extract" | "api" | null;
  confirmed_at: string | null;
};

export type FlightInfoEnrollmentRow = {
  enrollment_id: string;
  event_id: string;
  event_title: string;
  event_slug: string;
  arrival_day: string | null;
  departure_day: string | null;
  main_venue_hotel_name: string | null;
  designated_hotels: Record<string, string>;
  arrival: FlightInfoSlot;
  departure: FlightInfoSlot;
};

const EMPTY_SLOT: FlightInfoSlot = {
  id: null,
  flight_number: null,
  airline: null,
  origin_airport: null,
  destination_airport: null,
  scheduled_at: null,
  terminal: null,
  hotel_key: null,
  is_vip: false,
  source: null,
  confirmed_at: null,
};

export async function loadFlightInfoForParticipant(
  supabase: SupabaseClient,
  participantId: string,
): Promise<FlightInfoEnrollmentRow[]> {
  const { data: enrollRows, error: enrErr } = await supabase
    .from("enrollments")
    .select(
      "id, event_id, status, event:events!inner(id, title_en, title_cn, slug, arrival_day, departure_day, main_venue_hotel_name, designated_hotels)",
    )
    .eq("participant_id", participantId)
    .order("created_at", { ascending: false })
    .returns<
      Array<{
        id: string;
        event_id: string;
        status: string;
        event: {
          id: string;
          title_en: string | null;
          title_cn: string | null;
          slug: string;
          arrival_day: string | null;
          departure_day: string | null;
          main_venue_hotel_name: string | null;
          designated_hotels: Record<string, string> | null;
        } | null;
      }>
    >();
  if (enrErr) {
    // Pre-migration-018, the events.main_venue_hotel_name + designated_hotels
    // columns don't exist; the SELECT errors. Don't break the inbox thread
    // for the sake of the rail panel — log and degrade to an empty list.
    console.warn(
      "[flight-info-query] enrolment fetch failed, returning empty:",
      enrErr.message,
    );
    return [];
  }

  // Filter to enrolments on events that need transfer logistics + are not
  // archived. An event "needs travel" if either arrival_day or departure_day
  // is set on it. Reduces cognitive load — admins don't see flights for
  // local-only courses.
  const relevant = (enrollRows ?? []).filter(
    (e) =>
      e.event &&
      (e.event.arrival_day || e.event.departure_day) &&
      e.status !== "cancelled",
  );

  if (relevant.length === 0) return [];

  const enrollmentIds = relevant.map((e) => e.id);
  const { data: flights, error: flErr } = await supabase
    .from("flight_info")
    .select(
      "id, enrollment_id, direction, flight_number, airline, origin_airport, destination_airport, scheduled_at, terminal, hotel_key, is_vip, source, confirmed_at",
    )
    .in("enrollment_id", enrollmentIds)
    .returns<
      Array<{
        id: string;
        enrollment_id: string;
        direction: "arrival" | "departure";
        flight_number: string | null;
        airline: string | null;
        origin_airport: string | null;
        destination_airport: string | null;
        scheduled_at: string | null;
        terminal: string | null;
        hotel_key: string | null;
        is_vip: boolean;
        source: "manual" | "ai_extract" | "api";
        confirmed_at: string | null;
      }>
    >();
  if (flErr) {
    throw new Error(`loadFlightInfoForParticipant flights: ${flErr.message}`);
  }

  return relevant.map((e) => {
    const arrival = (flights ?? []).find(
      (f) => f.enrollment_id === e.id && f.direction === "arrival",
    );
    const departure = (flights ?? []).find(
      (f) => f.enrollment_id === e.id && f.direction === "departure",
    );
    const event = e.event!;
    const title =
      event.title_en || event.title_cn
        ? `${event.title_en ?? ""}${event.title_en && event.title_cn ? " · " : ""}${event.title_cn ?? ""}`
        : event.slug;
    return {
      enrollment_id: e.id,
      event_id: event.id,
      event_title: title,
      event_slug: event.slug,
      arrival_day: event.arrival_day,
      departure_day: event.departure_day,
      main_venue_hotel_name: event.main_venue_hotel_name,
      designated_hotels: event.designated_hotels ?? {},
      arrival: arrival
        ? {
            id: arrival.id,
            flight_number: arrival.flight_number,
            airline: arrival.airline,
            origin_airport: arrival.origin_airport,
            destination_airport: arrival.destination_airport,
            scheduled_at: arrival.scheduled_at,
            terminal: arrival.terminal,
            hotel_key: arrival.hotel_key,
            is_vip: arrival.is_vip,
            source: arrival.source,
            confirmed_at: arrival.confirmed_at,
          }
        : EMPTY_SLOT,
      departure: departure
        ? {
            id: departure.id,
            flight_number: departure.flight_number,
            airline: departure.airline,
            origin_airport: departure.origin_airport,
            destination_airport: departure.destination_airport,
            scheduled_at: departure.scheduled_at,
            terminal: departure.terminal,
            hotel_key: departure.hotel_key,
            is_vip: departure.is_vip,
            source: departure.source,
            confirmed_at: departure.confirmed_at,
          }
        : EMPTY_SLOT,
    };
  });
}
