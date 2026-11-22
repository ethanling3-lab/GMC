"use client";

import { useState } from "react";

// Organizer-only check-in settings, folded away under the desk: Test mode
// (lets desks scan outside the event dates; everything recorded is marked
// as test) and clearing test records.

type Props = {
  eventId: string;
  testMode: boolean;
  onChanged: () => void;
};

export function CheckInSettings({ eventId, testMode, onChanged }: Props) {
  const [busy, setBusy] = useState<"test" | "clear" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const setTestMode = async (next: boolean) => {
    setBusy("test");
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/check-in/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test_mode: next }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        setMessage(`Couldn't save · 保存失败 (${json?.error ?? res.status})`);
        return;
      }
      setMessage("Saved · 已保存");
      // A test-mode change alters which days exist, so reload the page.
      window.location.reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Network error");
    } finally {
      setBusy(null);
    }
  };

  const toggleTest = () => {
    const next = !testMode;
    const ok = window.confirm(
      next
        ? "Turn on Test mode? Desks can scan on any day, and everything recorded is marked as test.\n开启测试模式？任何日期都可签到，记录将标记为测试。"
        : "Turn off Test mode? Outside the event dates, desks will be locked again.\n关闭测试模式？活动日期以外将无法签到。",
    );
    if (ok) void setTestMode(next);
  };

  const clearTest = async () => {
    if (
      !window.confirm(
        "Delete every test record for this event? Real records are kept.\n删除本活动所有测试记录？正式记录不受影响。",
      )
    ) {
      return;
    }
    setBusy("clear");
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/check-in/test-data`, { method: "DELETE" });
      const json = (await res.json().catch(() => null)) as
        | { deleted?: { check_ins: number; class_exits: number }; error?: string }
        | null;
      if (!res.ok || !json?.deleted) {
        setMessage(`Couldn't clear · 清除失败 (${json?.error ?? res.status})`);
        return;
      }
      const n = json.deleted.check_ins + json.deleted.class_exits;
      setMessage(`Cleared ${n} test record${n === 1 ? "" : "s"} · 已清除`);
      onChanged();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Network error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <details className="group rounded-[var(--radius-card)] border border-[var(--paper-deep)] bg-[var(--paper)]">
      <summary className="cursor-pointer list-none px-5 py-3.5 flex items-center justify-between gap-3 text-[13px] font-medium text-[var(--ink)] rounded-[var(--radius-card)] focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] hover:bg-[var(--paper-warm)] transition-[background-color]">
        <span>
          Check-in settings · 签到设置
          <span className="ml-2 font-normal text-[12px] text-[var(--ink-faint)]">Organizers only</span>
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          className="text-[var(--ink-faint)] transition-transform duration-[var(--dur-fast)] group-open:rotate-180"
          aria-hidden="true"
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </summary>
      <div className="px-5 pb-5 pt-1 grid gap-5 md:grid-cols-2 text-[13px]">
        <div>
          <div className="font-medium text-[var(--ink)]">Test mode · 测试模式</div>
          <p className="mt-1 text-[12px] leading-[1.55] text-[var(--ink-soft)]">
            Lets desks scan outside the event dates for a rehearsal. Records are marked as test.
          </p>
          <button
            type="button"
            role="switch"
            aria-checked={testMode}
            onClick={toggleTest}
            disabled={busy !== null}
            className="mt-3 inline-flex items-center gap-2.5 h-9 pl-1.5 pr-3.5 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] text-[12.5px] text-[var(--ink-soft)] hover:border-[var(--ink-faint)] active:translate-y-px disabled:opacity-60 focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] transition-[border-color,transform]"
          >
            <span
              className={`relative w-9 h-[22px] rounded-full transition-[background-color] duration-[var(--dur-fast)] ${
                testMode ? "bg-[var(--gold-deep,#A87A2A)]" : "bg-[var(--paper-shadow)]"
              }`}
            >
              <span
                className={`absolute top-[3px] left-[3px] w-4 h-4 rounded-full bg-[var(--paper)] transition-transform duration-[var(--dur-fast)] ${
                  testMode ? "translate-x-[14px]" : ""
                }`}
              />
            </span>
            {testMode ? "On · 开" : "Off · 关"}
          </button>
        </div>

        <div>
          <div className="font-medium text-[var(--ink)]">Test records · 测试记录</div>
          <p className="mt-1 text-[12px] leading-[1.55] text-[var(--ink-soft)]">
            Delete everything recorded in Test mode before the real event.
          </p>
          <button
            type="button"
            onClick={() => void clearTest()}
            disabled={busy !== null}
            className="mt-3 inline-flex items-center h-9 px-3.5 rounded-[var(--radius-pill)] border border-[#B91C1C]/40 text-[12.5px] text-[#B91C1C] hover:bg-[#B91C1C]/[0.06] active:translate-y-px disabled:opacity-50 focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] transition-[background-color,transform]"
          >
            {busy === "clear" ? "Clearing…" : "Clear test data · 清除测试记录"}
          </button>
        </div>

        {message ? (
          <div role="status" className="md:col-span-2 text-[12.5px] text-[var(--ink-soft)]">
            {message}
          </div>
        ) : null}
      </div>
    </details>
  );
}
