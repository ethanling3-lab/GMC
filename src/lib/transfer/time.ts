// Tiny time helpers for the transfer-list generator.
//
// Admins enter scheduled times in airport-local clock-face values via the
// inbox panel. We store them as ISO timestamptz, but the UTC components of
// that timestamp ARE the airport-local clock face (i.e. we don't try to
// resolve a real timezone — we just round-trip the entered values). All
// comparisons here use UTC components for consistency with format.ts.

// 'YYYY-MM-DD' from an ISO timestamp, using its UTC components.
export function dateLocalFromIso(iso: string): string {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function hourLocalFromIso(iso: string): number {
  return new Date(iso).getUTCHours();
}

export function subtractHoursIso(iso: string, hours: number): string {
  const d = new Date(iso);
  d.setUTCHours(d.getUTCHours() - hours);
  return d.toISOString();
}

// Compose 'YYYY-MM-DD' + 'HH:MM' into an ISO timestamp whose UTC components
// represent that local clock face.
export function composeLocalIso(date: string, hhmm: string): string {
  const [h, m] = hhmm.split(":");
  return `${date}T${h.padStart(2, "0")}:${(m ?? "00").padStart(2, "0")}:00.000Z`;
}

// Collapse terminals across rows: null if none, single value if all match,
// "T1 / T2" if mixed.
export function collapseTerminals(rows: { terminal: string | null }[]): string | null {
  const set = new Set<string>();
  for (const r of rows) {
    if (r.terminal) set.add(r.terminal);
  }
  if (set.size === 0) return null;
  if (set.size === 1) return [...set][0];
  return [...set].sort().join(" / ");
}
