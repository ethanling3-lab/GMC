// Hotel routing — resolves the destination text per arrival/departure rules.
//
// Arrivals: drop at participant's assigned hotel; non-designated participants
// (hotel_key null or unknown) → main venue hotel.
// Departures: ALL participants depart from the main venue hotel regardless of
// where they're staying.

import type { EventContext, FlightRow } from "./types";

export function arrivalDestination(row: FlightRow, ctx: EventContext): string {
  if (!row.hotel_key) return ctx.main_venue_hotel_name;
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
