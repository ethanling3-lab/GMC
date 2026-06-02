import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase";

export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Detect participant session so SiteHeader can swap the "Register" CTA
  // for a "Portal · 学员中心" link. Done server-side for SSR — avoids the
  // flicker that a client-side auth check would cause.
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let account: { href: string; isParticipant: boolean } | null = null;
  if (user) {
    const service = createSupabaseServiceClient();
    const { data: p } = await service
      .from("participants")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (p) account = { href: "/me", isParticipant: true };
  }

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-[var(--ink)] focus:text-[var(--paper-warm)]"
      >
        Skip to content
      </a>
      <SiteHeader account={account} />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
