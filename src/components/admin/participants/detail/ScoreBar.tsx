export function ScoreBar({
  label,
  labelZh,
  score,
  accent = "blue",
  max = 5,
  hint,
}: {
  label: string;
  labelZh?: string;
  score: number | null;
  accent?: "blue" | "slate" | "ink";
  max?: number;
  hint?: string | null;
}) {
  const has = typeof score === "number";
  const pct = has ? (Math.min(score!, max) / max) * 100 : 0;

  const gradient =
    accent === "slate"
      ? "linear-gradient(90deg, var(--jade) 0%, var(--cinnabar-soft) 100%)"
      : accent === "ink"
        ? "linear-gradient(90deg, var(--ink) 0%, var(--cinnabar) 100%)"
        : "linear-gradient(90deg, var(--cinnabar) 0%, var(--cinnabar-soft) 100%)";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-[11px] tracking-[0.22em] uppercase text-[var(--ink-mute)]">
            {label}
          </span>
          {labelZh ? (
            <span className="text-[10px] tracking-[0.18em] uppercase text-[var(--ink-faint)]">
              {labelZh}
            </span>
          ) : null}
        </div>
        <div className="tabular-nums">
          {has ? (
            <>
              <span className="font-display text-[22px] leading-none tracking-[-0.015em] text-[var(--ink)]">
                {score}
              </span>
              <span className="ml-0.5 text-[11px] text-[var(--ink-faint)]">
                /{max}
              </span>
            </>
          ) : (
            <span className="text-[11px] tracking-[0.18em] uppercase text-[var(--ink-faint)]">
              Unscored
            </span>
          )}
        </div>
      </div>
      <div className="relative h-[6px] rounded-full bg-[var(--paper-deep)] overflow-hidden">
        <span
          className="absolute inset-y-0 left-0 rounded-full
                     transition-[width] duration-[var(--dur-slow)] ease-[var(--ease-out)]"
          style={{
            width: `${pct}%`,
            background: has ? gradient : "transparent",
          }}
          aria-hidden="true"
        />
      </div>
      {hint ? (
        <span className="text-[10px] tracking-[0.16em] uppercase text-[var(--ink-faint)]">
          {hint}
        </span>
      ) : null}
    </div>
  );
}
