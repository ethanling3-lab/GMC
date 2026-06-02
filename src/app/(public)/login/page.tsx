import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = {
  title: "Sign in · 登录 — GMC",
  robots: { index: false, follow: false },
};

type PageProps = {
  searchParams: Promise<{ next?: string; reason?: string }>;
};

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: PageProps) {
  const { next, reason } = await searchParams;

  // If already signed in + linked to a participants row, send to /me.
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    // Service-role read — participants SELECT is admin-only via RLS.
    const service = createSupabaseServiceClient();
    const { data: participant } = await service
      .from("participants")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (participant) {
      redirect(next ?? "/me");
    }
  }

  const reasonCopy =
    reason === "no_participant"
      ? "Your account isn't linked to a student record yet. Use Set up account below to claim your record."
      : reason === "not_linked"
        ? "Your account isn't linked yet. Use Set up account below."
        : null;

  return (
    <section className="min-h-[calc(100dvh-200px)] flex items-center justify-center px-6 py-16 md:py-24">
      <div className="w-full max-w-[420px]">
        <div className="text-[11px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
          — Sign in · 登录
        </div>
        <h1 className="mt-5 font-display text-[36px] md:text-[40px] leading-[1.05] tracking-[-0.015em] text-[var(--ink)]">
          Welcome back.
          <br />
          <span className="text-[var(--ink-soft)]">欢迎回来。</span>
        </h1>
        <p className="mt-4 text-[14px] leading-[1.7] text-[var(--ink-mute)] max-w-[44ch]">
          Use your email and password. First time here? Switch to{" "}
          <span className="text-[var(--cinnabar-deep)]">Set up account</span> below — you&apos;ll
          get a link to set your password.
        </p>

        {reasonCopy ? (
          <div
            role="alert"
            className="mt-8 rounded-[var(--radius-md)] border border-[var(--cinnabar)]/30 bg-[var(--cinnabar-wash)] px-4 py-3 text-[13px] leading-[1.55] text-[var(--cinnabar-deep)]"
          >
            {reasonCopy}
          </div>
        ) : null}

        <div className="mt-10">
          <LoginForm nextPath={next ?? "/me"} />
        </div>

        <div className="mt-10 pt-7 border-t border-[var(--paper-shadow)] flex items-center justify-between text-[11px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
          <Link
            href="/forgot-password"
            className="text-[var(--ink-mute)] hover:text-[var(--cinnabar)] transition-colors"
            style={{ color: "var(--ink-mute)" }}
          >
            Forgot password · 忘记密码
          </Link>
          <Link
            href="/"
            className="text-[var(--ink-mute)] hover:text-[var(--cinnabar)] transition-colors"
            style={{ color: "var(--ink-mute)" }}
          >
            ← Home
          </Link>
        </div>
      </div>
    </section>
  );
}
