"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "@/lib/locale-client";

export type EventRailItem = {
  slug: string;
  title: string;
  heading?: string | null;
  city?: string | null;
  mode?: string | null;
  start_date?: string | null;
};

type Props = {
  items: EventRailItem[];
  eyebrow: string;
  heading: string;
  sub?: string;
  viewAllHref?: string;
  emptyLabel?: string;
};

export function EventRail({ items, eyebrow, heading, sub, viewAllHref, emptyLabel }: Props) {
  const { locale, t } = useLocale();
  const railRef = useRef<HTMLDivElement | null>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);

  const updateBounds = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    setCanPrev(el.scrollLeft > 4);
    setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    updateBounds();
    const el = railRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateBounds, { passive: true });
    window.addEventListener("resize", updateBounds);
    return () => {
      el.removeEventListener("scroll", updateBounds);
      window.removeEventListener("resize", updateBounds);
    };
  }, [updateBounds, items.length]);

  function scrollBy(dir: "prev" | "next") {
    const el = railRef.current;
    if (!el) return;
    const delta = Math.round(el.clientWidth * 0.8) * (dir === "next" ? 1 : -1);
    el.scrollBy({ left: delta, behavior: "smooth" });
  }

  return (
    <section className="mx-auto max-w-[1440px] px-6 md:px-10 py-20 md:py-28">
      <header className="flex flex-col md:flex-row md:items-end gap-6 pb-8 border-b border-[var(--paper-shadow)]">
        <div className="max-w-[620px] flex-1">
          <span className="eyebrow">{eyebrow}</span>
          <h2 className="mt-4 font-display">{heading}</h2>
          {sub ? <p className="mt-4 text-[16px] leading-[1.7] text-[var(--ink-soft)]">{sub}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          {viewAllHref ? (
            <Link
              href={viewAllHref}
              className="mr-2 inline-flex items-center gap-2 text-[11px] tracking-[0.22em] uppercase text-[var(--ink)] hover:text-[var(--cinnabar)] transition-colors duration-[var(--dur-fast)]"
            >
              {t("common.viewAll")}
              <span aria-hidden="true" className="w-6 h-px bg-current" />
            </Link>
          ) : null}
          <ChevronButton dir="prev" enabled={canPrev} onClick={() => scrollBy("prev")} locale={locale} />
          <ChevronButton dir="next" enabled={canNext} onClick={() => scrollBy("next")} locale={locale} />
        </div>
      </header>

      {items.length === 0 ? (
        <div className="py-14 text-center text-[var(--ink-mute)] text-[14px]">
          {emptyLabel ?? t("landing.newsEmpty")}
        </div>
      ) : (
        <div
          ref={railRef}
          className="mt-10 flex gap-5 md:gap-6 overflow-x-auto snap-x snap-mandatory pb-6 scrollbar-hide"
          style={{ scrollbarWidth: "none" }}
        >
          {items.map((ev, i) => (
            <Link
              key={ev.slug}
              href={`/events/${ev.slug}`}
              className="group flex-none w-[82%] sm:w-[55%] md:w-[38%] lg:w-[30%] snap-start
                         bg-[var(--paper-warm)] border border-[var(--paper-shadow)] p-7 md:p-8
                         shadow-[var(--shadow-paper-1)]
                         transition-[transform,box-shadow,border-color] duration-[var(--dur-base)] ease-[var(--ease-spring)]
                         hover:-translate-y-[2px] hover:shadow-[var(--shadow-paper-2)] hover:border-[var(--cinnabar)]/35"
            >
              <span className="font-display text-[13px] tracking-[0.24em] text-[var(--cinnabar)]">
                — {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-4 font-display text-[22px] md:text-[24px] leading-[1.25] text-[var(--ink)]">
                {ev.title}
              </h3>
              {ev.heading ? (
                <p className="mt-3 text-[14px] leading-[1.7] text-[var(--ink-soft)] line-clamp-2">
                  {ev.heading}
                </p>
              ) : null}
              <div className="mt-6 flex flex-wrap items-center gap-3 text-[11px] tracking-[0.2em] uppercase text-[var(--ink-mute)]">
                {ev.start_date ? (
                  <span>
                    {new Date(ev.start_date).toLocaleDateString(
                      locale === "zh" ? "zh-CN" : "en-GB",
                      { year: "numeric", month: "short", day: "numeric" },
                    )}
                  </span>
                ) : null}
                {ev.city ? (
                  <>
                    <span className="w-1 h-1 rounded-full bg-[var(--cinnabar)]" />
                    <span>{ev.city}</span>
                  </>
                ) : null}
                {ev.mode ? (
                  <>
                    <span className="w-1 h-1 rounded-full bg-[var(--paper-shadow)]" />
                    <span>{ev.mode}</span>
                  </>
                ) : null}
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function ChevronButton({
  dir,
  enabled,
  onClick,
  locale,
}: {
  dir: "prev" | "next";
  enabled: boolean;
  onClick: () => void;
  locale: "zh" | "en";
}) {
  const isNext = dir === "next";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!enabled}
      aria-label={isNext ? (locale === "zh" ? "下一个" : "Next") : locale === "zh" ? "上一个" : "Previous"}
      className="w-10 h-10 flex items-center justify-center border border-[var(--paper-shadow)] bg-[var(--paper-warm)] text-[var(--ink)]
                 transition-[background-color,border-color,color,opacity,transform] duration-[var(--dur-base)] ease-[var(--ease-spring)]
                 hover:bg-[var(--ink)] hover:text-[var(--paper-warm)] hover:border-[var(--ink)]
                 active:translate-y-[1px] disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:bg-[var(--paper-warm)] disabled:hover:text-[var(--ink)]"
    >
      <svg aria-hidden="true" className={`w-3 h-3 ${isNext ? "" : "rotate-180"}`} viewBox="0 0 12 12" fill="none">
        <path d="M3 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
