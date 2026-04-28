// Flight-info string formatter + IATA → city-name lookup.
//
// The transfer list uses the human format "[FlightNo] [Origin]-[Destination]
// [HHMM]-[HHMM]" — never IATA codes for cities (Skills/airport-transfer-list.md).
// We only ever need the IATA→city translation for cities GMC routes flow
// through; unknown codes fall back to the raw IATA so logistics can still
// read the row.

import type { FlightRow } from "./types";

// Cities GMC participants commonly fly through. Extend as new events add
// hubs. Lowercase keys; lookup is case-insensitive.
const IATA_CITY: Record<string, string> = {
  pen: "Penang",
  kul: "KL",
  sin: "Singapore",
  tpe: "Taipei",
  tsa: "Taipei",
  hkg: "HK",
  pvg: "Shanghai",
  sha: "Shanghai",
  pek: "Beijing",
  pkx: "Beijing",
  can: "Guangzhou",
  szx: "Shenzhen",
  jhb: "JB",
  ctu: "Chengdu",
  xiy: "Xi'an",
  hgh: "Hangzhou",
  bki: "KK",
  bkk: "Bangkok",
  dmk: "Bangkok",
};

export function iataToCity(iata: string | null | undefined): string {
  if (!iata) return "?";
  return IATA_CITY[iata.toLowerCase()] ?? iata.toUpperCase();
}

// HH:MM (24h) → HHMM. Reads the *local* clock face directly off the ISO
// string by leaning on Date's UTC components when scheduled_at carries a Z;
// upstream stores timestamptz so the value is unambiguous as a moment in time.
// We render it in the airport-local clock by trusting the inbound entry:
// admin types times in the airport-local frame and we round-trip the same.
export function hhmmFromIso(iso: string): string {
  const d = new Date(iso);
  const h = String(d.getUTCHours()).padStart(2, "0");
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  return `${h}${m}`;
}

// Returns "AK6412 JB-Penang 0800-0910" style. Departure flights have no
// landing time relative to the destination so we just print scheduled
// (takeoff) time on both sides — caller can decide which slot to use.
//
// Per the spec, departure flight info reads as
//     "[FlightNo] [Origin]-[Destination] [Departure time]-[Arrival time]"
// We do not store arrival time on flight_info, so we print "????" for the
// missing side. Logistics fills the verified arrival time in the Sheet
// during the manual verification pass.
export function formatFlightInfo(row: FlightRow): string {
  const fn = row.flight_number ?? "????";
  const origin = iataToCity(row.origin_airport);
  const dest = iataToCity(row.destination_airport);
  const time = hhmmFromIso(row.scheduled_at);
  return `${fn} ${origin}-${dest} ${time}`;
}
