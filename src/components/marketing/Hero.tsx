"use client";

import Link from "next/link";
import { useLocale } from "@/lib/locale-client";

export function Hero() {
  const { t } = useLocale();
  const heading = t("landing.heroHeading");
  const sub = t("landing.heroSubheading");
  const body = t("landing.heroBody");

  // Heading has explicit newline for a two-line composition
  const lines = heading.split("\n");

  return (
    <section className="relative overflow-hidden">
      {/* Ambient backdrop: layered radial cinnabar + jade washes */}
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-[30%] -right-[12%] w-[720px] h-[720px] rounded-full"
             style={{ background: "radial-gradient(closest-side, var(--cinnabar-wash), transparent 70%)" }} />
        <div className="absolute -bottom-[30%] -left-[10%] w-[560px] h-[560px] rounded-full"
             style={{ background: "radial-gradient(closest-side, var(--jade-wash), transparent 70%)" }} />
      </div>

      <div className="relative mx-auto max-w-[1280px] px-6 md:px-10 pt-[96px] md:pt-[140px] pb-[80px] md:pb-[160px]">
        <div>
          <div>
            <span
              className="eyebrow rise"
              style={{ animationDelay: "40ms" }}
            >
              {t("landing.eyebrow")}
            </span>

            <h1
              className="mt-6 font-display text-[var(--ink)] rise"
              style={{ animationDelay: "120ms" }}
            >
              {lines.map((line, i) => (
                <span key={i} className="block">
                  {line}
                </span>
              ))}
            </h1>

            <p
              className="mt-7 text-[18px] md:text-[20px] leading-[1.55] max-w-[540px] font-display text-[var(--ink-soft)] rise"
              style={{ animationDelay: "240ms" }}
            >
              {sub}
            </p>

            <p
              className="mt-5 text-[15px] leading-[1.75] text-[var(--ink-soft)] max-w-[540px] rise"
              style={{ animationDelay: "320ms" }}
            >
              {body}
            </p>

            <div
              className="mt-10 flex flex-col sm:flex-row gap-3 sm:gap-4 rise"
              style={{ animationDelay: "440ms" }}
            >
              <Link
                href="/register"
                className="group inline-flex items-center justify-center gap-3 h-12 px-7 rounded-full bg-[var(--cinnabar)] text-[var(--paper-warm)] text-[13px] font-medium tracking-[0.02em]
                           shadow-[0_4px_14px_rgba(37,99,235,0.28)]
                           transition-[transform,box-shadow,background-color] duration-[var(--dur-base)] ease-[var(--ease-spring)]
                           hover:-translate-y-[1px] hover:bg-[var(--cinnabar-deep)] hover:shadow-[0_10px_24px_rgba(37,99,235,0.38)]
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
                className="inline-flex items-center justify-center gap-3 h-12 px-7 rounded-full bg-transparent text-[var(--ink)] text-[13px] font-medium tracking-[0.02em]
                           border border-[var(--paper-shadow)]
                           transition-[background-color,border-color,transform] duration-[var(--dur-base)] ease-[var(--ease-spring)]
                           hover:bg-[var(--paper-warm)] hover:border-[var(--ink)]
                           active:translate-y-[1px]"
              >
                {t("landing.ctaPrograms")}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
