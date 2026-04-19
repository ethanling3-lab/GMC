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
    <div className="min-h-[100dvh] grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] bg-[var(--paper)]">
      {/* Left ornamental panel — shares language with the marketing hero */}
      <aside
        aria-hidden="true"
        data-surface="dark"
        className="relative overflow-hidden hidden lg:flex flex-col justify-between p-12 xl:p-16 text-[var(--paper-warm)]"
        style={{
          background:
            "radial-gradient(900px 540px at 12% 10%, rgba(125,164,244,0.28), transparent 62%)," +
            "radial-gradient(700px 480px at 88% 100%, rgba(37,99,235,0.30), transparent 68%)," +
            "linear-gradient(180deg, #0B2954 0%, #071a3a 100%)",
        }}
      >
        {/* Grain */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.22] mix-blend-overlay"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='260' height='260'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.88' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.055 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
            backgroundSize: "260px 260px",
          }}
        />

        {/* Classical corner ticks — same motif as marketing hero */}
        <span className="pointer-events-none absolute top-8 left-8 w-6 h-6 border-t border-l border-[var(--paper-warm)]/35" />
        <span className="pointer-events-none absolute top-8 right-8 w-6 h-6 border-t border-r border-[var(--paper-warm)]/35" />
        <span className="pointer-events-none absolute bottom-8 left-8 w-6 h-6 border-b border-l border-[var(--paper-warm)]/35" />
        <span className="pointer-events-none absolute bottom-8 right-8 w-6 h-6 border-b border-r border-[var(--paper-warm)]/35" />

        <div className="relative">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center justify-center w-9 h-9 rounded-full border border-[var(--paper-warm)]/40 font-display text-[15px] leading-none">
              G
            </span>
            <span className="text-[11px] tracking-[0.3em] uppercase text-[var(--paper-warm)]/75">
              Glorious Melodies · Administration
            </span>
          </div>
        </div>

        <div className="relative max-w-[520px]">
          <div className="text-[11px] tracking-[0.28em] uppercase text-[var(--cinnabar-soft)]">
            — 学员中心
          </div>
          <h2 className="mt-6 font-display text-[44px] xl:text-[52px] leading-[1.08] tracking-[-0.015em] text-[var(--paper-warm)]">
            The quiet room
            <br />
            behind the stage.
          </h2>
          <p className="mt-7 text-[15px] leading-[1.75] text-[var(--paper-warm)]/75 max-w-[44ch]">
            Where registrations become relationships. Sign in to shepherd students,
            events, travel and broadcasts across the GMC network.
          </p>

          <div className="mt-10 flex items-center gap-4 text-[11px] tracking-[0.22em] uppercase text-[var(--paper-warm)]/55">
            <span className="w-10 h-px bg-current" />
            <span>Internal · secure · bilingual</span>
          </div>
        </div>

        <div className="relative flex items-center justify-between text-[11px] tracking-[0.22em] uppercase text-[var(--paper-warm)]/55">
          <span>Singapore · 新加坡</span>
          <span>© {new Date().getFullYear()} GMC</span>
        </div>
      </aside>

      {/* Right — form panel */}
      <section className="relative flex items-center justify-center px-6 py-16 md:px-12 lg:px-16">
        {/* Compact brand band for mobile / narrow viewports */}
        <div className="absolute top-0 inset-x-0 lg:hidden flex items-center justify-between px-6 py-5 border-b border-[var(--paper-shadow)] bg-[var(--paper-warm)]">
          <span className="inline-flex items-center gap-2 text-[11px] tracking-[0.22em] uppercase text-[var(--ink-mute)]">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-full border border-[var(--paper-shadow)] font-display text-[13px] text-[var(--ink)]">
              G
            </span>
            GMC · Admin
          </span>
        </div>

        <div className="w-full max-w-[400px]">
          <div className="text-[11px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
            — Sign in
          </div>
          <h1 className="mt-5 font-display text-[40px] md:text-[44px] leading-[1.05] tracking-[-0.015em] text-[var(--ink)]">
            Welcome back.
          </h1>
          <p className="mt-4 text-[14px] leading-[1.7] text-[var(--ink-mute)] max-w-[44ch]">
            Use your admin credentials. Access is audited and restricted by role.
          </p>

          {reasonCopy ? (
            <div className="mt-8 rounded-[var(--radius-md)] border border-[var(--cinnabar)]/30 bg-[var(--cinnabar-wash)] px-4 py-3 text-[13px] leading-[1.55] text-[var(--cinnabar-deep)]">
              {reasonCopy}
            </div>
          ) : null}

          <div className="mt-10">
            <LoginForm nextPath={next ?? "/admin"} />
          </div>

          <div className="mt-10 pt-7 border-t border-[var(--paper-shadow)] flex items-center justify-between text-[11px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
            <span>Authorized personnel only</span>
            <a
              href="/"
              className="text-[var(--ink-mute)] hover:text-[var(--cinnabar)] transition-colors duration-[var(--dur-fast)]"
            >
              ← Public site
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
