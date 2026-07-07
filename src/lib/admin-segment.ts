// Derive the active admin-nav segment from a pathname string.
//
// This mirrors what `useSelectedLayoutSegment()` returns when called from the
// `admin/(protected)` layout — the segment one level below `/admin`:
//   /admin                  -> null
//   /admin/participants      -> "participants"
//   /admin/participants/123  -> "participants"
//   /admin/inbox/abc         -> "inbox"
//
// We compute it ourselves from the request pathname (supplied server-side via
// the `x-pathname` middleware header) so that SSR and the first client render
// agree without depending on the hook's SSR behaviour, which is unreliable in
// this Next build (it resolves to `null` during SSR, then the real segment on
// the client → an `aria-current` hydration mismatch on every active nav link).
export function adminSegmentFromPathname(
  pathname: string | null | undefined,
): string | null {
  if (!pathname || !pathname.startsWith("/admin")) return null;
  const rest = pathname.slice("/admin".length);
  // Must be exactly "/admin" or "/admin/<...>" — guards against e.g. "/administration".
  if (rest === "" || rest === "/") return null;
  if (!rest.startsWith("/")) return null;
  return rest.split("/").filter(Boolean)[0] ?? null;
}
