"use client";

import type { CheckInGroupRow } from "@/lib/check-in/types";

// Compact chip-style card for one event_groups row in the dashboard's
// "per-group completion" grid. Shows group number + checked-in vs
// expected + a thin progress bar. Color-shifts to a settled green at
// 100% so the organizer can scan for stragglers.

type Props = {
  row: CheckInGroupRow;
};

export function GroupCompletionCard({ row }: Props) {
  const pct =
    row.expected_count === 0
      ? 0
      : Math.min(100, Math.round((row.checked_in_count / row.expected_count) * 100));
  const done = pct >= 100 && row.expected_count > 0;
  const idle = row.expected_count > 0 && row.checked_in_count === 0;

  const label =
    row.group_no === null
      ? row.name_cn ?? row.name_en ?? "—"
      : `#${row.group_no}`;
  const subLabel =
    row.group_no !== null && (row.name_cn || row.name_en)
      ? row.name_cn ?? row.name_en
      : null;

  return (
    <div
      className={
        "flex flex-col gap-1.5 px-3 py-2.5 rounded-[12px] border transition-colors " +
        (done
          ? "bg-[var(--cinnabar-wash)] border-[var(--cinnabar)]/30"
          : "bg-[var(--paper)] border-[var(--paper-shadow)]")
      }
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[12px] tracking-[0.04em] font-medium text-[var(--ink)] truncate">
          {label}
          {subLabel ? (
            <span className="ml-1.5 text-[var(--ink-faint)] font-normal text-[10.5px] tracking-[0.06em] uppercase">
              {subLabel}
            </span>
          ) : null}
        </div>
        <div className="text-[11px] tabular-nums text-[var(--ink-mute)]">
          {row.checked_in_count}/{row.expected_count}
        </div>
      </div>
      <div className="relative h-[4px] rounded-full bg-[var(--paper-deep)] overflow-hidden">
        <div
          className={
            "absolute inset-y-0 left-0 transition-[width] duration-300 ease-out " +
            (done
              ? "bg-[var(--cinnabar)]"
              : idle
                ? "bg-[var(--paper-shadow)]"
                : "bg-[var(--cinnabar)]")
          }
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
