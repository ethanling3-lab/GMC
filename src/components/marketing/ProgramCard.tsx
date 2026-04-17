import Link from "next/link";

type Props = {
  index: string;          // "01", "02", ...
  title: string;
  teaser: string;
  href: string;
  ctaLabel: string;
  className?: string;
};

export function ProgramCard({ index, title, teaser, href, ctaLabel, className = "" }: Props) {
  return (
    <Link
      href={href}
      className={`group relative flex flex-col h-full bg-[var(--paper-warm)]
                  border border-[var(--paper-shadow)]
                  p-7 md:p-8
                  shadow-[var(--shadow-paper-1)]
                  transition-[transform,box-shadow,border-color] duration-[var(--dur-base)] ease-[var(--ease-spring)]
                  hover:-translate-y-[2px] hover:shadow-[var(--shadow-paper-2)] hover:border-[var(--cinnabar)]/35
                  focus-visible:-translate-y-[2px] ${className}`}
    >
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
    </Link>
  );
}
