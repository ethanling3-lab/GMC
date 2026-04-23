"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { channelLabel } from "@/lib/inbox/format";
import { ChannelGlyph } from "./ChannelGlyph";

// Reply composer. Wave 2a scope — text only, single-step send, no AI draft
// chip yet (that lands in 2b alongside autopilot + queue).
//
// UX:
//   - Enter to send, Shift+Enter for newline
//   - Optimistic: we clear the textarea immediately and show a "sending…" line;
//     router.refresh() pulls the real message row back from the server
//   - On send failure, textarea is restored + error banner
//   - Auto-resize up to ~8 lines
//   - Disables when conversation is closed

export function MessageComposer({
  conversationId,
  channel,
  disabled = false,
  disabledReason,
}: {
  conversationId: string;
  channel: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Auto-grow the textarea. Cap the growth so the thread above stays visible.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  async function send() {
    const body = value.trim();
    if (!body || sending || disabled) return;
    const snapshot = value;
    setSending(true);
    setError(null);
    setValue("");
    try {
      const res = await fetch(
        `/api/admin/inbox/${conversationId}/messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body_text: body }),
        },
      );
      const payload = await res
        .json()
        .catch(() => ({}) as Record<string, unknown>);
      if (!res.ok) {
        const detail =
          typeof (payload as { detail?: unknown }).detail === "string"
            ? (payload as { detail: string }).detail
            : typeof (payload as { error?: unknown }).error === "string"
              ? (payload as { error: string }).error
              : `Send failed (${res.status})`;
        setError(detail);
        setValue(snapshot);
        return;
      }
      // If the provider reported a soft failure (e.g. creds mocked, template
      // required outside the 24-hour window), still surface it so admin knows.
      const softError =
        typeof (payload as { error?: unknown }).error === "string"
          ? (payload as { error: string }).error
          : null;
      if (softError) setError(softError);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setValue(snapshot);
    } finally {
      setSending(false);
    }
  }

  const busy = sending || isPending;

  if (disabled) {
    return (
      <div className="border-t border-[var(--paper-shadow)] bg-[var(--paper)]/60 px-5 py-4 text-[11.5px] tracking-[0.16em] uppercase text-[var(--ink-faint)] flex items-center gap-2">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
          <circle cx="6" cy="6" r="4.5" />
          <path d="M4 6h4M6 4v4" />
        </svg>
        {disabledReason ?? "Replying is disabled for this thread"}
      </div>
    );
  }

  return (
    <div className="border-t border-[var(--paper-shadow)] bg-[var(--paper-warm)] px-5 py-4">
      <div className="flex items-start gap-3">
        <div
          className="flex-none mt-2 w-8 h-8 rounded-full border border-[var(--paper-shadow)] bg-[var(--paper)] flex items-center justify-center text-[var(--cinnabar)]"
          title={channelLabel(channel)}
          aria-hidden="true"
        >
          <ChannelGlyph channel={channel} size={12} />
        </div>
        <div className="flex-1 min-w-0">
          <label className="sr-only" htmlFor="inbox-composer">
            Reply
          </label>
          <textarea
            id="inbox-composer"
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={`Reply via ${channelLabel(channel)}… (Shift+Enter for newline)`}
            rows={2}
            disabled={busy}
            className="block w-full resize-none bg-[var(--paper)] border border-[var(--paper-shadow)]
                       rounded-[var(--radius-md)] px-3.5 py-2.5
                       text-[13.5px] leading-[1.55] text-[var(--ink)]
                       placeholder:text-[var(--ink-faint)]
                       focus:outline-none focus:border-[var(--cinnabar)]/40
                       focus:shadow-[var(--shadow-focus)]
                       transition-[border-color,box-shadow] duration-[var(--dur-fast)]
                       disabled:opacity-60"
          />
          {error ? (
            <div className="mt-2 rounded-[var(--radius-md)] border border-[var(--cinnabar)]/30 bg-[var(--cinnabar-wash)] px-3 py-2 text-[12px] text-[var(--cinnabar-deep)] break-words">
              {error}
            </div>
          ) : null}
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-[10.5px] tracking-[0.18em] uppercase text-[var(--ink-faint)]">
              AI drafts · flight extract ship in Wave 2b
            </span>
            <button
              type="button"
              onClick={send}
              disabled={busy || value.trim().length === 0}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-[var(--radius-pill)]
                         border border-[var(--cinnabar)]/40 bg-[var(--cinnabar)] text-[var(--paper-warm)]
                         text-[12px] tracking-[0.04em] font-medium
                         hover:bg-[var(--cinnabar-deep)]
                         focus-visible:shadow-[var(--shadow-focus)]
                         disabled:opacity-40 disabled:cursor-not-allowed
                         transition-[background-color,opacity] duration-[var(--dur-fast)]"
            >
              {busy ? "Sending…" : "Send"}
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2 5.5h7M6 2l3 3.5-3 3.5" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
