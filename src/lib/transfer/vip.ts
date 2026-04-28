// VIP separation — VIPs are pulled out of the consolidation pool entirely
// and assigned a private Luxury MPV. They never share a vehicle with anyone,
// regardless of flight or timing.

import type { FlightRow, TransferGroup, FlightDirection } from "./types";
import { VIP_VEHICLE_LABEL } from "./vehicles";

export function partitionVip(rows: FlightRow[]): {
  vips: FlightRow[];
  rest: FlightRow[];
} {
  const vips: FlightRow[] = [];
  const rest: FlightRow[] = [];
  for (const r of rows) {
    if (r.is_vip) vips.push(r);
    else rest.push(r);
  }
  return { vips, rest };
}

// One private group per VIP. Caller decides destination text + remark; this
// helper just shells out the canonical VIP-row shape.
export function buildVipGroup(args: {
  pax: FlightRow;
  direction: FlightDirection;
  scheduled_at: string;
  destination: string;
  terminal: string | null;
  remarkExtra?: string | null;
}): Omit<TransferGroup, "group_no"> {
  const { pax, direction, scheduled_at, destination, terminal, remarkExtra } = args;
  return {
    direction,
    vehicle_type: VIP_VEHICLE_LABEL,
    landing_or_takeoff_at: scheduled_at,
    terminal,
    destination,
    remark: remarkExtra ? `VIP — private transfer · ${remarkExtra}` : "VIP — private transfer",
    vip: true,
    flight_info_ids: [pax.flight_info_id],
    passengers: [pax],
  };
}
