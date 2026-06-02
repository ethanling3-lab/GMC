import type { Metadata } from "next";
import Link from "next/link";
import { SetPasswordForm } from "../../reset-password/SetPasswordForm";

export const metadata: Metadata = {
  title: "Set up your account · 设置账户 — GMC",
  robots: { index: false, follow: false },
};

// /auth/callback — handles BOTH the invite-acceptance flow (claim=1) AND
// the password-recovery flow. The Supabase Auth invite/recovery flow
// lands the user here with a session already established (the token in
// the URL fragment is consumed by supabase-js on hydration).
//
// For the claim path (?claim=1), after the password is set we also POST
// to /api/auth/participant/claim-complete to link participants.auth_user_id
// to auth.uid().

type PageProps = {
  searchParams: Promise<{ claim?: string }>;
};

export default async function AuthCallbackPage({ searchParams }: PageProps) {
  const { claim } = await searchParams;
  const isClaim = claim === "1";

  return (
    <section className="min-h-[calc(100dvh-200px)] flex items-center justify-center px-6 py-16 md:py-24">
      <div className="w-full max-w-[420px]">
        <div className="text-[11px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
          {isClaim ? "— Welcome · 欢迎" : "— New password · 新密码"}
        </div>
        <h1 className="mt-5 font-display text-[36px] md:text-[40px] leading-[1.05] tracking-[-0.015em] text-[var(--ink)]">
          {isClaim ? (
            <>
              Set your password.
              <br />
              <span className="text-[var(--ink-soft)]">设置您的密码。</span>
            </>
          ) : (
            <>
              Set a new password.
              <br />
              <span className="text-[var(--ink-soft)]">设置新密码。</span>
            </>
          )}
        </h1>
        <p className="mt-4 text-[14px] leading-[1.7] text-[var(--ink-mute)] max-w-[44ch]">
          {isClaim
            ? "Pick a password and we'll link this to your existing student record."
            : "Pick a password to access your account."}
          {" "}
          <span className="text-[var(--ink-faint)]">8+ characters · 8 个字符以上</span>
        </p>

        <div className="mt-10">
          <SetPasswordForm redirectTo="/me" linkAfter={isClaim} />
        </div>

        <div className="mt-10 pt-7 border-t border-[var(--paper-shadow)] text-[11px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
          <Link
            href="/login"
            className="text-[var(--ink-mute)] hover:text-[var(--cinnabar)] transition-colors"
            style={{ color: "var(--ink-mute)" }}
          >
            ← Back to sign in
          </Link>
        </div>
      </div>
    </section>
  );
}
