// Client-safe types for inbox saved views. Split from `saved-views.ts`
// (server-only) so the sidebar + ActiveFilterStrip can import freely.
// Same pattern as tags-types.ts and snippets-types.ts.

import type { InboxListFilters } from "./inbox-query";

/** The serialized filter shape stored in `inbox_saved_views.filters`.
 *  Mirror of InboxListFilters minus `admin_id` (caller identity, not a
 *  filter) — what the URL preserves between page loads. */
export type SavedViewFilters = Omit<InboxListFilters, "admin_id">;

export type SavedView = {
  id: string;
  name: string;
  filters: SavedViewFilters;
  created_at: string;
  updated_at: string;
};

export const SAVED_VIEW_NAME_MIN = 1;
export const SAVED_VIEW_NAME_MAX = 60;

export function validateSavedViewName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length < SAVED_VIEW_NAME_MIN) return "Name is required.";
  if (trimmed.length > SAVED_VIEW_NAME_MAX) {
    return `Name must be ${SAVED_VIEW_NAME_MAX} characters or fewer.`;
  }
  return null;
}

/** True when at least one filter dimension is non-default — i.e. there's
 *  something worth saving. Used by the "+ Save view" trigger to decide
 *  whether to render. */
export function hasActiveFilters(f: SavedViewFilters): boolean {
  return (
    f.scope !== "mine" ||
    f.channel !== null ||
    f.status !== null ||
    f.lifecycle !== null ||
    f.tag !== null ||
    f.q.length > 0
  );
}

/** Build the /admin/inbox URL that re-applies a saved view's filters.
 *  Mirrors the makeHref() pattern in ConversationListView.tsx so the
 *  sidebar's saved-view links land on the same canonical href. */
export function savedViewHref(f: SavedViewFilters): string {
  const params = new URLSearchParams();
  if (f.scope !== "mine") params.set("scope", f.scope);
  if (f.channel) params.set("channel", f.channel);
  if (f.status) params.set("status", f.status);
  if (f.lifecycle) params.set("lifecycle", f.lifecycle);
  if (f.tag) params.set("tag", f.tag);
  if (f.q) params.set("q", f.q);
  const qs = params.toString();
  return qs ? `/admin/inbox?${qs}` : "/admin/inbox";
}
