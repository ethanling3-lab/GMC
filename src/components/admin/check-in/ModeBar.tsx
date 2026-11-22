"use client";

import { useState } from "react";
import {
  CHECK_IN_MODES,
  MODE_LABEL,
  isClass,
  type CheckInMode,
} from "@/lib/check-in/mode";
import { useCenterSelected } from "@/lib/check-in/use-center-selected";

// The event's live desk mode, in the order a day runs. Organizers
// (super_admin / regional_lead) switch it here and every desk follows on its
// next poll; desk staff see which mode they're in but can't change it.
//
// Leaving a class while people are still out closes their trips as "didn't
// scan back", so that switch asks first.

type Props = {
  eventId: string;
  mode: CheckInMode;
  canRun: boolean;
  /** People out of class right now — closed if the organizer leaves class. */
  outNowCount: number;
  onChanged: () => void;
};

function tone(mode: CheckInMode): { bg: string; border: string } {
  if (isClass(mode)) return { bg: "var(--gold-deep,#A87A2A)", border: "var(--gold-deep,#A87A2A)" };
  if (mode === "break") return { bg: "var(--ink-soft)", border: "var(--ink-soft)" };
  return { bg: "var(--cinnabar)", border: "var(--cinnabar)" };
}

export function ModeBar({ eventId, mode, canRun, outNowCount, onChanged }: Props) {
  const [pending, setPending] = useState<CheckInMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rowRef = useCenterSelected<HTMLDivElement>('[aria-checked="true"]', mode);

  const switchTo = async (next: CheckInMode) => {
    if (next === mode || pending) return;
    if (isClass(mode) && outNowCount > 0) {
      const n = outNowCount;
      const ok = window.confirm(
        `${n} ${n === 1 ? "person is" : "people are"} still out of class. ` +
          `Switching will mark ${n === 1 ? "them" : "them all"} "didn't scan back".\n` +
          `${n} 人仍在外，切换后将记为"未扫回"。继续？`,
      );
      if (!ok) return;
    }
    setPending(next);
    setError(null);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/check-in/mode`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: next }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(json?.error ?? `HTTP ${res.status}`);
        return;
      }
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setPending(null);
    }
  };

  if (!canRun) {
    const t = tone(mode);
    return (
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--ink-mute)]">
        Desk mode · 当前模式
        <span
          className="inline-flex items-center h-8 px-3.5 rounded-[var(--radius-pill)] text-[13px] font-medium text-[var(--paper)]"
          style={{ background: t.bg }}
        >
          {MODE_LABEL[mode].en} · {MODE_LABEL[mode].cn}
        </span>
        <span className="text-[11.5px] text-[var(--ink-faint)]">Set by the organizer · 由主办方切换</span>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 text-[12px] text-[var(--ink-mute)]">
        Desk mode — every desk follows · 当前模式（所有签到台同步）
      </div>
      <div
        ref={rowRef}
        role="radiogroup"
        aria-label="Desk mode"
        className="-mx-4 px-4 flex gap-1.5 overflow-x-auto pb-1 sm:mx-0 sm:px-0 sm:flex-wrap sm:overflow-visible"
      >
        {CHECK_IN_MODES.map((m) => {
          const active = m === mode;
          const t = tone(m);
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={pending !== null}
              onClick={() => void switchTo(m)}
              className={`shrink-0 inline-flex flex-col items-start justify-center min-h-[48px] px-4 py-1.5 rounded-[12px] border text-left whitespace-nowrap focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] active:translate-y-px disabled:cursor-wait transition-[background-color,border-color,color,transform] duration-[var(--dur-fast)] ${
                active
                  ? "text-[var(--paper)]"
                  : "bg-[var(--paper)] border-[var(--paper-shadow)] text-[var(--ink-soft)] hover:border-[var(--ink-faint)] hover:text-[var(--ink)]"
              }`}
              style={active ? { background: t.bg, borderColor: t.border } : undefined}
            >
              <span className="text-[13px] font-medium leading-tight">
                {pending === m ? "Switching…" : MODE_LABEL[m].en}
              </span>
              <span className={`text-[11.5px] leading-tight ${active ? "opacity-85" : "text-[var(--ink-faint)]"}`}>
                {MODE_LABEL[m].cn}
              </span>
            </button>
          );
        })}
      </div>
      {error ? (
        <div role="alert" className="mt-2 text-[12px] text-[#B91C1C]">
          Couldn&apos;t switch mode · 切换失败 ({error})
        </div>
      ) : null}
    </div>
  );
}
