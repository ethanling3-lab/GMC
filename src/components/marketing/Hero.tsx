"use client";

import Link from "next/link";
import Image from "next/image";
import { useLocale } from "@/lib/locale-client";

export function Hero() {
  const { locale, t } = useLocale();
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
        <div className="grid md:grid-cols-[1.35fr_1fr] gap-10 md:gap-16 items-end">
          <div>
            <span
              className="eyebrow rise"
              style={{ animationDelay: "40ms" }}
            >
              {t("landing.eyebrow")}
            </span>

            <h1 className="mt-6 font-display text-[var(--ink)] rise" style={{ animationDelay: "120ms" }}>
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
                className="group inline-flex items-center justify-center gap-3 h-12 px-7 bg-[var(--ink)] text-[var(--paper-warm)] text-[13px] font-semibold tracking-[0.12em] uppercase
                           transition-[transform,box-shadow] duration-[var(--dur-base)] ease-[var(--ease-spring)]
                           hover:-translate-y-[1px] hover:shadow-[var(--shadow-paper-2)]
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
                className="inline-flex items-center justify-center gap-3 h-12 px-7 bg-[var(--paper-warm)] text-[var(--ink)] text-[13px] font-semibold tracking-[0.12em] uppercase
                           border border-[var(--ink)]
                           transition-[background-color,color,transform] duration-[var(--dur-base)] ease-[var(--ease-spring)]
                           hover:bg-[var(--ink)] hover:text-[var(--paper-warm)]
                           active:translate-y-[1px]"
              >
                {t("landing.ctaPrograms")}
              </Link>
            </div>
          </div>

          {/* Right: brand tableau — the logo on paper, flanked by classical ticks */}
          <div
            className="relative hidden md:block rise"
            style={{ animationDelay: "360ms" }}
          >
            <div className="relative aspect-[3/4] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-2)] overflow-hidden">
              {/* Soft radial wash under the logo so the rainbow reads as glow, not clash */}
              <div
                aria-hidden="true"
                className="absolute inset-0"
                style={{
                  background:
                    "radial-gradient(closest-side at 50% 45%, rgba(184,153,104,0.18), transparent 70%)",
                }}
              />
              <div className="absolute inset-0 flex items-center justify-center px-10">
                <Image
                  src="/gmc-logo.png"
                  alt="GMC · Glorious Melodies Consultancy"
                  width={600}
                  height={346}
                  priority
                  className="w-full max-w-[380px] h-auto"
                />
              </div>
              {/* subtle corner tick decorations */}
              <span className="absolute top-4 left-4 w-5 h-5 border-t border-l border-[var(--ink-mute)]/30" />
              <span className="absolute top-4 right-4 w-5 h-5 border-t border-r border-[var(--ink-mute)]/30" />
              <span className="absolute bottom-4 left-4 w-5 h-5 border-b border-l border-[var(--ink-mute)]/30" />
              <span className="absolute bottom-4 right-4 w-5 h-5 border-b border-r border-[var(--ink-mute)]/30" />
            </div>
            <p className="mt-5 text-[11px] tracking-[0.22em] uppercase text-[var(--ink-mute)]">
              {locale === "zh" ? "Glorious Melodies Consultancy · 新加坡" : "Glorious Melodies Consultancy · Singapore"}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
