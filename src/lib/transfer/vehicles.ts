// Vehicle rules, set by Ethan 2026-11-22. Capacity = max pax with luggage.

export type Vehicle = {
  type: string;          // exact label written into transfer_list_rows.vehicle_type
  capacity: number;
};

export type OversizeStrategy = "split" | "bus";

const SEDAN: Vehicle = { type: "Sedan", capacity: 2 };
const PREMIUM_SEDAN: Vehicle = { type: "Premium Sedan", capacity: 2 };
const MPV: Vehicle = { type: "Regular MPV", capacity: 3 };
const ALPHARD_3: Vehicle = { type: "Alphard 3rd gen", capacity: 4 };
const ALPHARD_4: Vehicle = { type: "Alphard 4th gen", capacity: 4 };
const SEATER_8: Vehicle = { type: "7/8 Seaters", capacity: 6 };
const SEATER_10: Vehicle = { type: "10 Seaters", capacity: 8 };
const COMBI: Vehicle = { type: "13 Seaters Combi", capacity: 9 };
const VAN: Vehicle = { type: "Van 18 Seaters", capacity: 14 };
export const BUS_VEHICLE: Vehicle = { type: "Bus 45 Seaters", capacity: 40 };

// Automatic assignment, smallest to largest. Premium Sedan and Alphards are
// VIP or manual picks.
export const VEHICLES: readonly Vehicle[] = [SEDAN, MPV, SEATER_8, SEATER_10, COMBI, VAN];

export const VIP_VEHICLE_LABEL = ALPHARD_3.type;

// Everything staff can choose in the Vehicle dropdown.
export const VEHICLE_CHOICES: readonly Vehicle[] = [
  SEDAN,
  PREMIUM_SEDAN,
  MPV,
  ALPHARD_3,
  ALPHARD_4,
  SEATER_8,
  SEATER_10,
  COMBI,
  VAN,
  BUS_VEHICLE,
];

// Labels on lists generated before the 2026-11-22 rules.
const OLD_LABEL_CAPACITY: Record<string, number> = {
  "Staria/Starex (9-seater)": 7,
  "Combi (13-seater)": 9,
  "Van (18-seater)": 14,
  "Luxury MPV (Alphard / Vellfire) — VIP": 4,
};

export function capacityOf(label: string): number | undefined {
  return (
    VEHICLE_CHOICES.find((v) => v.type === label)?.capacity ??
    OLD_LABEL_CAPACITY[label]
  );
}

// Smallest automatic vehicle that fits `pax`, capped at the Van.
export function pickVehicle(pax: number): Vehicle {
  if (pax <= 0) return VEHICLES[0];
  for (const v of VEHICLES) {
    if (v.capacity >= pax) return v;
  }
  return VAN;
}

// Vehicles needed so nobody is over capacity. Over 14 pax, "split" fills Vans
// and "bus" fills 45-seaters, then the remainder takes the smallest that fits.
export function planVehicles(
  pax: number,
  strategy: OversizeStrategy,
): { vehicle: Vehicle; pax: number }[] {
  const plan: { vehicle: Vehicle; pax: number }[] = [];
  let remaining = pax;
  while (remaining > 0) {
    const vehicle =
      remaining > VAN.capacity
        ? strategy === "bus"
          ? BUS_VEHICLE
          : VAN
        : pickVehicle(remaining);
    const seated = Math.min(vehicle.capacity, remaining);
    plan.push({ vehicle, pax: seated });
    remaining -= seated;
  }
  return plan;
}
