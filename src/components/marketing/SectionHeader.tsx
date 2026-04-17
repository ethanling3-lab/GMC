import Link from "next/link";

type Props = {
  eyebrow: string;
  heading: string;
  sub?: string;
  align?: "left" | "center";
  action?: { href: string; label: string };
  className?: string;
};

export function SectionHeader({ eyebrow, heading, sub, align = "left", action, className = "" }: Props) {
  const isCentered = align === "center";
  return (
    <header
      className={`flex flex-col md:flex-row md:items-end gap-6 pb-8 border-b border-[var(--paper-shadow)] ${
        isCentered ? "md:flex-col md:items-center text-center" : "md:justify-between"
      } ${className}`}
    >
      <div className={`${isCentered ? "max-w-[640px] mx-auto" : "max-w-[560px]"}`}>
        <span className="eyebrow">{eyebrow}</span>
        <h2 className="mt-4 font-display">{heading}</h2>
        {sub ? (
          <p className="mt-4 text-[16px] leading-[1.7] text-[var(--ink-soft)]">{sub}</p>
        ) : null}
      </div>
      {action ? (
        <Link
          href={action.href}
          className="group inline-flex items-center gap-2 text-[12px] tracking-[0.14em] uppercase text-[var(--ink)] hover:text-[var(--cinnabar)] transition-colors duration-[var(--dur-fast)]"
        >
          {action.label}
          <span
            aria-hidden="true"
            className="w-6 h-px bg-current transition-transform duration-[var(--dur-base)] ease-[var(--ease-spring)] group-hover:scale-x-[1.5] origin-left"
          />
        </Link>
      ) : null}
    </header>
  );
}
