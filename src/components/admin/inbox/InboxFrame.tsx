"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

// Thin client wrapper that owns the inbox's 3-column flex layout. Reads
// the pathname so the list pane can REPLACE the empty "Pick a
// conversation" picker at xl+ when no thread is open — list expands to
// fill all available width. Selecting a thread snaps the list back to
// the 320px column and reveals the thread pane.
//
// At <xl, the @list slot is hidden by CSS regardless (the inbox/page.tsx
// inline branch renders the list inside `children`), so the responsive
// rules below only matter at xl+.

export function InboxFrame({
  sidebar,
  list,
  children,
}: {
  sidebar: ReactNode;
  list: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const isRoot = pathname === "/admin/inbox" || pathname === "/admin/inbox/";

  return (
    <div className="-mx-6 md:-mx-10 -my-10 flex h-[calc(100dvh-4rem)] min-h-0">
      <aside
        className="hidden lg:flex flex-none w-[260px] h-full
                   border-r border-[var(--paper-shadow)] bg-[var(--paper-warm)]
                   overflow-hidden"
      >
        {sidebar}
      </aside>
      <aside
        className={[
          "hidden xl:flex h-full",
          "border-r border-[var(--paper-shadow)] bg-[var(--paper-warm)]",
          "overflow-hidden",
          isRoot ? "xl:flex-1" : "xl:flex-none xl:w-[320px]",
        ].join(" ")}
      >
        {list}
      </aside>
      <div
        className={[
          "flex-1 min-w-0 h-full overflow-hidden flex flex-col",
          isRoot ? "xl:hidden" : "",
        ].join(" ")}
      >
        {children}
      </div>
    </div>
  );
}
