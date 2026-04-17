import Link from "next/link";

type Props = {
  href: string;
  title: string;
  excerpt?: string | null;
  dateLabel?: string | null;
  tag?: string | null;
  readMoreLabel: string;
  className?: string;
};

export function NewsCard({ href, title, excerpt, dateLabel, tag, readMoreLabel, className = "" }: Props) {
  return (
    <Link
      href={href}
      className={`group flex flex-col h-full bg-[var(--paper-warm)] border border-[var(--paper-shadow)] p-7
                  shadow-[var(--shadow-paper-1)]
                  transition-[transform,box-shadow,border-color] duration-[var(--dur-base)] ease-[var(--ease-spring)]
                  hover:-translate-y-[2px] hover:shadow-[var(--shadow-paper-2)] hover:border-[var(--cinnabar)]/35
                  focus-visible:-translate-y-[2px] ${className}`}
    >
      {(dateLabel || tag) ? (
        <div className="flex items-center gap-3 text-[11px] tracking-[0.2em] uppercase text-[var(--ink-mute)]">
          {dateLabel ? <span>{dateLabel}</span> : null}
          {dateLabel && tag ? <span className="w-1 h-1 rounded-full bg-[var(--cinnabar)]" /> : null}
          {tag ? <span>{tag}</span> : null}
        </div>
      ) : null}

      <h3 className="mt-4 font-display text-[22px] leading-[1.3] text-[var(--ink)] group-hover:text-[var(--cinnabar)] transition-colors duration-[var(--dur-fast)]">
        {title}
      </h3>

      {excerpt ? (
        <p className="mt-4 text-[14px] leading-[1.7] text-[var(--ink-soft)] line-clamp-3 flex-1">
          {excerpt}
        </p>
      ) : null}

      <div className="mt-6 flex items-center gap-3 text-[11px] tracking-[0.22em] uppercase text-[var(--ink)]">
        {readMoreLabel}
        <span
          aria-hidden="true"
          className="w-8 h-px bg-current transition-transform duration-[var(--dur-base)] ease-[var(--ease-spring)] group-hover:scale-x-[1.4] origin-left"
        />
      </div>
    </Link>
  );
}
