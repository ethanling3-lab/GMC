"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

// Replaces the placeholder bell that shipped with title="Notifications
// (coming in M7)" — a button that looked like a feature and did nothing, with
// a permanent red dot suggesting there was always something to see.
//
// Backed by admin_notifications (migration 054) and subscribed to realtime, so
// an alert arrives without a reload. This is the surface that would have caught
// both incidents: a colleague's message sitting unanswered, and two months of
// AI replies failing with 401/190.

type Notification = {
  id: string;
  kind: "new_inbound" | "ai_handoff" | "send_failed";
  conversation_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  read_at: string | null;
};

const KIND_LABEL: Record<Notification["kind"], { en: string; cn: string }> = {
  new_inbound: { en: "New message", cn: "新消息" },
  ai_handoff: { en: "AI handed off", cn: "AI 转人工" },
  send_failed: { en: "Send failed", cn: "发送失败" },
};

// send_failed is the only one that reads as a fault; the other two are work
// arriving. Keeping them visually distinct matters because a run of failures
// should be recognisable at a glance without reading a word.
const KIND_TONE: Record<Notification["kind"], string> = {
  new_inbound: "bg-[var(--cinnabar)]",
  ai_handoff: "bg-[var(--gold)]",
  send_failed: "bg-[#C2410C]",
};

export function NotificationBell() {
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/notifications", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { notifications?: Notification[] };
      setItems(body.notifications ?? []);
    } catch {
      // Offline or route unavailable — leave the previous list in place rather
      // than blanking it, which would read as "all clear".
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Realtime: refetch on insert rather than appending the payload directly, so
  // the list always reflects what RLS actually permits this admin to see.
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel("admin-notifications")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "admin_notifications" },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const unread = items.filter((n) => n.read_at === null).length;

  const markAllRead = useCallback(async () => {
    setItems((prev) =>
      prev.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() })),
    );
    try {
      await fetch("/api/admin/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
    } catch {
      void load();
    }
  }, [load]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="relative inline-flex items-center justify-center w-8 h-8 rounded-full
                   text-[var(--ink-mute)] hover:text-[var(--cinnabar)]
                   hover:bg-[var(--cinnabar-wash)]
                   focus-visible:shadow-[var(--shadow-focus)]
                   transition-[background-color,color] duration-[var(--dur-fast)]"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3.5 10V7a3.5 3.5 0 1 1 7 0v3l1 1.3H2.5L3.5 10z" />
          <path d="M5.7 11.8a1.3 1.3 0 0 0 2.6 0" />
        </svg>
        {/* Only shown when something is actually unread — the old dot was
            permanent, which taught everyone to ignore it. */}
        {unread > 0 ? (
          <span
            className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-1
                       inline-flex items-center justify-center rounded-full
                       bg-[var(--cinnabar)] text-[var(--paper-warm)]
                       text-[9px] font-semibold tabular-nums leading-none
                       shadow-[0_0_0_2px_var(--paper-warm)]"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 top-10 z-50 w-[320px] max-h-[70vh] overflow-y-auto
                     rounded-[var(--radius-lg)] border border-[var(--paper-shadow)]
                     bg-[var(--paper-warm)] shadow-[var(--shadow-paper-3)]"
        >
          <div className="flex items-center justify-between px-4 pt-3 pb-2">
            <span className="text-[9.5px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
              Notifications · 通知
            </span>
            {unread > 0 ? (
              <button
                type="button"
                onClick={markAllRead}
                className="text-[11px] text-[var(--cinnabar-deep)] hover:underline"
              >
                Mark all read
              </button>
            ) : null}
          </div>

          <div className="h-px bg-[var(--paper-shadow)] mx-3" />

          {!loaded ? (
            <div className="px-4 py-6 text-[12px] text-[var(--ink-faint)]">Loading…</div>
          ) : items.length === 0 ? (
            <div className="px-4 py-6 text-[12px] text-[var(--ink-mute)] leading-[1.6]">
              Nothing needs you right now. New messages, AI handoffs and failed
              sends appear here.
            </div>
          ) : (
            <ul className="flex flex-col py-1">
              {items.map((n) => {
                const label = KIND_LABEL[n.kind] ?? { en: n.kind, cn: "" };
                const preview =
                  typeof n.payload?.preview === "string" ? n.payload.preview : null;
                const reason =
                  typeof n.payload?.reason === "string" ? n.payload.reason : null;
                const err = typeof n.payload?.error === "string" ? n.payload.error : null;
                const detail = preview ?? reason ?? err;

                const body = (
                  <>
                    <span className="flex items-center gap-2">
                      <span
                        className={`flex-none w-1.5 h-1.5 rounded-full ${KIND_TONE[n.kind]}`}
                        aria-hidden="true"
                      />
                      <span
                        className={`text-[12.5px] ${
                          n.read_at ? "text-[var(--ink-soft)]" : "font-medium text-[var(--ink)]"
                        }`}
                      >
                        {label.en}
                      </span>
                      <span className="text-[10px] tracking-[0.14em] uppercase text-[var(--ink-faint)]">
                        {label.cn}
                      </span>
                    </span>
                    {detail ? (
                      <span className="mt-0.5 block text-[11.5px] text-[var(--ink-mute)] truncate">
                        {detail}
                      </span>
                    ) : null}
                  </>
                );

                return (
                  <li key={n.id}>
                    {n.conversation_id ? (
                      <Link
                        href={`/admin/inbox/${n.conversation_id}`}
                        onClick={() => setOpen(false)}
                        className="block px-4 py-2.5 hover:bg-[var(--paper-deep)]
                                   transition-[background-color] duration-[var(--dur-fast)]"
                      >
                        {body}
                      </Link>
                    ) : (
                      <div className="px-4 py-2.5">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
