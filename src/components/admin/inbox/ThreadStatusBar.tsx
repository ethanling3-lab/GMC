"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// Who is looking after this chat, and the one or two things staff can do about
// it. Replaces the separate AI toggle and status pill.

type Busy = "ai" | "status" | null;

const quietBtn =
  "inline-flex items-center h-8 px-3 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[12px] text-[var(--ink-soft)] whitespace-nowrap hover:text-[var(--ink)] hover:border-[var(--cinnabar)]/30 active:translate-y-px focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] disabled:opacity-50 disabled:cursor-not-allowed transition-[border-color,color,transform] duration-[var(--dur-fast)]";

const mainBtn =
  "inline-flex items-center h-8 px-3.5 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] text-[12px] font-medium text-[var(--paper-warm)] whitespace-nowrap hover:bg-[var(--cinnabar-deep)] active:translate-y-px focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] disabled:opacity-50 disabled:cursor-not-allowed transition-[background-color,transform] duration-[var(--dur-fast)]";

export function ThreadStatusBar({
  conversationId,
  status,
  aiEnabled,
  channel,
  canWrite,
}: {
  conversationId: string;
  status: string;
  aiEnabled: boolean;
  channel: string;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const working = busy !== null || isPending;

  const done = status === "closed";
  const hasAi = channel === "whatsapp";
  const aiReplying = hasAi && aiEnabled && !done;

  async function post(kind: Exclude<Busy, null>, path: string, body: unknown, failure: string) {
    if (working) return;
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch(`/api/admin/inbox/${conversationId}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError(failure);
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setError(failure);
    } finally {
      setBusy(null);
    }
  }

  const label = done
    ? "Done · 已完成"
    : aiReplying
      ? "AI is replying · AI回复中"
      : "Staff replying · 人工回复";

  return (
    <div className="flex items-center gap-2 flex-wrap justify-end">
      <span role="status" className="inline-flex items-center gap-1.5 text-[12px] text-[var(--ink-soft)] whitespace-nowrap">
        <span
          aria-hidden="true"
          className={`w-1.5 h-1.5 rounded-full ${
            done ? "bg-[var(--ink-faint)]" : aiReplying ? "bg-[var(--cinnabar)]" : "bg-[#A87A2A]"
          }`}
        />
        {label}
      </span>
      {canWrite ? (
        done ? (
          <button
            type="button"
            disabled={working}
            onClick={() => void post("status", "status", { status: "open" }, "Couldn't reopen. Try again.")}
            className={mainBtn}
          >
            {busy === "status" ? "Reopening…" : "Reopen · 重新打开"}
          </button>
        ) : (
          <>
            {hasAi ? (
              <button
                type="button"
                disabled={working}
                onClick={() =>
                  void post(
                    "ai",
                    "ai/toggle",
                    { enabled: !aiEnabled },
                    aiEnabled ? "Couldn't take over. Try again." : "Couldn't hand back. Try again.",
                  )
                }
                title={
                  aiEnabled
                    ? "Stop the AI replying in this chat so you can answer"
                    : "Let the AI answer this customer's next messages"
                }
                className={aiEnabled ? mainBtn : quietBtn}
              >
                {busy === "ai" ? "Saving…" : aiEnabled ? "Take over · 接手" : "Hand back to AI · 交回AI"}
              </button>
            ) : null}
            <button
              type="button"
              disabled={working}
              onClick={() => void post("status", "status", { status: "closed" }, "Couldn't mark done. Try again.")}
              className={quietBtn}
            >
              {busy === "status" ? "Saving…" : "Mark done · 完成"}
            </button>
          </>
        )
      ) : null}
      {error ? (
        <span role="alert" className="basis-full text-right text-[11.5px] text-[#B91C1C]">
          {error}
        </span>
      ) : null}
    </div>
  );
}
