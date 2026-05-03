"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { AdminContext } from "@/lib/admin-guard";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { BreadcrumbProvider } from "./BreadcrumbContext";

const STORAGE_KEY = "gmc-admin-sidebar-collapsed";

export function AdminShell({
  admin,
  children,
}: {
  admin: AdminContext;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "1") setCollapsed(true);
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  // Defensive cleanup on every route change. With React 19 transitions +
  // portaled dialog modals (createPortal to document.body), there's a small
  // window where a dialog component can unmount but its portal child stays
  // attached to body — leaving an invisible fixed-inset backdrop that
  // intercepts every click on the new page (sidebar nav becomes dead).
  // Also resets body overflow in case any dialog left it locked. Safe even
  // when no orphans exist; legitimate active modals on the NEW page mount
  // after this effect runs because pathname changes before child renders
  // commit.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.style.overflow = "";
    document
      .querySelectorAll('body > [role="dialog"]')
      .forEach((el) => el.remove());
  }, [pathname]);

  function toggle() {
    setCollapsed((prev) => {
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
        data-hydrated={hydrated ? "true" : "false"}
      >
        <Sidebar admin={admin} collapsed={collapsed} onToggle={toggle} />

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
            <div className="px-6 md:px-10 py-10 max-w-[1280px]">{children}</div>
          </main>
        </div>
      </div>
    </BreadcrumbProvider>
  );
}
