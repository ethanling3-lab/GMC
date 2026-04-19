"use client";

import Link from "next/link";
import { useLocale } from "@/lib/locale-client";

type Props = {
  /**
   * Optional hero video. If omitted, a CSS-only ambient background renders instead —
   * layered radial washes over a warm ink ground with rice-paper grain. When Ethan
   * provides real retreat footage, drop it into /public/ and pass { src, poster } here.
   */
  video?: { src: string; poster?: string };
};

export function VideoHero({ video }: Props) {
  const { locale, t } = useLocale();
  const heading = t("landing.heroHeading");
  const lines = heading.split("\n");

  return (
    <section className="relative overflow-hidden min-h-[88vh] md:min-h-[92vh] flex items-end">
      {/* Background — video OR CSS ambient */}
      <div aria-hidden="true" className="absolute inset-0">
        {video ? (
          <video
            className="absolute inset-0 w-full h-full object-cover"
            autoPlay
            muted
            loop
            playsInline
            poster={video.poster}
          >
            <source src={video.src} />
          </video>
        ) : (
          <div
            className="absolute inset-0 animate-drift"
            style={{
              background:
                "radial-gradient(1100px 620px at 12% 18%, rgba(125,164,244,0.32), transparent 60%)," +
                "radial-gradient(820px 560px at 88% 82%, rgba(37,99,235,0.34), transparent 65%)," +
                "radial-gradient(560px 420px at 50% 110%, rgba(59,130,246,0.22), transparent 70%)," +
                "linear-gradient(180deg, #0B2954 0%, #081f44 55%, #05173a 100%)",
            }}
          >
            {/* Luminous grain for texture */}
            <div
              className="absolute inset-0 opacity-[0.32] mix-blend-overlay"
              style={{
                backgroundImage:
                  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='260' height='260'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.88' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.06 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
                backgroundSize: "260px 260px",
              }}
            />
          </div>
        )}
        {/* Legibility gradient — gentle lift toward the bottom where text sits */}
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--ink)]/70 via-[var(--ink)]/20 to-transparent" />
        {/* Subtle vignette */}
        <div className="absolute inset-0" style={{ boxShadow: "inset 0 -160px 240px -60px rgba(0,0,0,0.45)" }} />
      </div>

      {/* Foreground content */}
      <div className="relative mx-auto max-w-[1280px] px-6 md:px-10 pb-20 md:pb-28 pt-32 md:pt-40 w-full">
        <div className="max-w-[880px]">
          <span
            className="eyebrow !text-[var(--cinnabar-soft)] rise"
            style={{ animationDelay: "60ms" }}
          >
            {t("landing.eyebrow")}
          </span>

          <h1
            className="mt-7 font-display text-[var(--paper-warm)] rise"
            style={{ animationDelay: "180ms" }}
          >
            {lines.map((line, i) => (
              <span key={i} className="block">
                {line}
              </span>
            ))}
          </h1>

          <p
            className="mt-7 text-[18px] md:text-[22px] leading-[1.55] font-display text-[var(--paper-warm)]/92 max-w-[620px] rise"
            style={{ animationDelay: "300ms" }}
          >
            {t("landing.heroSubheading")}
          </p>

          <p
            className="mt-6 text-[15px] leading-[1.75] text-[var(--paper-warm)]/70 max-w-[620px] rise"
            style={{ animationDelay: "380ms" }}
          >
            {t("landing.heroBody")}
          </p>

          <div
            className="mt-10 flex flex-col sm:flex-row gap-3 sm:gap-4 rise"
            style={{ animationDelay: "500ms" }}
          >
            <Link
              href="/register"
              className="group inline-flex items-center justify-center gap-3 h-12 px-7 rounded-full bg-[var(--cinnabar)] text-[var(--paper-warm)] text-[13px] font-medium tracking-[0.02em]
                         shadow-[0_6px_20px_rgba(37,99,235,0.45)]
                         transition-[transform,box-shadow,background-color] duration-[var(--dur-base)] ease-[var(--ease-spring)]
                         hover:-translate-y-[1px] hover:bg-[var(--cinnabar-deep)] hover:shadow-[0_12px_30px_rgba(37,99,235,0.55)]
                         active:translate-y-0"
            >
              {t("landing.ctaRegister")}
              <span
                aria-hidden="true"
                className="w-4 h-px bg-current transition-transform duration-[var(--dur-base)] ease-[var(--ease-spring)] group-hover:translate-x-1"
              />
            </Link>
            <Link
              href="/programs"
              className="inline-flex items-center justify-center gap-3 h-12 px-7 rounded-full bg-transparent text-[var(--paper-warm)] text-[13px] font-medium tracking-[0.02em]
                         border border-[var(--paper-warm)]/40
                         transition-[background-color,border-color,transform] duration-[var(--dur-base)] ease-[var(--ease-spring)]
                         hover:bg-[var(--paper-warm)]/10 hover:border-[var(--paper-warm)]
                         active:translate-y-[1px]"
            >
              {t("landing.ctaPrograms")}
            </Link>
          </div>
        </div>

      </div>

      {/* Decorative: classical corner ticks on the entire hero */}
      <span aria-hidden="true" className="absolute top-6 left-6 w-6 h-6 border-t border-l border-[var(--paper-warm)]/30" />
      <span aria-hidden="true" className="absolute top-6 right-6 w-6 h-6 border-t border-r border-[var(--paper-warm)]/30" />

      {/* Scroll cue */}
      <div
        aria-hidden="true"
        className="hidden md:flex absolute left-10 bottom-10 items-center gap-3 text-[11px] tracking-[0.24em] uppercase text-[var(--paper-warm)]/60 rise"
        style={{ animationDelay: "720ms" }}
      >
        <span className="w-10 h-px bg-current" />
        {locale === "zh" ? "下滑" : "Scroll"}
      </div>

    </section>
  );
}
