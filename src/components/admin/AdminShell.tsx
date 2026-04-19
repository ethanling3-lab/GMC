"use client";

import { useEffect, useState } from "react";
import type { AdminContext } from "@/lib/admin-guard";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

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

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "1") setCollapsed(true);
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

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
  );
}
