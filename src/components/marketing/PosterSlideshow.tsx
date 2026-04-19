"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
  images: string[];
  alt: string;
  captionZh?: string | null;
  captionEn?: string | null;
  locale: "zh" | "en";
};

export function PosterSlideshow({
  images,
  alt,
  captionZh,
  captionEn,
  locale,
}: Props) {
  const total = images.length;
  const [index, setIndex] = useState(0);
  const hoverRef = useRef(false);

  const go = useCallback(
    (next: number) => {
      if (total === 0) return;
      setIndex(((next % total) + total) % total);
    },
    [total],
  );

  const next = useCallback(() => go(index + 1), [go, index]);
  const prev = useCallback(() => go(index - 1), [go, index]);

  useEffect(() => {
    if (total <= 1) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [total, next, prev]);

  useEffect(() => {
    if (total <= 1) return;
    const id = window.setInterval(() => {
      if (!hoverRef.current) next();
    }, 6500);
    return () => window.clearInterval(id);
  }, [total, next]);

  if (total === 0) {
    return (
      <div
        className="relative aspect-[16/9] md:aspect-[21/9] rounded-[var(--radius-lg)] overflow-hidden bg-[var(--ink)] shadow-[var(--shadow-paper-2)]"
        aria-hidden="true"
      >
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(620px 380px at 30% 30%, rgba(125,164,244,0.35), transparent 70%),\
               radial-gradient(720px 440px at 80% 70%, rgba(37,99,235,0.45), transparent 72%),\
               linear-gradient(180deg, #0B2954 0%, #1848B8 100%)",
          }}
        />
        <div
          className="absolute inset-0 opacity-[0.35] mix-blend-overlay"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.05 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
          }}
        />
      </div>
    );
  }

  return (
    <figure className="relative">
      <div
        className="relative aspect-[16/9] md:aspect-[21/9] rounded-[var(--radius-lg)] overflow-hidden bg-[var(--ink)] shadow-[var(--shadow-paper-3)]"
        onMouseEnter={() => {
          hoverRef.current = true;
        }}
        onMouseLeave={() => {
          hoverRef.current = false;
        }}
        role={total > 1 ? "group" : undefined}
        aria-roledescription={total > 1 ? "carousel" : undefined}
        aria-label={alt}
      >
        {images.map((src, i) => (
          <div
            key={src + i}
            className="absolute inset-0 transition-opacity duration-[720ms] ease-[var(--ease-out)]"
            style={{ opacity: i === index ? 1 : 0 }}
            aria-hidden={i !== index}
          >
            <Image
              src={src}
              alt={i === index ? alt : ""}
              fill
              sizes="(min-width: 1200px) 1120px, 100vw"
              className="object-cover"
              priority={i === 0}
              unoptimized
            />
          </div>
        ))}

        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgba(11,41,84,0) 45%, rgba(11,41,84,0.58) 100%)",
          }}
        />

        {total > 1 ? (
          <>
            <button
              type="button"
              onClick={prev}
              aria-label={locale === "zh" ? "上一张" : "Previous slide"}
              className="absolute left-3 md:left-5 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full
                         flex items-center justify-center
                         bg-[rgba(251,252,255,0.88)] backdrop-blur-sm
                         text-[var(--ink)] shadow-[var(--shadow-paper-2)]
                         transition-[transform,background-color] duration-[var(--dur-fast)]
                         hover:bg-[var(--paper-warm)] hover:-translate-x-[1px] active:scale-[0.96]"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M10 3.5 5.5 8 10 12.5" />
              </svg>
            </button>
            <button
              type="button"
              onClick={next}
              aria-label={locale === "zh" ? "下一张" : "Next slide"}
              className="absolute right-3 md:right-5 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full
                         flex items-center justify-center
                         bg-[rgba(251,252,255,0.88)] backdrop-blur-sm
                         text-[var(--ink)] shadow-[var(--shadow-paper-2)]
                         transition-[transform,background-color] duration-[var(--dur-fast)]
                         hover:bg-[var(--paper-warm)] hover:translate-x-[1px] active:scale-[0.96]"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M6 3.5 10.5 8 6 12.5" />
              </svg>
            </button>

            <div className="absolute left-0 right-0 bottom-5 flex items-center justify-center gap-2">
              {images.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => go(i)}
                  aria-label={
                    locale === "zh" ? `跳到第 ${i + 1} 张` : `Go to slide ${i + 1}`
                  }
                  aria-current={i === index ? "true" : undefined}
                  className="group h-2 rounded-full transition-[width,background-color] duration-[var(--dur-base)] ease-[var(--ease-spring)]"
                  style={{
                    width: i === index ? 28 : 8,
                    backgroundColor:
                      i === index
                        ? "var(--paper-warm)"
                        : "rgba(251,252,255,0.45)",
                  }}
                />
              ))}
            </div>

            <div
              className="absolute top-5 right-5 inline-flex items-center gap-2 px-3 py-1.5 rounded-full
                         bg-[rgba(11,41,84,0.48)] backdrop-blur-sm
                         text-[11px] tracking-[0.18em] uppercase text-[var(--paper-warm)]
                         tabular-nums"
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              <span className="w-4 h-px bg-[var(--paper-warm)] opacity-60" />
              <span>{String(total).padStart(2, "0")}</span>
            </div>
          </>
        ) : null}
      </div>

      {captionZh || captionEn ? (
        <figcaption className="mt-4 flex items-center gap-3 text-[10px] tracking-[0.22em] uppercase text-[var(--ink-mute)]">
          <span className="w-6 h-px bg-[var(--cinnabar)]" />
          {locale === "zh"
            ? (captionZh ?? captionEn)
            : (captionEn ?? captionZh)}
        </figcaption>
      ) : null}
    </figure>
  );
}
