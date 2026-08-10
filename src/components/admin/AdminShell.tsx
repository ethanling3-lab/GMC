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
//   - The active route segment is derived SERVER-SIDE from the `x-pathname`
//     middleware header (`initialSegment` prop) and used for SSR + the first
//     client render, so the HTML matches and there is no hydration mismatch.
//     `useSelectedLayoutSegment()` is NOT trusted for the initial render: in
//     this Next build it resolves to `null` during SSR, then the real segment
//     on the client, which mismatched `aria-current` on every active nav link.
//     After mount we switch to the live hook so client-side navigation updates
//     the active link and inbox auto-collapse without a full request.
//   - userPref-from-localStorage is still gated on a post-mount `mounted` flag
//     because it's a genuinely client-only read; when it flips, the existing
//     `transition-[width]` on Sidebar animates smoothly.
//
// The inbox sub-nav lives inside `inbox/layout.tsx` as an `@sidebar`
// parallel slot scoped to inbox routes only — it unmounts cleanly when
// the user navigates away. AdminShell stays oblivious.

export function AdminShell({
  admin,
  initialSegment,
  children,
}: {
  admin: AdminContext;
  initialSegment: string | null;
  children: React.ReactNode;
}) {
  const [userPref, setUserPref] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Defaults to true so SSR and the first client render emit the desktop
  // column exactly as before — no hydration change. Flips post-mount on
  // narrow viewports, where the sidebar becomes an off-canvas drawer.
  const [isDesktop, setIsDesktop] = useState(true);
  const pathname = usePathname();
  const liveSegment = useSelectedLayoutSegment();

  // Server + first client render use the server-derived `initialSegment` so
  // the HTML matches exactly. Once mounted, the live hook takes over so
  // client-side navigation updates the active link / inbox auto-collapse.
  const segment = mounted ? liveSegment : initialSegment;

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "1") setUserPref(true);
    } catch {
      /* ignore */
    }
    setMounted(true);
  }, []);

  // Auto-collapse on inbox uses the same server-derived-then-live `segment`
  // (correct on first paint → no width flash, no hydration mismatch).
  // `userPref` stays gated on `mounted` because it's a genuinely client-only
  // localStorage read.
  const isInboxRoute = segment === "inbox";
  const effectiveCollapsed = (mounted && userPref) || isInboxRoute;
  // The 76px rail is a desktop affordance — inside the mobile drawer it
  // would render icon-only nav in a 260px panel. Force the full layout there.
  const sidebarCollapsed = isDesktop ? effectiveCollapsed : false;

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const apply = () => setIsDesktop(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // The drawer overlays content, so a route change must dismiss it —
  // otherwise it stays open over the page the user just navigated to.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  // Escape closes the drawer, matching the scrim click.
  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileNavOpen]);

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
        <Sidebar
          admin={admin}
          segment={segment}
          collapsed={sidebarCollapsed}
          onToggle={toggle}
          mobileOpen={mobileNavOpen}
          onMobileClose={() => setMobileNavOpen(false)}
        />

        {/* Scrim — only ever hit-testable while the mobile drawer is open. */}
        <div
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
          className={`fixed inset-0 z-40 bg-[var(--ink)]/25 backdrop-blur-[2px] md:hidden
                      transition-opacity duration-[var(--dur-base)] ease-[var(--ease-out)]
                      motion-reduce:transition-none ${
                        mobileNavOpen
                          ? "opacity-100"
                          : "opacity-0 pointer-events-none"
                      }`}
        />

        <div className="flex-1 min-w-0 flex flex-col">
          <TopBar onOpenNav={() => setMobileNavOpen(true)} />
          <main
            className="flex-1 min-w-0 relative"
            style={{
              backgroundImage:
                "radial-gradient(900px 500px at 92% -10%, rgba(37,99,235,0.05), transparent 60%)," +
                "radial-gradient(700px 420px at -4% 110%, rgba(122,143,179,0.05), transparent 65%)",
            }}
          >
            {/* Gutter comes from --admin-gutter-* so the inbox's negative-margin
                escape can stay in lockstep with it. See globals.css. */}
            <div className="px-[var(--admin-gutter-x)] py-[var(--admin-gutter-y)]">
              {children}
            </div>
          </main>
        </div>
      </div>
    </BreadcrumbProvider>
  );
}
