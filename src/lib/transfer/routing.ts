// Hotel routing — resolves the destination text per arrival/departure rules.
//
// Arrivals: drop at participant's assigned hotel; non-designated participants
// (hotel_key null or unknown) → main venue hotel.
// Departures: ALL participants depart from the main venue hotel regardless of
// where they're staying.

import { customHotelName } from "./hotels";
import type { EventContext, FlightRow, GeneratorRules } from "./types";

export function arrivalDestination(row: FlightRow, ctx: EventContext): string {
  if (!row.hotel_key) return ctx.main_venue_hotel_name;
  const custom = customHotelName(row.hotel_key)?.trim();
  if (custom) return custom;
  if (row.hotel_key === "main_venue") return ctx.main_venue_hotel_name;
  if (row.hotel_key.startsWith("designated:")) {
    const id = row.hotel_key.slice("designated:".length);
    return ctx.designated_hotels[id] ?? ctx.main_venue_hotel_name;
  }
  return ctx.main_venue_hotel_name;
}

export function departurePickup(ctx: EventContext): string {
  return ctx.main_venue_hotel_name;
}

// The passenger's own hotel when their departure flight has an "Other hotel"
// and the list is set to collect from it; otherwise null (main venue).
export function ownHotelPickup(
  row: FlightRow,
  rules: GeneratorRules,
): string | null {
  if (rules.other_hotel_pickup === "main") return null;
  return customHotelName(row.hotel_key)?.trim() || null;
}
