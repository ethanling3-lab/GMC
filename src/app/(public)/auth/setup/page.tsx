import type { Metadata } from "next";
import Link from "next/link";
import { PasswordSetupForm } from "@/components/auth/PasswordSetupForm";

export const metadata: Metadata = {
  title: "Set your password · 设置密码 — GMC Staff",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ token?: string; type?: string }>;
};

export default async function StaffSetupPage({ searchParams }: PageProps) {
  const { token, type } = await searchParams;
  const valid = Boolean(token) && (type === "invite" || type === "recovery");

  return (
    <section className="min-h-[calc(100dvh-200px)] flex items-center justify-center px-6 py-16 md:py-24">
      <div className="w-full max-w-[420px]">
        <h1 className="font-display text-[36px] md:text-[40px] leading-[1.05] tracking-[-0.015em] text-[var(--ink)]">
          {valid ? "Set your password." : "This link isn't valid."}
          <br />
          <span className="text-[var(--ink-soft)]">
            {valid ? "设置您的密码。" : "此链接无效。"}
          </span>
        </h1>
        <p className="mt-4 text-[14px] leading-[1.7] text-[var(--ink-mute)] max-w-[44ch]">
          {valid
            ? "Choose a password for your GMC staff account. Use at least 8 characters. 请设置至少 8 个字符的密码。"
            : "Ask your admin to send a new link. 请向管理员索取新链接。"}
        </p>
        {valid ? (
          <div className="mt-10">
            <PasswordSetupForm
              token={token as string}
              type={type as "invite" | "recovery"}
              endpoint="/api/auth/staff-setup"
            />
          </div>
        ) : null}
        <div className="mt-10 pt-7 border-t border-[var(--paper-shadow)] text-[13px]">
          <Link
            href="/admin/login"
            className="text-[var(--ink-mute)] hover:text-[var(--cinnabar)] transition-colors"
            style={{ color: "var(--ink-mute)" }}
          >
            Go to staff sign-in · 员工登录
          </Link>
        </div>
      </div>
    </section>
  );
}
