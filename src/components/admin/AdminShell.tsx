"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
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
// Hydration safety: both auto-collapse and userPref-from-localStorage are
// gated on a `mounted` flag that's only set post-mount. SSR + first client
// render therefore agree (both compute false/false). After mount, both
// kick in and the existing `transition-[width]` on Sidebar animates the
// width change smoothly — reads as an intentional collapse, not a flash.
// This sidesteps the prior fragility around middleware-header propagation
// and `usePathname()` returning empty on first client render.
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

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "1") setUserPref(true);
    } catch {
      /* ignore */
    }
    setMounted(true);
  }, []);

  // Both signals gated on `mounted` so SSR + first client render render
  // an expanded nav (no auto-collapse, no localStorage read). After mount,
  // userPref reflects saved state and isInboxRoute reflects the URL.
  const isInboxRoute =
    mounted && (pathname?.startsWith("/admin/inbox") ?? false);
  const effectiveCollapsed = userPref || isInboxRoute;

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
