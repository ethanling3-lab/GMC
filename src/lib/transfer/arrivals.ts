// Arrival list builder.
//
// Rules (Skills/airport-transfer-list.md):
//   * Same-flight passengers → one vehicle.
//   * Different flights, ≤30 min apart → consolidate into one vehicle.
//   * Group's pickup time = LATEST landing in the bucket.
//   * Vehicle by combined pax count.
//   * VIPs always private (Luxury MPV).
//   * Drop at participant's hotel; non-designated → main venue.
//   * Sort ascending by date + time.

import type { EventContext, FlightRow, GeneratorRules, TransferGroup } from "./types";
import { partitionVip, buildVipGroup } from "./vip";
import { sortByScheduled, consolidate, consolidationRemark } from "./consolidate";
import { pickVehicle } from "./vehicles";
import { arrivalDestination } from "./routing";
import { collapseTerminals } from "./time";

export function buildArrivals(
  flights: FlightRow[],
  ctx: EventContext,
  rules: GeneratorRules,
): TransferGroup[] {
  const { vips, rest } = partitionVip(flights);

  const groups: TransferGroup[] = [];

  // VIPs — one private group each, sized by their own scheduled_at.
  for (const v of sortByScheduled(vips)) {
    groups.push({
      ...buildVipGroup({
        pax: v,
        direction: "arrival",
        scheduled_at: v.scheduled_at,
        destination: arrivalDestination(v, ctx),
        terminal: v.terminal,
      }),
      group_no: 0,
    });
  }

  // Non-VIPs — 30-min consolidation buckets, one row per bucket. Multi-hotel
  // drop-offs ride one vehicle with the destination text listing each hotel.
  const buckets = consolidate(sortByScheduled(rest), rules.consolidation_window_minutes);

  for (const bucket of buckets) {
    const pax = bucket.rows.length;
    const vehicle = pickVehicle(pax);

    const dests = new Set(bucket.rows.map((r) => arrivalDestination(r, ctx)));
    const destination =
      dests.size === 1 ? [...dests][0] : [...dests].join(" + ");

    const consolidationNote = consolidationRemark(bucket);
    const sameFlight =
      bucket.rows.length > 1 &&
      new Set(bucket.rows.map((r) => r.flight_number)).size === 1;
    const paxLabel = sameFlight ? `${pax} pax, same flight` : `${pax} pax`;
    const remark = consolidationNote
      ? `${consolidationNote} · ${paxLabel}`
      : paxLabel;

    groups.push({
      group_no: 0,
      direction: "arrival",
      vehicle_type: vehicle.type,
      landing_or_takeoff_at: bucket.latest_at,
      terminal: collapseTerminals(bucket.rows),
      destination,
      remark,
      vip: false,
      flight_info_ids: bucket.rows.map((r) => r.flight_info_id),
      passengers: bucket.rows,
    });
  }

  // Sort merged set by pickup time, assign sequential group_no.
  groups.sort((a, b) => {
    const ta = new Date(a.landing_or_takeoff_at).getTime();
    const tb = new Date(b.landing_or_takeoff_at).getTime();
    if (ta !== tb) return ta - tb;
    return a.flight_info_ids[0].localeCompare(b.flight_info_ids[0]);
  });
  groups.forEach((g, i) => {
    g.group_no = i + 1;
  });

  return groups;
}
