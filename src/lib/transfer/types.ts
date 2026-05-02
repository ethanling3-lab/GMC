// Shared types for the transfer-list generator.
//
// The generator is a pure function from a confirmed flight_info row set +
// per-event context to an ordered list of vehicle groups. The route layer
// loads inputs from Supabase, calls generate(), and persists the output to
// transfer_lists + transfer_list_rows.

export type FlightDirection = "arrival" | "departure";

// Hotel routing key. Mirrors the convention captured in flight_info.hotel_key:
//   'main_venue'        — staying at the event's main venue hotel
//   'designated:<id>'   — staying at a designated organiser-assigned hotel
//   null / unknown      — non-designated, drop at main venue (arrivals only)
export type HotelKey = string | null;

// Single confirmed flight + the participant it belongs to, with everything
// the generator needs to bucket and label the row.
export type FlightRow = {
  flight_info_id: string;
  enrollment_id: string;
  participant_id: string;

  // Display / labelling
  region_id: string | null;        // e.g. MY001 — null while still a lead
  name_cn: string | null;
  name_en: string | null;
  region: string | null;           // MY / SG / TW / HK / CN

  // Flight
  flight_number: string | null;
  airline: string | null;
  origin_airport: string | null;   // IATA 3-letter
  destination_airport: string | null;
  scheduled_at: string;            // ISO timestamptz
  terminal: string | null;
  hotel_key: HotelKey;
  is_vip: boolean;
};

// Per-event context resolved by the route layer before calling generate().
export type EventContext = {
  event_id: string;
  arrival_day: string | null;       // YYYY-MM-DD
  departure_day: string | null;     // YYYY-MM-DD
  main_venue_hotel_name: string;    // human label (e.g. "St. Giles")
  // Designated hotels keyed by hotel_key suffix. Used to render destination
  // text on arrival rows for `hotel_key = 'designated:<id>'`.
  designated_hotels: Record<string, string>; // { '<hotel_id>': 'Cititel', ... }
  // City the event is in. Decides the city-name side of the flight info string.
  event_city: string | null;
  // Per-event overrides parsed from events.transfer_rules. Empty object when
  // the column is unset — caller merges into DEFAULT_RULES.
  rules_override: Partial<GeneratorRules>;
};

// One vehicle group = one row in transfer_list_rows. The passengers array is
// hydrated for UI; persistence flattens to flight_info_ids[].
export type TransferGroup = {
  group_no: number;
  direction: FlightDirection;
  vehicle_type: string;
  landing_or_takeoff_at: string;    // ISO — arrivals: latest landing in group; departures: hotel-departure time
  terminal: string | null;
  destination: string;              // arrivals: dropoff hotel; departures: pickup point (e.g. "St. Giles")
  remark: string | null;
  vip: boolean;
  flight_info_ids: string[];
  passengers: FlightRow[];
};

// Engine knobs surfaced for `rules_snapshot` so we can re-derive what the
// generator was told to do at the time it ran. All fields except the
// vehicle_table_version are overrideable per-event via events.transfer_rules.
export type GeneratorRules = {
  consolidation_window_minutes: number;       // 30
  departure_lead_hours: number;               // 3
  coach_cutoff_hour_local: number;            // 15 (≥15:00 = coach)
  coach_hotel_departure_local: string;        // '12:00'
  coach_rule_enabled: boolean;                // false → flights ≥cutoff use 3-hour rule, no 12:00 coach
  vehicle_table_version: string;              // for telemetry / audit
};

export const DEFAULT_RULES: GeneratorRules = {
  consolidation_window_minutes: 30,
  departure_lead_hours: 3,
  coach_cutoff_hour_local: 15,
  coach_hotel_departure_local: "12:00",
  coach_rule_enabled: true,
  vehicle_table_version: "2026-04-28",
};

// Validates a per-event override JSONB against the GeneratorRules shape and
// returns a clean Partial<GeneratorRules>. Unknown keys are dropped; invalid
// types are skipped so a malformed events.transfer_rules row falls back to
// defaults rather than blowing up the generator.
export function parseRulesOverride(
  raw: unknown,
): Partial<GeneratorRules> {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<GeneratorRules> = {};
  if (typeof r.consolidation_window_minutes === "number" && r.consolidation_window_minutes > 0) {
    out.consolidation_window_minutes = Math.floor(r.consolidation_window_minutes);
  }
  if (typeof r.departure_lead_hours === "number" && r.departure_lead_hours >= 0) {
    out.departure_lead_hours = r.departure_lead_hours;
  }
  if (
    typeof r.coach_cutoff_hour_local === "number" &&
    r.coach_cutoff_hour_local >= 0 &&
    r.coach_cutoff_hour_local <= 23
  ) {
    out.coach_cutoff_hour_local = Math.floor(r.coach_cutoff_hour_local);
  }
  if (
    typeof r.coach_hotel_departure_local === "string" &&
    /^\d{1,2}:\d{2}$/.test(r.coach_hotel_departure_local)
  ) {
    out.coach_hotel_departure_local = r.coach_hotel_departure_local;
  }
  if (typeof r.coach_rule_enabled === "boolean") {
    out.coach_rule_enabled = r.coach_rule_enabled;
  }
  return out;
}
