// Departure list builder.
//
// Rules (Skills/airport-transfer-list.md):
//   * Departures from main venue hotel, except "Other hotel" guests when the
//     list is set to collect them: own vehicle(s) per hotel, on the lead-time
//     rule, never the shared coach.
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
import { sortByScheduled, consolidate, consolidationRemark, splitBucket } from "./consolidate";
import { departurePickup, ownHotelPickup } from "./routing";
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
  coachRuleEnabled: boolean,
): Category {
  if (!departureDay) return "before"; // standard 3-hour rule when no departure day declared
  const flightDate = dateLocalFromIso(row.scheduled_at);
  if (flightDate < departureDay) return "before";
  if (flightDate > departureDay) return "after";
  // On the departure day with coach rule disabled, every flight uses the
  // 3-hour rule regardless of takeoff time.
  if (!coachRuleEnabled) return "before";
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
        destination: ownHotelPickup(v, rules) ?? pickup,
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
  const ownHotels = new Map<string, { name: string; rows: FlightRow[] }>();
  for (const r of sortByScheduled(rest)) {
    const own = ownHotelPickup(r, rules);
    if (own) {
      const key = own.toLowerCase();
      const hotel = ownHotels.get(key) ?? { name: own, rows: [] };
      hotel.rows.push(r);
      ownHotels.set(key, hotel);
      continue;
    }
    const c = categorize(
      r,
      ctx.departure_day,
      rules.coach_cutoff_hour_local,
      rules.coach_rule_enabled,
    );
    if (c === "before") before.push(r);
    else if (c === "coach_day") coachDay.push(r);
    else after.push(r);
  }

  // 3-hour-rule buckets (early leavers + departure-day pre-15:00).
  const beforeBuckets = consolidate(before, rules.consolidation_window_minutes)
    .flatMap((b) => splitBucket(b, rules.oversize_strategy));
  for (const bucket of beforeBuckets) {
    const pax = bucket.rows.length;
    const vehicle = bucket.vehicle;
    const hotelDeparture = subtractHoursIso(
      bucket.earliest_at,
      rules.departure_lead_hours,
    );
    const remark = [consolidationRemark(bucket), `${pax} pax`, bucket.part]
      .filter(Boolean)
      .join(" · ");
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

  // "Other hotel" guests, collected from their own hotel.
  for (const hotel of ownHotels.values()) {
    const buckets = consolidate(hotel.rows, rules.consolidation_window_minutes)
      .flatMap((b) => splitBucket(b, rules.oversize_strategy));
    for (const bucket of buckets) {
      groups.push({
        group_no: 0,
        direction: "departure",
        vehicle_type: bucket.vehicle.type,
        landing_or_takeoff_at: subtractHoursIso(
          bucket.earliest_at,
          rules.departure_lead_hours,
        ),
        terminal: collapseTerminals(bucket.rows),
        destination: hotel.name,
        remark: [
          consolidationRemark(bucket),
          `${bucket.rows.length} pax`,
          "pickup from own hotel",
          bucket.part,
        ]
          .filter(Boolean)
          .join(" · "),
        vip: false,
        flight_info_ids: bucket.rows.map((r) => r.flight_info_id),
        passengers: bucket.rows,
      });
    }
  }

  // Departure-day coach (≥15:00). One pickup time, as many vehicles as the
  // group needs under the chosen over-14 option.
  if (coachDay.length > 0 && ctx.departure_day) {
    const coachAt = composeLocalIso(
      ctx.departure_day,
      rules.coach_hotel_departure_local,
    );
    const coachBuckets = splitBucket(
      {
        rows: coachDay,
        earliest_at: coachDay[0].scheduled_at,
        latest_at: coachDay[coachDay.length - 1].scheduled_at,
      },
      rules.oversize_strategy,
    );
    for (const bucket of coachBuckets) {
      const base = `Coach ${rules.coach_hotel_departure_local} (${bucket.rows.length} pax) · departure-day ≥${rules.coach_cutoff_hour_local}:00`;
      groups.push({
        group_no: 0,
        direction: "departure",
        vehicle_type: bucket.vehicle.type,
        landing_or_takeoff_at: coachAt,
        terminal: collapseTerminals(bucket.rows),
        destination: pickup,
        remark: bucket.part ? `${base} · ${bucket.part}` : base,
        vip: false,
        flight_info_ids: bucket.rows.map((r) => r.flight_info_id),
        passengers: bucket.rows,
      });
    }
  }

  // Late-leavers — behavior depends on coach_rule_enabled:
  //   * Coach enabled — each gets its own row, riding the departure-day 12:00
  //     coach. landing_or_takeoff_at = departure-day 12:00 so logistics see
  //     the pickup slot; underlying flight date is preserved via flight_info_ids
  //     for the Sheet renderer to read into the 日期 column.
  //   * Coach disabled — late-leavers fall into the regular 30-min + 3-hour
  //     consolidation pool against their actual flight time, as if they were
  //     "before" the departure day.
  if (after.length > 0) {
    if (rules.coach_rule_enabled && ctx.departure_day) {
      const coachAt = composeLocalIso(
        ctx.departure_day,
        rules.coach_hotel_departure_local,
      );
      for (const r of after) {
        groups.push({
          group_no: 0,
          direction: "departure",
          vehicle_type: "Joining departure-day coach",
          landing_or_takeoff_at: coachAt,
          terminal: r.terminal,
          destination: pickup,
          remark: `Last batch — joining ${ctx.departure_day} ${rules.coach_hotel_departure_local} coach · ${formatFlightInfo(r)} on ${dateLocalFromIso(r.scheduled_at)}`,
          vip: false,
          flight_info_ids: [r.flight_info_id],
          passengers: [r],
        });
      }
    } else {
      const afterBuckets = consolidate(after, rules.consolidation_window_minutes)
        .flatMap((b) => splitBucket(b, rules.oversize_strategy));
      for (const bucket of afterBuckets) {
        const pax = bucket.rows.length;
        const vehicle = bucket.vehicle;
        const hotelDeparture = subtractHoursIso(
          bucket.earliest_at,
          rules.departure_lead_hours,
        );
        const remark = [
          consolidationRemark(bucket),
          `${pax} pax (after dep. day)`,
          bucket.part,
        ]
          .filter(Boolean)
          .join(" · ");
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
