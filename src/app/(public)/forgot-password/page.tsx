import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const metadata: Metadata = {
  title: "Forgot password · 忘记密码 — GMC",
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return (
    <section className="min-h-[calc(100dvh-200px)] flex items-center justify-center px-6 py-16 md:py-24">
      <div className="w-full max-w-[420px]">
        <div className="text-[11px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
          — Reset · 重置
        </div>
        <h1 className="mt-5 font-display text-[36px] md:text-[40px] leading-[1.05] tracking-[-0.015em] text-[var(--ink)]">
          Reset your password.
          <br />
          <span className="text-[var(--ink-soft)]">重置密码。</span>
        </h1>
        <p className="mt-4 text-[14px] leading-[1.7] text-[var(--ink-mute)] max-w-[44ch]">
          Enter your email; we&apos;ll send you a link to set a new password.
        </p>

        <div className="mt-10">
          <ForgotPasswordForm />
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
