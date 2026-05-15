"use client";

import { useEffect, useRef } from "react";

// Screen Wake Lock keeps an iPad / phone awake while the scanner page is
// in front. iPadOS 16.4+ ships the API; older or unsupported browsers
// silently no-op (the iPad's normal auto-lock takes over).
//
// We don't override the device's global auto-lock setting — only suppress
// while this page is the foreground tab. The sentinel is auto-released
// when the page is hidden; we re-acquire on visibilitychange.
//
// Usage: call `useWakeLock(active)` from a client component. Pass false
// to release (e.g., when the camera is paused).

type WakeLockSentinel = {
  released: boolean;
  release(): Promise<void>;
  addEventListener: (type: "release", cb: () => void) => void;
};

type WakeLockAPI = {
  request(type: "screen"): Promise<WakeLockSentinel>;
};

function getApi(): WakeLockAPI | null {
  if (typeof navigator === "undefined") return null;
  const wl = (navigator as unknown as { wakeLock?: WakeLockAPI }).wakeLock;
  return wl ?? null;
}

export function useWakeLock(active: boolean): void {
  const sentinelRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    const api = getApi();
    if (!api) return;
    if (!active) {
      void sentinelRef.current?.release().catch(() => {});
      sentinelRef.current = null;
      return;
    }

    let cancelled = false;
    async function acquire() {
      try {
        const sentinel = await api!.request("screen");
        if (cancelled) {
          void sentinel.release().catch(() => {});
          return;
        }
        sentinelRef.current = sentinel;
        sentinel.addEventListener("release", () => {
          // When the OS auto-releases (page hidden, etc.), null the ref
          // so the next visibilitychange re-acquires cleanly.
          if (sentinelRef.current === sentinel) {
            sentinelRef.current = null;
          }
        });
      } catch {
        // Common failure: page not visible at mount time. The
        // visibilitychange handler below will retry.
      }
    }

    function onVisibility() {
      if (document.visibilityState === "visible" && !sentinelRef.current) {
        void acquire();
      }
    }

    void acquire();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      const s = sentinelRef.current;
      sentinelRef.current = null;
      if (s) void s.release().catch(() => {});
    };
  }, [active]);
}
