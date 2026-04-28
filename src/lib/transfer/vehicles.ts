// Vehicle capacity table — pax counts assume luggage onboard.
// Source: Skills/airport-transfer-list.md, "Vehicle Selection" table.

export type Vehicle = {
  type: string;          // exact label written into transfer_list_rows.vehicle_type
  capacity: number;      // max pax with luggage
};

// Listed smallest → largest. The picker walks this in order and returns the
// first vehicle whose capacity ≥ pax count. Coach (Van 18-seater) is a hard
// override for the departure-day ≥15:00 group regardless of pax count.
export const VEHICLES: readonly Vehicle[] = [
  { type: "Sedan", capacity: 2 },
  { type: "Regular MPV", capacity: 4 },
  { type: "Staria/Starex (9-seater)", capacity: 7 },
  { type: "Combi (13-seater)", capacity: 9 },
  { type: "Van (18-seater)", capacity: 14 },
] as const;

export const VIP_VEHICLE_LABEL = "Luxury MPV (Alphard / Vellfire) — VIP";

export const COACH_VEHICLE = VEHICLES[VEHICLES.length - 1]; // Van 18-seater

// Pick the smallest vehicle whose capacity covers `pax`. If pax exceeds the
// largest single vehicle, returns the largest — caller decides whether to
// split into multiple coaches (departure-day coach group is a single row even
// if it overflows; logistics handles overflow on the ground).
export function pickVehicle(pax: number): Vehicle {
  if (pax <= 0) return VEHICLES[0];
  for (const v of VEHICLES) {
    if (v.capacity >= pax) return v;
  }
  return VEHICLES[VEHICLES.length - 1];
}
