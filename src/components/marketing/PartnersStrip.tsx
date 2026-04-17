type Partner = { name: string; subtitle?: string };

const DEFAULT_PARTNERS: Partner[] = [
  { name: "UNESCO ICHEI", subtitle: "Higher Education Innovation" },
  { name: "Brest Business School", subtitle: "France" },
  { name: "Sungkyunkwan University", subtitle: "Republic of Korea" },
  { name: "Yonsei University", subtitle: "Republic of Korea" },
];

export function PartnersStrip({ partners = DEFAULT_PARTNERS, compact = false }: { partners?: Partner[]; compact?: boolean }) {
  return (
    <div
      className={`grid grid-cols-2 lg:grid-cols-4 ${compact ? "gap-6" : "gap-10 md:gap-12"}`}
    >
      {partners.map((p, i) => (
        <div
          key={p.name}
          className={`group flex flex-col justify-center gap-1 py-5 ${i === 0 ? "" : "lg:border-l lg:border-[var(--paper-shadow)] lg:pl-10"}`}
        >
          <div className="font-display text-[18px] md:text-[20px] leading-[1.25] text-[var(--ink)] transition-colors duration-[var(--dur-fast)] group-hover:text-[var(--cinnabar)]">
            {p.name}
          </div>
          {p.subtitle ? (
            <div className="text-[11px] tracking-[0.22em] uppercase text-[var(--ink-mute)]">
              {p.subtitle}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
