// Bump this version string whenever app.js or index.html changes, so old
// caches get cleared and the update actually reaches the user.
const CACHE = "finplan-v18";
const ASSETS = [
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  const isNavigation = e.request.mode === "navigate";
  const isAppCode = url.pathname.endsWith("app.js");
  const isHTML = isNavigation || url.pathname.endsWith("/") || url.pathname.endsWith("index.html");

  if (url.origin === location.origin && (isHTML || isAppCode)) {
    // Network-first for the HTML shell and app code: always try to get the
    // latest deploy first, so updates reach the user on next load instead of
    // being stuck on a stale cached copy. Fall back to cache only when offline.
    e.respondWith(
      fetch(e.request).then((res) => {
        const resClone = res.clone();
        caches.open(CACHE).then((cache) => cache.put(e.request, resClone));
        return res;
      }).catch(() => caches.match(e.request).then((r) => r || caches.match("./index.html")))
    );
    return;
  }

  if (url.origin === location.origin) {
    // Cache-first for our own static assets (icons, manifest) — these change rarely.
    e.respondWith(
      caches.match(e.request).then((cached) => {
        if (cached) return cached;
        return fetch(e.request).then((res) => {
          const resClone = res.clone();
          caches.open(CACHE).then((cache) => cache.put(e.request, resClone));
          return res;
        });
      })
    );
    return;
  }

  // Third-party CDN scripts (React): network-first so fixes are picked up,
  // falling back to cache when offline.
  e.respondWith(
    fetch(e.request).then((res) => {
      const resClone = res.clone();
      caches.open(CACHE).then((cache) => cache.put(e.request, resClone));
      return res;
    }).catch(() => caches.match(e.request))
  );
});
