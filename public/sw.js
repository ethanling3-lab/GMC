// M7.1d — GMC scanner service worker.
//
// App-shell cache only — does NOT queue check-ins offline. If WiFi drops
// mid-event the scanner page itself stays alive (cached) but any POST to
// /api/* will fail until the network returns.
//
// Strategies:
//   - HTML (any /admin/events/*/check-in/scan path): stale-while-revalidate
//   - Static assets (_next/static, /icons): cache-first
//   - APIs (/api/*): network-only (never cache; check-in writes need fresh
//     data)
//   - everything else: network-first
//
// Versioning: bump CACHE_PREFIX to invalidate on deploy. The activate
// handler nukes any older caches.

const CACHE_PREFIX = "gmc-scanner-v2";
const HTML_CACHE = `${CACHE_PREFIX}-html`;
const STATIC_CACHE = `${CACHE_PREFIX}-static`;

// Self-heal on localhost.
//
// The static cache-first rule below is safe in production (content-hashed
// filenames — a new build emits new URLs) and actively harmful in development
// (Turbopack uses stable path-based names, so the first copy is pinned
// forever). ServiceWorkerRegister already refuses to register outside
// production, but that only runs on the scanner route — a machine that
// installed this worker earlier and never returns to /scan would keep it.
//
// So the worker retires itself. Browsers re-fetch sw.js on navigations within
// scope, so any /admin visit on localhost is enough to trigger this.
const IS_LOCALHOST =
  self.location.hostname === "localhost" ||
  self.location.hostname === "127.0.0.1" ||
  self.location.hostname === "[::1]";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(Promise.resolve());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      if (IS_LOCALHOST) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
        await self.registration.unregister();
        // Reload open clients so they leave with fresh, uncached code rather
        // than sitting on whatever this worker last handed them.
        const clients = await self.clients.matchAll({ type: "window" });
        for (const c of clients) c.navigate(c.url);
        return;
      }

      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => !k.startsWith(CACHE_PREFIX))
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  // Belt and braces: even before activate finishes retiring this worker on
  // localhost, never serve a cached response there.
  if (IS_LOCALHOST) return;

  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Never touch /api/ or other dynamic routes — always go to network.
  if (url.pathname.startsWith("/api/")) return;

  // HTML for the scanner pages — stale-while-revalidate
  if (
    req.mode === "navigate" ||
    (req.headers.get("accept") ?? "").includes("text/html")
  ) {
    if (url.pathname.includes("/check-in/scan")) {
      event.respondWith(staleWhileRevalidate(req, HTML_CACHE));
      return;
    }
  }

  // Static assets — cache-first
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/")
  ) {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }
});

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const networkPromise = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => cached || Response.error());
  return cached || networkPromise;
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return Response.error();
  }
}
