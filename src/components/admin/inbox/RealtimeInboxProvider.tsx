"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

// Live inbox updates.
//
// Before this, the inbox had no live updates of any kind — no subscription, no
// polling, no SSE. Every mutation went through router.refresh(), so an inbound
// WhatsApp message did not appear until an admin happened to navigate or hit
// reload. That is how a colleague's message sat unanswered: nothing was broken,
// nothing said anything.
//
// WHY router.refresh() RATHER THAN PATCHING CLIENT STATE
//
// The list is server-rendered and carries per-admin unread counts, RLS-filtered
// visibility, and URL-driven filters. Reproducing that in client state would
// mean a second implementation of loadConversations that could disagree with
// the first. Instead the realtime event is used purely as a *signal* — "your
// data is stale" — and the server stays the single source of truth. The
// existing startTransition(router.refresh()) idiom is reused rather than
// replaced.
//
// The cost is a round-trip per event instead of an instant local patch. At GMC
// inbox volumes that is the right trade; if it ever isn't, the fix is
// optimistic patching *on top of* this, not instead of it.
//
// DEBOUNCE
//
// A person sending four rapid WhatsApp messages produces four INSERTs. Without
// coalescing that is four refreshes racing each other. Events inside the window
// collapse into one refresh, trailing-edge so the last message is included.

const REFRESH_DEBOUNCE_MS = 700;

export function RealtimeInboxProvider() {
  const router = useRouter();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    const scheduleRefresh = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        router.refresh();
      }, REFRESH_DEBOUNCE_MS);
    };

    const channel = supabase
      .channel("inbox-live")
      // New messages — inbound arrivals and our own outbound alike, so a send
      // from another tab or another staff member shows up here too.
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        scheduleRefresh,
      )
      // Conversation changes — status, assignment, ai_enabled, and the
      // last_message_at/preview cursor the list sorts on.
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "conversations" },
        scheduleRefresh,
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "conversations" },
        scheduleRefresh,
      )
      .subscribe((status) => {
        // Surface subscription failure rather than degrading silently — a
        // realtime layer that quietly stops working recreates the exact problem
        // it was built to solve.
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn(
            "[inbox] realtime subscription %s — list will not update live until reload",
            status,
          );
        }
      });

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      void supabase.removeChannel(channel);
    };
  }, [router]);

  return null;
}
