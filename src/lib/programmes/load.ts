import "server-only";
import { cache } from "react";
import { listProgrammes } from "./programmes";
import type { Programme } from "./types";

// Per-request cached loaders for the dynamic programmes list. Server pages
// call these and pass the result into client components as props (client
// components can't query Supabase directly). `cache` dedupes within a single
// request so multiple readers on one page share one query.

export const loadActiveProgrammes = cache(async (): Promise<Programme[]> => {
  return listProgrammes({ includeInactive: false });
});

// Includes inactive so a slug referenced by old data (e.g. an event price
// tier or a participant whose programme was since deactivated) still resolves
// to a label.
export const loadProgrammeMap = cache(async (): Promise<Map<string, Programme>> => {
  const all = await listProgrammes({ includeInactive: true });
  return new Map(all.map((p) => [p.slug, p]));
});
