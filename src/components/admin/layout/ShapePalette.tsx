"use client";

// ShapePalette — Pass 4 Miro chrome.
//
// Floating vertical icon-only column at the canvas left edge. Each tile is
// a 36×36 button rendering the existing PaletteGlyph SVG. Hover surfaces a
// native browser tooltip with the bilingual shape name.
//
// Click to spawn a new shape near canvas center (drag-to-spawn lands later).

import { SHAPE_LABEL_CN, SHAPE_LABEL_EN, type ShapeKind } from "./types";

type Props = {
  kinds: ShapeKind[];
  onSpawn: (kind: ShapeKind) => void;
  disabled: boolean;
};

export function ShapePalette({ kinds, onSpawn, disabled }: Props) {
  return (
    <aside className="gmc-print-hide absolute left-3 top-1/2 -translate-y-1/2 flex flex-col gap-1 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)]/95 backdrop-blur-sm shadow-[var(--shadow-paper-2)] p-1.5 z-10">
      {kinds.map((k) => (
        <button
          key={k}
          type="button"
          disabled={disabled}
          onClick={() => onSpawn(k)}
          aria-label={`${SHAPE_LABEL_EN[k]} · ${SHAPE_LABEL_CN[k]}`}
          className="group/tile relative flex items-center justify-center w-9 h-9 rounded-[var(--radius-sm)]
                     border border-transparent text-[var(--ink-soft)]
                     hover:border-[var(--cinnabar)]/30 hover:bg-[var(--cinnabar-wash)] hover:text-[var(--cinnabar-deep)]
                     focus-visible:shadow-[var(--shadow-focus)]
                     disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:border-transparent
                     transition-[background-color,border-color,color] duration-[var(--dur-fast)]"
        >
          <PaletteGlyph kind={k} />
          <PaletteTooltip
            primary={SHAPE_LABEL_EN[k]}
            secondary={SHAPE_LABEL_CN[k]}
          />
        </button>
      ))}
    </aside>
  );
}

// Miro-style tooltip — dark pill that pops to the right of the hovered tile,
// with a small left-pointing arrow. Hidden by default; revealed via the
// parent's group-hover. 80ms delay so casual mouse-throughs don't flash.
function PaletteTooltip({
  primary,
  secondary,
}: {
  primary: string;
  secondary: string;
}) {
  return (
    <span
      className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3
                 opacity-0 translate-x-[-4px]
                 group-hover/tile:opacity-100 group-hover/tile:translate-x-0
                 transition-[opacity,transform] duration-[var(--dur-fast)] delay-[80ms]
                 z-20 whitespace-nowrap"
      role="tooltip"
    >
      <span
        className="relative inline-flex items-baseline gap-1.5
                   rounded-[var(--radius-sm)] px-2.5 py-1
                   text-[11px] tracking-[0.04em] leading-tight
                   shadow-[0_2px_10px_rgba(11,41,84,0.18)]"
        style={{
          background: "var(--ink)",
          color: "var(--paper-warm)",
        }}
      >
        <span className="font-medium">{primary}</span>
        <span style={{ color: "var(--paper-shadow)" }}>·</span>
        <span style={{ color: "var(--paper-shadow)" }}>{secondary}</span>
        {/* Left-pointing arrow — 5px triangle nudged off the pill's left edge. */}
        <span
          aria-hidden="true"
          className="absolute right-full top-1/2 -translate-y-1/2"
          style={{
            width: 0,
            height: 0,
            borderTop: "5px solid transparent",
            borderBottom: "5px solid transparent",
            borderRight: "5px solid var(--ink)",
          }}
        />
      </span>
    </span>
  );
}

// Compact glyph per shape kind. Uses currentColor so hover/disabled
// inheritance from the parent button cascades.
function PaletteGlyph({ kind }: { kind: ShapeKind }) {
  return (
    <span aria-hidden="true" className="block">
      <svg width="20" height="14" viewBox="0 0 20 14">
        {kind === "round_table" ? (
          <circle
            cx="10"
            cy="7"
            r="4.5"
            fill="var(--paper-deep)"
            stroke="currentColor"
            strokeWidth="0.7"
          />
        ) : null}
        {kind === "square_table" ? (
          <rect
            x="4"
            y="3.5"
            width="12"
            height="7"
            rx="0.6"
            fill="var(--paper-deep)"
            stroke="currentColor"
            strokeWidth="0.7"
          />
        ) : null}
        {kind === "cushion" ? (
          <circle
            cx="10"
            cy="7"
            r="2.4"
            fill="var(--cinnabar-soft)"
            stroke="currentColor"
            strokeWidth="0.7"
          />
        ) : null}
        {kind === "stage" ? (
          <rect
            x="2"
            y="4"
            width="16"
            height="6"
            fill="var(--gold-soft)"
            stroke="var(--gold)"
            strokeWidth="0.7"
          />
        ) : null}
        {kind === "podium" ? (
          <polygon
            points="6,4 14,4 13,10 7,10"
            fill="var(--gold-soft)"
            stroke="var(--gold)"
            strokeWidth="0.7"
          />
        ) : null}
        {kind === "text_label" ? (
          <text
            x="10"
            y="9.6"
            fontFamily="var(--font-display), serif"
            fontSize="6.6"
            textAnchor="middle"
            fill="currentColor"
          >
            T
          </text>
        ) : null}
        {kind === "door" ? (
          <>
            <path
              d="M4 11 A 6 6 0 0 1 10 5"
              fill="none"
              stroke="currentColor"
              strokeWidth="0.7"
            />
            <line
              x1="4"
              y1="11"
              x2="10"
              y2="11"
              stroke="currentColor"
              strokeWidth="0.7"
              opacity="0.5"
            />
          </>
        ) : null}
        {kind === "wall" ? (
          <line
            x1="2"
            y1="7"
            x2="18"
            y2="7"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        ) : null}
      </svg>
    </span>
  );
}
