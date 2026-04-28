// Serialize a TransferDetailDirection (loaded view from transfer-query) into
// the bilingual 2-D Sheet matrix the export module writes verbatim.
//
// Columns mirror Skills/airport-transfer-list.md exactly so the export
// matches what logistics expects on the manual sheet.

import type {
  TransferDetailDirection,
  TransferDetailRow,
  TransferRowFlight,
} from "./transfer-query";
import { iataToCity } from "./format";

const ARRIVAL_HEADERS = [
  "序号\nNo.",
  "日期\nDate",
  "落地时间\nLanding",
  "航站\nTerminal",
  "姓名\nName (CN)",
  "姓名（英）\nName (EN)",
  "地区\nRegion",
  "航班信息\nFlight",
  "车辆信息\nVehicle",
  "目的地\nDestination",
  "PIC",
  "Remark",
  "Driver Details",
  "Status/Remark",
  "Retail",
];

const DEPARTURE_HEADERS = [
  "序号\nNo.",
  "日期\nDate",
  "姓名\nName (CN)",
  "姓名（英）\nName (EN)",
  "地区\nRegion",
  "出发地点\nPickup",
  "航班信息\nFlight",
  "起飞时间\nTakeoff",
  "出发时间\nHotel dep.",
  "航站\nTerminal",
  "车辆信息\nVehicle",
  "Driver Details",
  "Status/Add on",
  "Remark",
  "Price",
];

export function serializeArrivals(dir: TransferDetailDirection): string[][] {
  const rows: string[][] = [ARRIVAL_HEADERS];
  let serial = 0;
  for (const r of dir.rows) {
    if (r.flights.length === 0) {
      // Group with no flights — render a placeholder row so it's still visible
      serial += 1;
      rows.push([
        String(serial),
        "",
        r.landing_or_takeoff_at ? formatDay(r.landing_or_takeoff_at) : "",
        r.terminal ?? "",
        "",
        "",
        "",
        "",
        r.vehicle_type ?? "",
        r.destination ?? "",
        "",
        r.remark ?? "",
        "",
        "",
        "",
      ]);
      continue;
    }
    for (let i = 0; i < r.flights.length; i++) {
      serial += 1;
      const f = r.flights[i];
      const isFirst = i === 0;
      rows.push([
        String(serial),
        formatDay(f.scheduled_at ?? r.landing_or_takeoff_at),
        formatHHMM(r.landing_or_takeoff_at),
        r.terminal ?? f.terminal ?? "",
        f.participant?.name_cn ?? "",
        f.participant?.name_en ?? "",
        f.participant?.region ?? "",
        formatFlight(f),
        isFirst ? r.vehicle_type ?? "" : "",
        isFirst ? r.destination ?? "" : "",
        "",
        isFirst ? r.remark ?? "" : "",
        "",
        "",
        "",
      ]);
    }
  }
  return rows;
}

export function serializeDepartures(dir: TransferDetailDirection): string[][] {
  const rows: string[][] = [DEPARTURE_HEADERS];
  let serial = 0;
  for (const r of dir.rows) {
    if (r.flights.length === 0) {
      serial += 1;
      rows.push([
        String(serial),
        "",
        "",
        "",
        "",
        r.destination ?? "",
        "",
        "",
        r.landing_or_takeoff_at ? formatHHMM(r.landing_or_takeoff_at) : "",
        r.terminal ?? "",
        r.vehicle_type ?? "",
        "",
        "",
        r.remark ?? "",
        "",
      ]);
      continue;
    }
    for (let i = 0; i < r.flights.length; i++) {
      serial += 1;
      const f = r.flights[i];
      const isFirst = i === 0;
      rows.push([
        String(serial),
        // Departure rows show the actual flight date (not the hotel-departure
        // date) — late-leavers ride the departure-day coach but keep their
        // real flight date here per spec.
        formatDay(f.scheduled_at ?? r.landing_or_takeoff_at),
        f.participant?.name_cn ?? "",
        f.participant?.name_en ?? "",
        f.participant?.region ?? "",
        isFirst ? r.destination ?? "" : "",
        formatFlight(f),
        f.scheduled_at ? formatHHMM(f.scheduled_at) : "",
        formatHHMM(r.landing_or_takeoff_at),
        r.terminal ?? f.terminal ?? "",
        isFirst ? r.vehicle_type ?? "" : "",
        "",
        "",
        isFirst ? r.remark ?? "" : "",
        "",
      ]);
    }
  }
  return rows;
}

function formatFlight(f: TransferRowFlight): string {
  const fn = f.flight_number ?? "????";
  const o = iataToCity(f.origin_airport);
  const d = iataToCity(f.destination_airport);
  const t = f.scheduled_at ? formatHHMM(f.scheduled_at) : "????";
  return `${fn} ${o}-${d} ${t}`;
}

function formatDay(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const day = String(d.getUTCDate()).padStart(2, "0");
  const mon = d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  return `${day} ${mon}`;
}

function formatHHMM(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
