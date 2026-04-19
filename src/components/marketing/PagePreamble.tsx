export function PagePreamble({
  eyebrow,
  heading,
  sub,
}: {
  eyebrow: string;
  heading: string;
  sub?: string;
}) {
  return (
    <div className="relative overflow-hidden">
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[10%] -right-[8%] w-[520px] h-[520px] rounded-full"
             style={{ background: "radial-gradient(closest-side, var(--cinnabar-wash), transparent 70%)" }} />
      </div>
      <div className="relative mx-auto max-w-[1280px] px-6 md:px-10 pt-20 md:pt-28 pb-10 md:pb-16">
        <span className="eyebrow rise" style={{ animationDelay: "40ms" }}>{eyebrow}</span>
        <h1 className="mt-5 font-display text-[var(--ink)] max-w-[820px] rise" style={{ animationDelay: "120ms" }}>
          {heading}
        </h1>
        {sub ? (
          <p className="mt-6 text-[18px] md:text-[20px] leading-[1.6] text-[var(--ink-soft)] font-display max-w-[680px] rise" style={{ animationDelay: "220ms" }}>
            {sub}
          </p>
        ) : null}
      </div>
    </div>
  );
}
