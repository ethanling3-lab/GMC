// Keeps staff decisions across a Regenerate. An edited row stays as it is,
// except passengers who cancelled or whose flight changed since the last
// generate: they're released so the generator can place them correctly.

import type { TransferGroup } from "./types";

export type EditedRow = {
  vehicle_type: string | null;
  landing_or_takeoff_at: string | null;
  terminal: string | null;
  destination: string | null;
  remark: string | null;
  vip: boolean;
  flight_info_ids: string[];
  manual_passengers: unknown[];
};

export type SavedRow = EditedRow & { group_no: number; admin_edited: boolean };

export function keepEditedRows(
  edited: EditedRow[],
  flights: { flight_info_id: string; updated_at?: string }[],
  generatedAt: string | null,
  // Flights that changed in a way that doesn't affect their seat.
  keepIds: ReadonlySet<string> = new Set(),
): { kept: EditedRow[]; keptFlightIds: Set<string> } {
  const current = new Map(flights.map((f) => [f.flight_info_id, f]));
  const cutoff = generatedAt ? new Date(generatedAt).getTime() : Infinity;
  const unchanged = (id: string) => {
    const f = current.get(id);
    if (!f) return false;
    if (keepIds.has(id)) return true;
    return !f.updated_at || new Date(f.updated_at).getTime() <= cutoff;
  };

  const kept: EditedRow[] = [];
  const keptFlightIds = new Set<string>();
  for (const row of edited) {
    const ids = (row.flight_info_ids ?? []).filter(unchanged);
    const manual = row.manual_passengers ?? [];
    if (ids.length === 0 && manual.length === 0) continue;
    const released = (row.flight_info_ids ?? []).length - ids.length;
    const note =
      released > 0
        ? `${released} passenger${released === 1 ? "" : "s"} changed since last generate`
        : null;
    ids.forEach((id) => keptFlightIds.add(id));
    kept.push({
      ...row,
      flight_info_ids: ids,
      manual_passengers: manual,
      remark: [row.remark, note].filter(Boolean).join(" · ") || null,
    });
  }
  return { kept, keptFlightIds };
}

export function mergeRows(kept: EditedRow[], groups: TransferGroup[]): SavedRow[] {
  const rows = [
    ...kept.map((r) => ({ ...r, admin_edited: true })),
    ...groups.map((g) => ({
      vehicle_type: g.vehicle_type,
      landing_or_takeoff_at: g.landing_or_takeoff_at,
      terminal: g.terminal,
      destination: g.destination,
      remark: g.remark,
      vip: g.vip,
      flight_info_ids: g.flight_info_ids,
      manual_passengers: [] as unknown[],
      admin_edited: false,
    })),
  ];
  const time = (r: EditedRow) =>
    r.landing_or_takeoff_at ? new Date(r.landing_or_takeoff_at).getTime() : Infinity;
  rows.sort((a, b) => time(a) - time(b));
  return rows.map((r, i) => ({ ...r, group_no: i + 1 }));
}
