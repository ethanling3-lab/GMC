"use client";

import { useState } from "react";
import {
  CHECK_IN_MODES,
  MODE_LABEL,
  type CheckInMode,
} from "@/lib/check-in/mode";
import { useCenterSelected } from "@/lib/check-in/use-center-selected";

// Which registration is on: Morning or Afternoon. Organizers (super_admin /
// regional_lead) switch it here and every desk follows on its next poll; desk
// staff see which one they're in but can't change it. Moving on closes any
// trips still open as "didn't scan back", so that switch asks first.

type Props = {
  eventId: string;
  mode: CheckInMode;
  canRun: boolean;
  /** People out of class right now — closed if the session changes. */
  outNowCount: number;
  onChanged: () => void;
};

export function ModeBar({ eventId, mode, canRun, outNowCount, onChanged }: Props) {
  const [pending, setPending] = useState<CheckInMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rowRef = useCenterSelected<HTMLDivElement>('[aria-checked="true"]', mode);

  const switchTo = async (next: CheckInMode) => {
    if (next === mode || pending) return;
    if (outNowCount > 0) {
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
    return (
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--ink-mute)]">
        Registration now · 当前签到
        <span
          className="inline-flex items-center h-8 px-3.5 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] text-[13px] font-medium text-[var(--paper)]"
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
        Registration now — every desk follows · 当前签到（所有签到台同步）
      </div>
      <div
        ref={rowRef}
        role="radiogroup"
        aria-label="Registration now"
        className="-mx-4 px-4 flex gap-1.5 overflow-x-auto pb-1 sm:mx-0 sm:px-0 sm:flex-wrap sm:overflow-visible"
      >
        {CHECK_IN_MODES.map((m) => {
          const active = m === mode;
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
                  ? "bg-[var(--cinnabar)] border-[var(--cinnabar)] text-[var(--paper)]"
                  : "bg-[var(--paper)] border-[var(--paper-shadow)] text-[var(--ink-soft)] hover:border-[var(--ink-faint)] hover:text-[var(--ink)]"
              }`}
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
          Couldn&apos;t switch registration · 切换失败 ({error})
        </div>
      ) : null}
    </div>
  );
}
