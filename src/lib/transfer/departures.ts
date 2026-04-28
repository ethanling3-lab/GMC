// Departure list builder.
//
// Rules (Skills/airport-transfer-list.md):
//   * All departures from main venue hotel.
//   * 3-hour rule: hotel departure = flight time − 3h. Applies to:
//       - All flights BEFORE 15:00 on departure day
//       - All flights on non-departure days (before departure day)
//   * Coach rule: flights ≥15:00 ON the departure day → single coach group,
//     hotel departure 12:00, vehicle sized by total pax.
//   * Flights AFTER departure day → no separate transfer; piggy-back the
//     12:00 coach on departure day. Each gets its own row, with the actual
//     flight date in 日期 (Sheet renderer reads from flight_info), pickup
//     time = 12:00.
//   * Within each timing bucket: 30-min consolidation, pickup = (earliest
//     flight − 3h).
//   * VIPs always private (Luxury MPV), 3-hour rule, never combined.
//   * Sort ascending by hotel-departure time, with late-leavers sorted by
//     their actual flight time.

import type { EventContext, FlightRow, GeneratorRules, TransferGroup } from "./types";
import { partitionVip, buildVipGroup } from "./vip";
import { sortByScheduled, consolidate, consolidationRemark } from "./consolidate";
import { pickVehicle } from "./vehicles";
import { departurePickup } from "./routing";
import { formatFlightInfo } from "./format";
import {
  collapseTerminals,
  composeLocalIso,
  dateLocalFromIso,
  hourLocalFromIso,
  subtractHoursIso,
} from "./time";

type Category = "before" | "coach_day" | "after";

function categorize(
  row: FlightRow,
  departureDay: string | null,
  coachCutoffHour: number,
): Category {
  if (!departureDay) return "before"; // standard 3-hour rule when no departure day declared
  const flightDate = dateLocalFromIso(row.scheduled_at);
  if (flightDate < departureDay) return "before";
  if (flightDate > departureDay) return "after";
  return hourLocalFromIso(row.scheduled_at) < coachCutoffHour ? "before" : "coach_day";
}

export function buildDepartures(
  flights: FlightRow[],
  ctx: EventContext,
  rules: GeneratorRules,
): TransferGroup[] {
  const { vips, rest } = partitionVip(flights);
  const pickup = departurePickup(ctx);
  const groups: TransferGroup[] = [];

  // VIPs — private MPV, always 3-hour rule (ignore coach rule per spec).
  for (const v of sortByScheduled(vips)) {
    const hotelDeparture = subtractHoursIso(
      v.scheduled_at,
      rules.departure_lead_hours,
    );
    groups.push({
      ...buildVipGroup({
        pax: v,
        direction: "departure",
        scheduled_at: hotelDeparture,
        destination: pickup,
        terminal: v.terminal,
        remarkExtra: `Flight ${formatFlightInfo(v)}`,
      }),
      group_no: 0,
    });
  }

  // Non-VIPs split into the three buckets.
  const before: FlightRow[] = [];
  const coachDay: FlightRow[] = [];
  const after: FlightRow[] = [];
  for (const r of sortByScheduled(rest)) {
    const c = categorize(r, ctx.departure_day, rules.coach_cutoff_hour_local);
    if (c === "before") before.push(r);
    else if (c === "coach_day") coachDay.push(r);
    else after.push(r);
  }

  // 3-hour-rule buckets (early leavers + departure-day pre-15:00).
  for (const bucket of consolidate(before, rules.consolidation_window_minutes)) {
    const pax = bucket.rows.length;
    const vehicle = pickVehicle(pax);
    const hotelDeparture = subtractHoursIso(
      bucket.earliest_at,
      rules.departure_lead_hours,
    );
    const consolidationNote = consolidationRemark(bucket);
    const remark = consolidationNote
      ? `${consolidationNote} · ${pax} pax`
      : `${pax} pax`;
    groups.push({
      group_no: 0,
      direction: "departure",
      vehicle_type: vehicle.type,
      landing_or_takeoff_at: hotelDeparture,
      terminal: collapseTerminals(bucket.rows),
      destination: pickup,
      remark,
      vip: false,
      flight_info_ids: bucket.rows.map((r) => r.flight_info_id),
      passengers: bucket.rows,
    });
  }

  // Departure-day coach (≥15:00). Single row regardless of pax — vehicle
  // sized by combined pax count per spec line 188.
  if (coachDay.length > 0 && ctx.departure_day) {
    const coachAt = composeLocalIso(
      ctx.departure_day,
      rules.coach_hotel_departure_local,
    );
    const pax = coachDay.length;
    const vehicle = pickVehicle(pax);
    groups.push({
      group_no: 0,
      direction: "departure",
      vehicle_type: vehicle.type,
      landing_or_takeoff_at: coachAt,
      terminal: collapseTerminals(coachDay),
      destination: pickup,
      remark: `Coach ${rules.coach_hotel_departure_local} (${pax} pax) · departure-day ≥${rules.coach_cutoff_hour_local}:00`,
      vip: false,
      flight_info_ids: coachDay.map((r) => r.flight_info_id),
      passengers: coachDay,
    });
  }

  // Late-leavers — each gets its own row, joining the departure-day coach.
  // landing_or_takeoff_at = departure-day 12:00 so logistics see the pickup
  // slot; the underlying flight date is preserved via flight_info_ids[] for
  // the Sheet renderer to read into the 日期 column.
  if (after.length > 0 && ctx.departure_day) {
    const coachAt = composeLocalIso(
      ctx.departure_day,
      rules.coach_hotel_departure_local,
    );
    for (const r of after) {
      groups.push({
        group_no: 0,
        direction: "departure",
        vehicle_type: `Van (18-seater) — joining departure-day coach`,
        landing_or_takeoff_at: coachAt,
        terminal: r.terminal,
        destination: pickup,
        remark: `Last batch — joining ${ctx.departure_day} ${rules.coach_hotel_departure_local} coach · ${formatFlightInfo(r)} on ${dateLocalFromIso(r.scheduled_at)}`,
        vip: false,
        flight_info_ids: [r.flight_info_id],
        passengers: [r],
      });
    }
  }

  // Sort by hotel-departure time. Tie-break on underlying flight scheduled_at
  // so late-leavers (all sharing the same coach time) order by their real
  // flight date.
  groups.sort((a, b) => {
    const ta = new Date(a.landing_or_takeoff_at).getTime();
    const tb = new Date(b.landing_or_takeoff_at).getTime();
    if (ta !== tb) return ta - tb;
    const fa = a.passengers[0]?.scheduled_at ?? "";
    const fb = b.passengers[0]?.scheduled_at ?? "";
    return fa.localeCompare(fb);
  });
  groups.forEach((g, i) => {
    g.group_no = i + 1;
  });

  return groups;
}
