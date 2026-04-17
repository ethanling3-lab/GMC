type Stat = { value: string; label: string };

export function StatsBand({ stats, eyebrow, heading }: { stats: Stat[]; eyebrow: string; heading: string }) {
  return (
    <section className="relative bg-[var(--ink)] text-[var(--paper-warm)] overflow-hidden">
      {/* Grain + subtle cinnabar vignette */}
      <div aria-hidden="true" className="absolute inset-0 opacity-60 pointer-events-none"
           style={{
             backgroundImage:
               "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='1.2' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.03 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
             backgroundSize: "160px 160px",
           }}
      />
      <div aria-hidden="true" className="absolute -top-[30%] -right-[10%] w-[520px] h-[520px] rounded-full pointer-events-none"
           style={{ background: "radial-gradient(closest-side, rgba(139,42,28,0.22), transparent 70%)" }} />

      <div className="relative mx-auto max-w-[1280px] px-6 md:px-10 py-20 md:py-28">
        <div className="max-w-[620px]">
          <span className="eyebrow !text-[var(--cinnabar-soft)]">{eyebrow}</span>
          <h2 className="mt-4 font-display text-[var(--paper-warm)]">{heading}</h2>
        </div>

        <div className="mt-12 md:mt-16 grid grid-cols-2 md:grid-cols-4 gap-y-10 md:gap-y-0 md:gap-x-10">
          {stats.map((s, i) => (
            <div
              key={s.label}
              className={`md:px-8 ${i !== 0 ? "md:border-l md:border-[var(--paper-warm)]/15" : ""}`}
            >
              <div className="font-display text-[44px] md:text-[60px] lg:text-[72px] leading-[1] text-[var(--paper-warm)] tracking-[-0.02em]">
                {s.value}
              </div>
              <div className="mt-3 text-[11px] tracking-[0.24em] uppercase text-[var(--paper-warm)]/70">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
