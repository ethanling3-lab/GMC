"use client";

import { useEffect } from "react";

// M7.1d — registers the scanner service worker at /sw.js so the scanner
// page survives brief WiFi blips at the venue. Scope is narrowed to
// /admin/ so the SW doesn't accidentally handle public marketing pages.
//
// Mounted only on the scanner /scan route. Silent no-op when
// serviceWorker is unsupported (older Safari, dev tools, etc).

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
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
