"use client";

import { useMemo } from "react";
import type { CheckInTimeBucket } from "@/lib/check-in/types";

// Pure presentational sparkline of check-in arrivals. Renders an inline
// SVG polyline with a cinnabar area fill — no chart library, no deps. The
// X axis covers the full bucket range emitted by loadArrivalBuckets (zero
// buckets included), Y is the per-bucket count auto-scaled to the visible
// max.

type Props = {
  buckets: CheckInTimeBucket[];
  width?: number;
  height?: number;
  // Optional hint text rendered top-right (e.g., "last 2h · 5 min buckets").
  hint?: string;
};

const PADDING_X = 12;
const PADDING_Y = 10;

export function Sparkline({
  buckets,
  width = 720,
  height = 140,
  hint,
}: Props) {
  const { polyline, area, peak, peakIdx, total, hourTicks } = useMemo(() => {
    if (buckets.length === 0) {
      return {
        polyline: "",
        area: "",
        peak: 0,
        peakIdx: -1,
        total: 0,
        hourTicks: [] as { x: number; label: string }[],
      };
    }

    const innerW = width - PADDING_X * 2;
    const innerH = height - PADDING_Y * 2;

    let maxCount = 0;
    let totalCount = 0;
    let peakBucketIdx = -1;
    for (let i = 0; i < buckets.length; i += 1) {
      const c = buckets[i].count;
      totalCount += c;
      if (c > maxCount) {
        maxCount = c;
        peakBucketIdx = i;
      }
    }
    const yScale = maxCount === 0 ? 0 : innerH / maxCount;

    const points: string[] = [];
    for (let i = 0; i < buckets.length; i += 1) {
      const x = PADDING_X + (i / Math.max(1, buckets.length - 1)) * innerW;
      const y = PADDING_Y + innerH - buckets[i].count * yScale;
      points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    const poly = points.join(" ");
    const baseline = PADDING_Y + innerH;
    const areaStr =
      `M${PADDING_X},${baseline.toFixed(1)} L ` + poly + ` L ${PADDING_X + innerW},${baseline.toFixed(1)} Z`;

    // Hour ticks for axis context. Walk buckets and mark every change of
    // the hour stamp.
    const ticks: { x: number; label: string }[] = [];
    let prevHour: number | null = null;
    for (let i = 0; i < buckets.length; i += 1) {
      const d = new Date(buckets[i].bucket_start);
      const hour = d.getHours();
      if (hour !== prevHour) {
        const x = PADDING_X + (i / Math.max(1, buckets.length - 1)) * innerW;
        ticks.push({
          x,
          label: d.toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }),
        });
        prevHour = hour;
      }
    }

    return {
      polyline: poly,
      area: areaStr,
      peak: maxCount,
      peakIdx: peakBucketIdx,
      total: totalCount,
      hourTicks: ticks,
    };
  }, [buckets, width, height]);

  // Empty / zero-traffic state.
  if (buckets.length === 0 || total === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[140px] py-6 text-center">
        <div className="text-[11px] tracking-[0.18em] uppercase text-[var(--ink-faint)]">
          No arrivals yet · 暂无到场
        </div>
      </div>
    );
  }

  const innerW = width - PADDING_X * 2;
  const innerH = height - PADDING_Y * 2;
  const peakLabel =
    peakIdx >= 0
      ? new Date(buckets[peakIdx].bucket_start).toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
      : null;

  return (
    <div className="w-full">
      {hint ? (
        <div className="flex items-center justify-between mb-2 text-[10.5px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
          <span>{hint}</span>
          {peakLabel ? (
            <span className="tabular-nums">
              Peak {peak} · {peakLabel}
            </span>
          ) : null}
        </div>
      ) : null}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="w-full h-auto"
        role="img"
        aria-label={`Check-in arrivals over last ${buckets.length * 5} minutes`}
      >
        <defs>
          <linearGradient id="gmc-spark-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--cinnabar)" stopOpacity="0.32" />
            <stop offset="100%" stopColor="var(--cinnabar)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Faint baseline */}
        <line
          x1={PADDING_X}
          y1={PADDING_Y + innerH}
          x2={PADDING_X + innerW}
          y2={PADDING_Y + innerH}
          stroke="var(--paper-deep)"
          strokeWidth="1"
        />
        {/* Hour grid ticks */}
        {hourTicks.map((t, i) => (
          <g key={i}>
            <line
              x1={t.x}
              y1={PADDING_Y}
              x2={t.x}
              y2={PADDING_Y + innerH}
              stroke="var(--paper-deep)"
              strokeWidth="0.5"
              strokeDasharray="2 3"
            />
            <text
              x={t.x}
              y={height - 2}
              fill="var(--ink-faint)"
              fontSize="9"
              textAnchor={i === 0 ? "start" : "middle"}
              style={{ letterSpacing: "0.08em" }}
            >
              {t.label}
            </text>
          </g>
        ))}
        {/* Area fill */}
        <path d={area} fill="url(#gmc-spark-area)" />
        {/* Line */}
        <polyline
          points={polyline}
          fill="none"
          stroke="var(--cinnabar)"
          strokeWidth="1.6"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {/* Peak dot */}
        {peakIdx >= 0 ? (
          <circle
            cx={
              PADDING_X +
              (peakIdx / Math.max(1, buckets.length - 1)) * innerW
            }
            cy={
              PADDING_Y +
              innerH -
              buckets[peakIdx].count * (innerH / Math.max(1, peak))
            }
            r="3.5"
            fill="var(--cinnabar)"
            stroke="var(--paper-warm)"
            strokeWidth="1.5"
          />
        ) : null}
      </svg>
    </div>
  );
}
