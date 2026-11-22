"use client";

import { useEffect, useState } from "react";
import { groupNumber } from "@/lib/group-number";
import { EVENT_TZ } from "@/lib/check-in/day";
import type { ExitTotalRow, OutNowRow } from "@/lib/check-in/types";

// Out of class · 课堂外出 — who is out right now (minutes ticking) and the
// day's per-person totals. Only trips a desk logged on Out/Back appear here,
// so official breaks on stage are simply never scanned.

type Props = {
  outNow: OutNowRow[];
  totals: ExitTotalRow[];
  isToday: boolean;
};

const TICK_MS = 15_000;

function minutesSince(iso: string, now: number): number {
  return Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
}

export function OutOfClassPanel({ outNow, totals, isToday }: Props) {
  // Starts null so the server render and first client render agree; the
  // minutes fill in on mount and tick from there.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(t);
  }, []);

  const sortedOut = [...outNow].sort((a, b) => a.out_at.localeCompare(b.out_at));
  const noReturn = totals.filter((t) => t.no_return > 0).length;

  return (
    <section className="bg-[var(--paper-warm)] border border-[var(--paper-deep)] rounded-[var(--radius-card)] shadow-[var(--shadow-paper)] overflow-hidden">
      <div className="px-5 pt-4 pb-3">
        <h2 className="text-[13px] font-medium text-[var(--ink)]">Out of class · 课堂外出</h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] border-t border-[var(--paper-deep)]/70">
        {/* Out now */}
        <div className="lg:border-r border-[var(--paper-deep)]/70">
          <div className="px-5 pt-3 pb-2 flex items-baseline justify-between">
            <h3 className="text-[12.5px] font-medium text-[var(--ink-soft)]">Out now · 目前在外</h3>
            <span className="text-[12px] text-[var(--ink-faint)] tabular-nums">{sortedOut.length}</span>
          </div>
          {!isToday ? (
            <EmptyLine>Live list shows on today&apos;s view · 仅今天显示</EmptyLine>
          ) : sortedOut.length === 0 ? (
            <EmptyLine>Everyone&apos;s in class · 全员在课室</EmptyLine>
          ) : (
            <ul className="divide-y divide-[var(--paper-deep)]/70 max-h-[420px] overflow-y-auto">
              {sortedOut.map((r) => {
                const mins = now === null ? null : minutesSince(r.out_at, now);
                const g = groupNumber(r);
                return (
                  <li
                    key={r.exit_id}
                    className="px-5 py-2.5 flex items-center gap-3"
                  >
                    <div className="flex-1 min-w-0 leading-tight">
                      <div className="text-[13.5px] font-medium text-[var(--ink)] truncate">
                        {r.name_cn ?? r.name_en ?? "(unnamed)"}
                      </div>
                      <div className="text-[11.5px] text-[var(--ink-faint)] tabular-nums truncate">
                        {[
                          g.no !== null ? g.en : "No group",
                          r.region_id,
                          `out ${formatTime(r.out_at)}`,
                          r.not_checked_in ? "not checked in · 未签到" : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                    <div
                      className="text-right font-display text-[24px] leading-none tabular-nums text-[var(--gold-deep,#A87A2A)]"
                    >
                      {mins ?? "–"}
                      <span className="ml-0.5 text-[11px] font-sans">min</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Day totals */}
        <div className="border-t lg:border-t-0 border-[var(--paper-deep)]/70">
          <div className="px-5 pt-3 pb-2 flex items-baseline justify-between">
            <h3 className="text-[12.5px] font-medium text-[var(--ink-soft)]">Day totals · 当日合计</h3>
            <span className="text-[12px] text-[var(--ink-faint)] tabular-nums">
              {totals.length} people{noReturn ? ` · ${noReturn} didn't scan back` : ""}
            </span>
          </div>
          {totals.length === 0 ? (
            <EmptyLine>No one has left class · 没有外出记录</EmptyLine>
          ) : (
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full text-[12.5px] tabular-nums">
                <thead className="sticky top-0 bg-[var(--paper-warm)] text-[11.5px] text-[var(--ink-faint)]">
                  <tr className="text-left">
                    <th className="font-normal px-5 py-1.5">Name · 姓名</th>
                    <th className="font-normal px-2 py-1.5 text-right">Trips</th>
                    <th className="font-normal px-2 py-1.5 text-right">Total</th>
                    <th className="font-normal px-2 py-1.5 text-right">Longest</th>
                    <th className="font-normal px-5 py-1.5">Flags</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--paper-deep)]/70">
                  {totals.map((t) => {
                    const g = groupNumber(t);
                    return (
                      <tr key={t.enrollment_id}>
                        <td className="px-5 py-2 min-w-[140px]">
                          <div className="font-medium text-[var(--ink)] truncate max-w-[200px]">
                            {t.name_cn ?? t.name_en ?? "(unnamed)"}
                          </div>
                          <div className="text-[11px] text-[var(--ink-faint)]">
                            {[g.no !== null ? g.en : null, t.region_id].filter(Boolean).join(" · ")}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-right text-[var(--ink-soft)]">{t.trips}</td>
                        <td className="px-2 py-2 text-right text-[var(--ink)] font-medium">{t.total_minutes} min</td>
                        <td className="px-2 py-2 text-right text-[var(--ink-soft)]">{t.longest_minutes} min</td>
                        <td className="px-5 py-2">
                          <div className="flex flex-wrap gap-1">
                            {t.still_out ? <Flag tone="gold">Out now</Flag> : null}
                            {t.no_return > 0 ? (
                              <Flag tone="grey">
                                Didn&apos;t scan back{t.no_return > 1 ? ` ×${t.no_return}` : ""}
                              </Flag>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Flag({ tone, children }: { tone: "gold" | "grey"; children: React.ReactNode }) {
  const cls =
    tone === "gold" ? "bg-[#A87A2A]/15 text-[#7A5718]" : "bg-[var(--paper-deep)] text-[var(--ink-mute)]";
  return (
    <span className={`inline-flex items-center h-[20px] px-2 rounded-full text-[11px] whitespace-nowrap ${cls}`}>
      {children}
    </span>
  );
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return <div className="px-5 py-8 text-center text-[12.5px] text-[var(--ink-faint)]">{children}</div>;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: EVENT_TZ,
    });
  } catch {
    return "—";
  }
}

