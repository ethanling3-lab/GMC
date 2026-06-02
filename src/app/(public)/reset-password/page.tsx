import type { Metadata } from "next";
import Link from "next/link";
import { SetPasswordForm } from "./SetPasswordForm";

export const metadata: Metadata = {
  title: "Set new password · 设置新密码 — GMC",
  robots: { index: false, follow: false },
};

// /reset-password — landing page after the user clicks the password-reset
// link in their email. The Supabase Auth recovery flow lands them here
// with a session already attached (the token in the URL fragment is
// consumed by the supabase-js client on hydration). We just need to let
// them set a new password.

export default function ResetPasswordPage() {
  return (
    <section className="min-h-[calc(100dvh-200px)] flex items-center justify-center px-6 py-16 md:py-24">
      <div className="w-full max-w-[420px]">
        <div className="text-[11px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
          — New password · 新密码
        </div>
        <h1 className="mt-5 font-display text-[36px] md:text-[40px] leading-[1.05] tracking-[-0.015em] text-[var(--ink)]">
          Set a new password.
          <br />
          <span className="text-[var(--ink-soft)]">设置新密码。</span>
        </h1>
        <p className="mt-4 text-[14px] leading-[1.7] text-[var(--ink-mute)] max-w-[44ch]">
          Pick something you&apos;ll remember. 8+ characters; special characters
          are welcome.
        </p>

        <div className="mt-10">
          <SetPasswordForm redirectTo="/me" />
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
