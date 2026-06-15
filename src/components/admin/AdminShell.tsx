"use client";

import { useEffect, useState } from "react";
import { usePathname, useSelectedLayoutSegment } from "next/navigation";
import type { AdminContext } from "@/lib/admin-guard";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { BreadcrumbProvider } from "./BreadcrumbContext";

const STORAGE_KEY = "gmc-admin-sidebar-collapsed";

// AdminShell composes the chrome:
//   [ main nav ] [ topbar + main content ]
//
// Main nav has two stacking sources of "should I be collapsed":
//   1. User pref (localStorage `gmc-admin-sidebar-collapsed`)
//   2. Auto-collapse on /admin/inbox/* (so the inbox sub-nav + list +
//      thread + right rail have horizontal room)
// `effective = userPref || isInboxRoute`. Auto-collapse never writes
// localStorage — leaving inbox restores the user's saved width.
//
// Hydration safety:
//   - Auto-collapse on inbox reads `useSelectedLayoutSegment()` — the route
//     segment is resolved from the server-rendered tree, so SSR + client agree
//     and the inbox renders correctly-collapsed on first paint. This is the
//     Next-documented zero-hydration-risk pattern; it replaced the fragile
//     `usePathname()` approach (unreliable here due to middleware request
//     mutation + the inbox `@sidebar`/`@list` parallel routes).
//   - userPref-from-localStorage is still gated on a post-mount `mounted` flag
//     because it's a genuinely client-only read; when it flips, the existing
//     `transition-[width]` on Sidebar animates smoothly.
//
// The inbox sub-nav lives inside `inbox/layout.tsx` as an `@sidebar`
// parallel slot scoped to inbox routes only — it unmounts cleanly when
// the user navigates away. AdminShell stays oblivious.

export function AdminShell({
  admin,
  children,
}: {
  admin: AdminContext;
  children: React.ReactNode;
}) {
  const [userPref, setUserPref] = useState(false);
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();
  const segment = useSelectedLayoutSegment();

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "1") setUserPref(true);
    } catch {
      /* ignore */
    }
    setMounted(true);
  }, []);

  // Auto-collapse on inbox reads the route SEGMENT (deterministic on server +
  // client → renders correctly-collapsed on first paint, no width flash and no
  // hydration mismatch). `userPref` stays gated on `mounted` because it's a
  // genuinely client-only localStorage read.
  const isInboxRoute = segment === "inbox";
  const effectiveCollapsed = (mounted && userPref) || isInboxRoute;

  // Defensive cleanup on every route change. With React 19 transitions +
  // portaled dialog modals (createPortal to document.body), there's a small
  // window where a dialog component can unmount but its portal child stays
  // attached to body — leaving an invisible fixed-inset backdrop that
  // intercepts every click on the new page (sidebar nav becomes dead).
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.style.overflow = "";
    document
      .querySelectorAll('body > [role="dialog"]')
      .forEach((el) => el.remove());
  }, [pathname]);

  function toggle() {
    setUserPref((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  return (
    <BreadcrumbProvider>
      <div
        className="min-h-[100dvh] flex bg-[var(--paper)]"
        data-hydrated={mounted ? "true" : "false"}
      >
        <Sidebar admin={admin} collapsed={effectiveCollapsed} onToggle={toggle} />

        <div className="flex-1 min-w-0 flex flex-col">
          <TopBar />
          <main
            className="flex-1 min-w-0 relative"
            style={{
              backgroundImage:
                "radial-gradient(900px 500px at 92% -10%, rgba(37,99,235,0.05), transparent 60%)," +
                "radial-gradient(700px 420px at -4% 110%, rgba(122,143,179,0.05), transparent 65%)",
            }}
          >
            <div className="px-6 md:px-10 py-10">{children}</div>
          </main>
        </div>
      </div>
    </BreadcrumbProvider>
  );
}
