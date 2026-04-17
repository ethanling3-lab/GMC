import Link from "next/link";

type Props = {
  eyebrow?: string;
  heading: string;
  body?: string;
  cta: { href: string; label: string };
  secondary?: { href: string; label: string };
};

export function CTABlock({ eyebrow, heading, body, cta, secondary }: Props) {
  return (
    <section className="relative bg-[var(--paper-deep)] border-y border-[var(--paper-shadow)]">
      <div className="mx-auto max-w-[1080px] px-6 md:px-10 py-20 md:py-28 text-center">
        {eyebrow ? <span className="eyebrow justify-center">{eyebrow}</span> : null}
        <h2 className="mt-4 font-display text-[var(--ink)] max-w-[760px] mx-auto">
          {heading}
        </h2>
        {body ? (
          <p className="mt-6 text-[16px] md:text-[17px] leading-[1.7] text-[var(--ink-soft)] max-w-[640px] mx-auto">
            {body}
          </p>
        ) : null}

        <div className="mt-10 flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center">
          <Link
            href={cta.href}
            className="group inline-flex items-center justify-center gap-3 h-12 px-8 bg-[var(--ink)] text-[var(--paper-warm)] text-[13px] font-semibold tracking-[0.12em] uppercase
                       transition-[transform,box-shadow] duration-[var(--dur-base)] ease-[var(--ease-spring)]
                       hover:-translate-y-[1px] hover:shadow-[var(--shadow-paper-2)]
                       active:translate-y-0"
          >
            {cta.label}
            <span
              aria-hidden="true"
              className="w-4 h-px bg-current transition-transform duration-[var(--dur-base)] ease-[var(--ease-spring)] group-hover:translate-x-1"
            />
          </Link>
          {secondary ? (
            <Link
              href={secondary.href}
              className="inline-flex items-center justify-center gap-3 h-12 px-8 bg-transparent text-[var(--ink)] text-[13px] font-semibold tracking-[0.12em] uppercase
                         border border-[var(--ink)]
                         transition-[background-color,color] duration-[var(--dur-base)] ease-[var(--ease-spring)]
                         hover:bg-[var(--ink)] hover:text-[var(--paper-warm)]"
            >
              {secondary.label}
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}
