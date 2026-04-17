import type { Metadata } from "next";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = {
  title: "Admin — GMC",
  robots: { index: false, follow: false },
};

type PageProps = {
  searchParams: Promise<{ next?: string; reason?: string }>;
};

export default async function AdminLoginPage({ searchParams }: PageProps) {
  const { next, reason } = await searchParams;

  const reasonCopy =
    reason === "not_admin"
      ? "That account isn't registered as an admin."
      : null;

  return (
    <div className="min-h-[100dvh] flex items-center justify-center px-6 py-16 bg-[var(--paper)]">
      <div className="w-full max-w-[420px]">
        <div className="text-center mb-10">
          <div className="text-[11px] tracking-[0.28em] uppercase text-[var(--ink-mute)] mb-4">
            GMC · Administration
          </div>
          <h1 className="font-display text-[44px] leading-[1.05] text-[var(--ink)]">
            Sign in
          </h1>
          <p className="mt-3 text-[14px] leading-[1.6] text-[var(--ink-mute)]">
            Internal access only.
          </p>
        </div>

        {reasonCopy ? (
          <div className="mb-6 border border-[var(--paper-shadow)] bg-[var(--cinnabar-wash)] px-4 py-3 text-[13px] text-[var(--cinnabar-deep)]">
            {reasonCopy}
          </div>
        ) : null}

        <LoginForm nextPath={next ?? "/admin"} />

        <p className="mt-8 text-center text-[11px] tracking-[0.18em] uppercase text-[var(--ink-faint)]">
          Unauthorized access is prohibited.
        </p>
      </div>
    </div>
  );
}
