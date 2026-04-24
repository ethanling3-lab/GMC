"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// Per-thread toggle for the Tier 1 AI responder. Only shown on WhatsApp
// threads (the backend rejects enabling on other channels). Immediate POST
// on click — no confirmation modal; intent is reversible.

export function AiAssistantToggle({
  conversationId,
  initialEnabled,
  channel,
}: {
  conversationId: string;
  initialEnabled: boolean;
  channel: string;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (channel !== "whatsapp") {
    return null;
  }

  async function toggle() {
    if (busy) return;
    const next = !enabled;
    setBusy(true);
    setError(null);
    // Optimistic flip — revert on failure.
    setEnabled(next);
    try {
      const res = await fetch(`/api/admin/inbox/${conversationId}/ai/toggle`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        const detail = typeof body.detail === "string"
          ? (body.detail as string)
          : typeof body.error === "string"
            ? (body.error as string)
            : `Toggle failed (${res.status})`;
        setError(detail);
        setEnabled(!next);
        return;
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setEnabled(!next);
    } finally {
      setBusy(false);
    }
  }

  const working = busy || isPending;

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={toggle}
        disabled={working}
        aria-pressed={enabled}
        title={enabled
          ? "AI assistant is ON — inbound messages get auto-replies from Claude. Click to turn off."
          : "AI assistant is OFF — all inbound messages go to the admin queue. Click to turn on."
        }
        className={`inline-flex items-center gap-2 h-8 px-3 rounded-[var(--radius-pill)]
                    text-[10.5px] tracking-[0.18em] uppercase
                    focus-visible:shadow-[var(--shadow-focus)]
                    transition-[background-color,color,border-color] duration-[var(--dur-fast)]
                    disabled:opacity-50 disabled:cursor-not-allowed
                    ${enabled
                      ? "border border-[var(--cinnabar)]/40 bg-[var(--cinnabar)] text-[var(--paper-warm)] hover:bg-[var(--cinnabar-deep)]"
                      : "border border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-mute)] hover:text-[var(--ink)] hover:border-[var(--cinnabar)]/25"
                    }`}
      >
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full ${enabled ? "bg-[var(--paper-warm)]" : "bg-[var(--ink-faint)]"}`}
          aria-hidden="true"
        />
        {working ? "…" : enabled ? "AI on" : "AI off"}
      </button>
      {error ? (
        <span className="text-[10.5px] text-[var(--cinnabar-deep)] max-w-[160px] truncate" title={error}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
