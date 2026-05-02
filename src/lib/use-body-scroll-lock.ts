"use client";

import { useEffect } from "react";

// Counter-based body scroll lock that's safe across multiple simultaneously-
// mounted dialogs. The naive prev-capture pattern (each dialog stores body's
// current overflow on open and restores it on close) deadlocks the page when
// dialogs nest: dialog B captures "hidden" (set by A), then later restores
// body to "hidden" after A is already gone — and nothing ever unlocks it.
// This util increments a module-level counter on lock and only restores when
// the counter hits zero.

let lockCount = 0;
let originalOverflow: string | null = null;

export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof document === "undefined") return;
    if (lockCount === 0) {
      originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    lockCount += 1;
    return () => {
      lockCount -= 1;
      if (lockCount <= 0) {
        lockCount = 0;
        document.body.style.overflow = originalOverflow ?? "";
        originalOverflow = null;
      }
    };
  }, [active]);
}
