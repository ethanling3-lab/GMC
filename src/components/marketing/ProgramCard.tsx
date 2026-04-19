import Link from "next/link";
import Image from "next/image";

type Props = {
  index: string;          // "01", "02", ...
  title: string;
  teaser: string;
  href: string;
  ctaLabel: string;
  imageSrc?: string;
  imageAlt?: string;
  className?: string;
};

export function ProgramCard({ index, title, teaser, href, ctaLabel, imageSrc, imageAlt, className = "" }: Props) {
  return (
    <Link
      href={href}
      className={`group relative flex flex-col h-full bg-[var(--paper-deep)]
                  rounded-[var(--radius-lg)] overflow-hidden
                  transition-[transform,box-shadow,background-color] duration-[var(--dur-base)] ease-[var(--ease-spring)]
                  hover:-translate-y-[2px] hover:shadow-[var(--shadow-paper-2)] hover:bg-[var(--paper-warm)]
                  focus-visible:-translate-y-[2px] ${className}`}
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-[var(--ink)]/5">
        {imageSrc ? (
          <>
            <Image
              src={imageSrc}
              alt={imageAlt ?? title}
              fill
              sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
              className="object-cover transition-transform duration-[var(--dur-slow)] ease-[var(--ease-spring)] group-hover:scale-[1.03]"
            />
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-gradient-to-t from-black/40 via-black/0 to-black/0"
            />
          </>
        ) : (
          <div
            aria-hidden="true"
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(closest-side at 30% 30%, var(--cinnabar-wash), transparent 70%), radial-gradient(closest-side at 75% 75%, var(--jade-wash), transparent 70%)",
            }}
          />
        )}
      </div>

      <div className="flex flex-col flex-1 p-7 md:p-8">
        <div className="flex items-start justify-between gap-4">
          <span className="font-display text-[13px] tracking-[0.24em] text-[var(--cinnabar)]">
            — {index}
          </span>
          <span
            aria-hidden="true"
            className="w-6 h-6 flex items-center justify-center text-[var(--ink-mute)]
                       transition-transform duration-[var(--dur-base)] ease-[var(--ease-spring)]
                       group-hover:translate-x-[2px] group-hover:-translate-y-[2px] group-hover:text-[var(--cinnabar)]"
          >
            ↗
          </span>
        </div>

        <h3 className="mt-5 font-display text-[24px] md:text-[28px] leading-[1.2] text-[var(--ink)]">
          {title}
        </h3>

        <p className="mt-4 text-[14px] leading-[1.7] text-[var(--ink-soft)] flex-1">
          {teaser}
        </p>

        <div className="mt-8 flex items-center gap-3 text-[11px] tracking-[0.22em] uppercase text-[var(--ink)]">
          {ctaLabel}
          <span
            aria-hidden="true"
            className="w-8 h-px bg-current transition-transform duration-[var(--dur-base)] ease-[var(--ease-spring)] group-hover:scale-x-[1.4] origin-left"
          />
        </div>
      </div>
    </Link>
  );
}
