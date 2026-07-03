const CACHE_NAME = "jasper-heavy-dashboard-v1";
const APP_SHELL = [
  "/",
  "/index.html",
  "/site.webmanifest",
  "/assets/css/styles.css",
  "/assets/js/app.js",
  "/assets/icons/android-chrome-192x192.png",
  "/assets/icons/android-chrome-512x512.png",
  "/assets/icons/apple-touch-icon.png",
  "/assets/icons/favicon-32x32.png",
  "/assets/icons/favicon-16x16.png",
  "/assets/icons/favicon.ico",
  "/assets/images/hero-poster.png",
  "/images/hero-poster.webp",
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
  if (url.pathname.startsWith("/api/")) return;

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
