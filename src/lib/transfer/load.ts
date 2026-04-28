import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase";
import type { EventContext, FlightDirection, FlightRow } from "./types";

// Loads the inputs the generator needs for a single (event, direction) pair:
//   * event row → arrival/departure days, main venue hotel, designated hotels
//   * confirmed flight_info rows for that event + direction, joined with
//     enrollments → participants for display labels
//
// Only confirmed flight_info rows participate (confirmed_at is not null).
// Unconfirmed rows are extracted-but-pending data — admin must verify
// through the inbox panel before they enter a transfer list.

export type LoadedInputs = {
  context: EventContext;
  flights: FlightRow[];
};

type EventDbRow = {
  id: string;
  arrival_day: string | null;
  departure_day: string | null;
  city: string | null;
  main_venue_hotel_name: string | null;
  designated_hotels: Record<string, string> | null;
};

type FlightDbRow = {
  id: string;
  enrollment_id: string;
  direction: FlightDirection;
  flight_number: string | null;
  airline: string | null;
  origin_airport: string | null;
  destination_airport: string | null;
  scheduled_at: string;
  terminal: string | null;
  hotel_key: string | null;
  is_vip: boolean;
  confirmed_at: string | null;
  enrollment: {
    participant_id: string;
    participant: {
      id: string;
      region_id: string | null;
      name_cn: string | null;
      name_en: string | null;
      region: string | null;
    } | null;
  } | null;
};

export async function loadGeneratorInputs(
  eventId: string,
  direction: FlightDirection,
): Promise<LoadedInputs | { error: string }> {
  const service = createSupabaseServiceClient();

  const { data: ev, error: evErr } = await service
    .from("events")
    .select(
      "id, arrival_day, departure_day, city, main_venue_hotel_name, designated_hotels",
    )
    .eq("id", eventId)
    .maybeSingle<EventDbRow>();

  if (evErr) return { error: evErr.message };
  if (!ev) return { error: "event_not_found" };

  if (!ev.main_venue_hotel_name) {
    return {
      error: "missing_main_venue_hotel_name",
    };
  }

  const { data: rows, error: rowsErr } = await service
    .from("flight_info")
    .select(
      [
        "id",
        "enrollment_id",
        "direction",
        "flight_number",
        "airline",
        "origin_airport",
        "destination_airport",
        "scheduled_at",
        "terminal",
        "hotel_key",
        "is_vip",
        "confirmed_at",
        "enrollment:enrollments!inner(participant_id, participant:participants!inner(id, region_id, name_cn, name_en, region), event_id)",
      ].join(", "),
    )
    .eq("direction", direction)
    .eq("enrollment.event_id", eventId)
    .not("confirmed_at", "is", null)
    .not("scheduled_at", "is", null)
    .returns<FlightDbRow[]>();

  if (rowsErr) return { error: rowsErr.message };

  const flights: FlightRow[] = (rows ?? [])
    .filter((r) => r.scheduled_at && r.enrollment?.participant)
    .map((r) => ({
      flight_info_id: r.id,
      enrollment_id: r.enrollment_id,
      participant_id: r.enrollment!.participant!.id,
      region_id: r.enrollment!.participant!.region_id,
      name_cn: r.enrollment!.participant!.name_cn,
      name_en: r.enrollment!.participant!.name_en,
      region: r.enrollment!.participant!.region,
      flight_number: r.flight_number,
      airline: r.airline,
      origin_airport: r.origin_airport,
      destination_airport: r.destination_airport,
      scheduled_at: r.scheduled_at,
      terminal: r.terminal,
      hotel_key: r.hotel_key,
      is_vip: r.is_vip,
    }));

  const context: EventContext = {
    event_id: ev.id,
    arrival_day: ev.arrival_day,
    departure_day: ev.departure_day,
    main_venue_hotel_name: ev.main_venue_hotel_name,
    designated_hotels: ev.designated_hotels ?? {},
    event_city: ev.city,
  };

  return { context, flights };
}
