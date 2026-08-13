"use client";

import { useEffect } from "react";

// M7.1d — registers the scanner service worker at /sw.js so the scanner
// page survives brief WiFi blips at the venue. Scope is narrowed to
// /admin/ so the SW doesn't accidentally handle public marketing pages.
//
// Mounted only on the scanner /scan route. Silent no-op when
// serviceWorker is unsupported (older Safari, dev tools, etc).
//
// NOT REGISTERED IN DEVELOPMENT, and any existing registration is torn down.
//
// sw.js serves /_next/static/ cache-first. In production that is safe, because
// those filenames are content-hashed (`0-7u-bcdwil3f.js`) — a new build emits
// new URLs, which miss the cache and are fetched fresh. In development
// Turbopack uses stable path-based names (`src_components_….js`), so the exact
// same rule pins the browser to whatever code it saw first and never lets go.
//
// That cost a long debugging session on 2026-08-13: an edit was correct on
// disk, correct in the server's HTML, and invisible in the browser. Clearing
// .next twice and restarting the dev server changed nothing, because the
// staleness was not Turbopack's. The tell is a hydration mismatch where the
// server and client disagree about text neither one should still be rendering.
//
// The teardown below matters as much as the guard: anyone who ran the scanner
// before this shipped already has a registration that would otherwise persist
// indefinitely, since a service worker outlives the page that installed it.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      void (async () => {
        try {
          const regs = await navigator.serviceWorker.getRegistrations();
          if (regs.length === 0) return;
          await Promise.all(regs.map((r) => r.unregister()));
          if (typeof caches !== "undefined") {
            const keys = await caches.keys();
            await Promise.all(keys.map((k) => caches.delete(k)));
          }
          console.info(
            "[sw] dev: unregistered %d service worker(s) and cleared caches — reload to pick up current code",
            regs.length,
          );
        } catch (err) {
          console.warn("[sw] dev teardown failed", err);
        }
      })();
      return;
    }

    const w = window as unknown as { __gmcScannerSwRegistered?: boolean };
    if (w.__gmcScannerSwRegistered) return;
    w.__gmcScannerSwRegistered = true;

    navigator.serviceWorker
      .register("/sw.js", { scope: "/admin/" })
      .catch((err) => {
        console.warn("[sw] register failed", err);
      });
  }, []);

  return null;
}
