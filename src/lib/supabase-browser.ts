import { createBrowserClient } from "@supabase/ssr";

// Browser-side Supabase client. Kept in its own module with NO server imports,
// deliberately.
//
// This used to live in src/lib/supabase.ts alongside createSupabaseServerClient
// and createSupabaseServiceClient — and that file imports `cookies` from
// "next/headers" at module scope. Any client component importing the browser
// factory from there pulled next/headers into the client graph and failed the
// production build. `next dev` and `tsc --noEmit` both stay silent about it, so
// the failure only ever appeared at `next build`.
//
// Evidence someone already ran into it: SetPasswordForm.tsx imported
// createBrowserClient straight from @supabase/ssr rather than use the helper.
// That workaround is now pointed here, so there is exactly one browser factory.
//
// Rule of thumb: if a module is reachable from a "use client" component, it
// must not import next/headers, next/cache, or anything marked "server-only",
// however indirectly.
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
