"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "@/lib/locale-client";
import type { Testimonial } from "@/data/testimonials";

type Props = {
  testimonials: Testimonial[];
  autoRotateMs?: number; // 0 disables auto-rotate
};

export function TestimonialCarousel({ testimonials, autoRotateMs = 8000 }: Props) {
  const { locale, t } = useLocale();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const count = testimonials.length;
  const go = useCallback(
    (next: number) => {
      if (count === 0) return;
      setIndex(((next % count) + count) % count);
    },
    [count],
  );

  useEffect(() => {
    if (paused || autoRotateMs <= 0 || count < 2) return;
    timerRef.current = setInterval(() => {
      setIndex((i) => (i + 1) % count);
    }, autoRotateMs);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [paused, autoRotateMs, count]);

  if (count === 0) return null;

  const current = testimonials[index];

  return (
    <section
      className="relative bg-[var(--paper-deep)] border-y border-[var(--paper-shadow)] overflow-hidden"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {/* Ambient warm wash */}
      <div
        aria-hidden="true"
        className="absolute -top-[20%] -right-[10%] w-[640px] h-[640px] rounded-full pointer-events-none"
        style={{ background: "radial-gradient(closest-side, var(--cinnabar-wash), transparent 70%)" }}
      />

      <div className="relative mx-auto max-w-[1080px] px-6 md:px-10 py-20 md:py-28">
        <div className="flex items-start justify-between gap-6 mb-10">
          <span className="eyebrow">
            {locale === "zh" ? "学员的话" : "In their words"}
          </span>
          <div className="flex items-center gap-2">
            <ChevronButton direction="prev" onClick={() => go(index - 1)} locale={locale} />
            <ChevronButton direction="next" onClick={() => go(index + 1)} locale={locale} />
          </div>
        </div>

        {/* The slides are stacked; only the active one is opacity-100 + translate-x-0 */}
        <div className="relative min-h-[280px] md:min-h-[240px]">
          {testimonials.map((t, i) => {
            const active = i === index;
            return (
              <blockquote
                key={t.id}
                aria-hidden={!active}
                className={`absolute inset-0 transition-[opacity,transform] duration-[var(--dur-slow)] ease-[var(--ease-out)] ${
                  active ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3 pointer-events-none"
                }`}
              >
                <p className="font-display text-[26px] md:text-[36px] leading-[1.3] tracking-[-0.015em] text-[var(--ink)] max-w-[920px]">
                  <span aria-hidden="true" className="font-display text-[var(--cinnabar)] mr-2">「</span>
                  {t.quote[locale]}
                  <span aria-hidden="true" className="font-display text-[var(--cinnabar)] ml-1">」</span>
                </p>

                <footer className="mt-8 flex items-center gap-4">
                  <AvatarMark name={t.name} />
                  <div>
                    <div className="font-display text-[16px] leading-[1.3] text-[var(--ink)]">{t.name}</div>
                    <div className="text-[11px] tracking-[0.22em] uppercase text-[var(--ink-mute)] mt-1">{t.role[locale]}</div>
                  </div>
                </footer>
              </blockquote>
            );
          })}
        </div>

        {/* Dots */}
        <div className="mt-12 flex items-center gap-2" role="tablist" aria-label="Testimonial navigation">
          {testimonials.map((t, i) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`${locale === "zh" ? "第" : "Testimonial"} ${i + 1}`}
              onClick={() => go(i)}
              className={`h-[3px] transition-[width,background-color] duration-[var(--dur-base)] ease-[var(--ease-spring)]
                          ${i === index
                            ? "w-10 bg-[var(--cinnabar)]"
                            : "w-5 bg-[var(--paper-shadow)] hover:bg-[var(--ink-mute)]"}`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function ChevronButton({
  direction,
  onClick,
  locale,
}: {
  direction: "prev" | "next";
  onClick: () => void;
  locale: "zh" | "en";
}) {
  const isNext = direction === "next";
  return (
    <button
      type="button"
      aria-label={isNext ? (locale === "zh" ? "下一条" : "Next") : locale === "zh" ? "上一条" : "Previous"}
      onClick={onClick}
      className="w-10 h-10 flex items-center justify-center rounded-full border border-[var(--paper-shadow)] bg-[var(--paper-warm)] text-[var(--ink)]
                 transition-[background-color,border-color,color,transform] duration-[var(--dur-base)] ease-[var(--ease-spring)]
                 hover:bg-[var(--ink)] hover:text-[var(--paper-warm)] hover:border-[var(--ink)]
                 active:translate-y-[1px]"
    >
      <svg aria-hidden="true" className={`w-3 h-3 ${isNext ? "" : "rotate-180"}`} viewBox="0 0 12 12" fill="none">
        <path d="M3 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

// Derived 2-initial mark used when no avatar image is provided.
function AvatarMark({ name }: { name: string }) {
  const initials = name
    .split(/[\s.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase();
  return (
    <div className="w-12 h-12 flex items-center justify-center rounded-full bg-[var(--ink)] text-[var(--paper-warm)] font-display text-[15px] tracking-[0.04em] shadow-[var(--shadow-paper-1)]">
      {initials || "·"}
    </div>
  );
}
