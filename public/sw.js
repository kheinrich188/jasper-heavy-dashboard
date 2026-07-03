const CACHE_NAME = "jasper-heavy-dashboard-v1";
const SCOPE_PATH = new URL(self.registration.scope).pathname.replace(/\/$/, "");
const scoped = (path) => `${SCOPE_PATH}${path}`.replace(/\/{2,}/g, "/");
const APP_SHELL = [
  scoped("/"),
  scoped("/index.html"),
  scoped("/site.webmanifest"),
  scoped("/assets/css/styles.css"),
  scoped("/assets/js/app.js"),
  scoped("/assets/icons/android-chrome-192x192.png"),
  scoped("/assets/icons/android-chrome-512x512.png"),
  scoped("/assets/icons/apple-touch-icon.png"),
  scoped("/assets/icons/favicon-32x32.png"),
  scoped("/assets/icons/favicon-16x16.png"),
  scoped("/assets/icons/favicon.ico"),
  scoped("/assets/images/hero-poster.png"),
  scoped("/images/hero-poster.webp"),
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith(scoped("/api/"))) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        const isCacheableDestination =
          request.destination === "script" ||
          request.destination === "style" ||
          request.destination === "document" ||
          request.destination === "image";
        const isCacheable = response.ok && isCacheableDestination;
        if (isCacheable) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
        }
        return response;
      });
    })
  );
});
