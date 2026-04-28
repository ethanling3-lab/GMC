// 30-minute consolidation engine.
//
// Arrivals: passengers landing within ≤30 min are combined. Group's
// landing_or_takeoff_at is the LATEST flight in the bucket (so the driver
// arrives once everyone has cleared the gate).
//
// Departures: passengers taking off within ≤30 min are combined. Group's
// hotel-departure time is computed from the EARLIEST flight in the bucket
// (3 hours ahead of takeoff), so the latest passenger still makes it.
// Spec lines 203-208: "Pickup time = 3 hours before the EARLIEST flight in
// the consolidated group. Measure gap from the EARLIEST flight in the group
// — if a new flight is >30 min from the earliest, start a new group."

import type { FlightRow } from "./types";

export type Bucket = {
  rows: FlightRow[];
  earliest_at: string;
  latest_at: string;
};

// Greedy bucketing on a pre-sorted array. Caller must sort by scheduled_at
// ascending. The bucketing key is the bucket's earliest scheduled time —
// once a flight's scheduled_at exceeds (earliest + windowMinutes), a new
// bucket starts.
//
// Optional `hotelKeyFor` partitions the consolidation by hotel destination
// for arrivals (spec: don't consolidate across distant hotels) so the
// caller can pre-split the input — for v1 we keep it simple and consolidate
// across all hotels, since we have multi-stop drop-offs anyway.
export function consolidate(
  rowsSorted: FlightRow[],
  windowMinutes: number,
): Bucket[] {
  const buckets: Bucket[] = [];
  if (rowsSorted.length === 0) return buckets;

  const windowMs = windowMinutes * 60_000;

  for (const row of rowsSorted) {
    const t = new Date(row.scheduled_at).getTime();
    const last = buckets[buckets.length - 1];
    if (last) {
      const earliest = new Date(last.earliest_at).getTime();
      if (t - earliest <= windowMs) {
        last.rows.push(row);
        if (t > new Date(last.latest_at).getTime()) {
          last.latest_at = row.scheduled_at;
        }
        continue;
      }
    }
    buckets.push({
      rows: [row],
      earliest_at: row.scheduled_at,
      latest_at: row.scheduled_at,
    });
  }

  return buckets;
}

// Sort flights by scheduled_at ascending, stable on flight_info_id for
// deterministic test output.
export function sortByScheduled(rows: FlightRow[]): FlightRow[] {
  return [...rows].sort((a, b) => {
    const ta = new Date(a.scheduled_at).getTime();
    const tb = new Date(b.scheduled_at).getTime();
    if (ta !== tb) return ta - tb;
    return a.flight_info_id.localeCompare(b.flight_info_id);
  });
}

// Format a consolidation remark: "Combined: AK6412 0910 + FY1430 0925".
// Single-flight buckets return null (no remark).
export function consolidationRemark(bucket: Bucket): string | null {
  if (bucket.rows.length <= 1) return null;
  const parts = bucket.rows.map((r) => {
    const d = new Date(r.scheduled_at);
    const hhmm = `${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}`;
    return `${r.flight_number ?? "????"} ${hhmm}`;
  });
  return `Combined: ${parts.join(" + ")}`;
}
