const CACHE_NAME = "kaoshang-social-worker-v43";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=20260705-44",
  "./app.js?v=20260705-44",
  "./app-core.mjs?v=20260705-18",
  "./manifest.webmanifest",
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/favicon.png",
  "./install-guide/install-step-1-share.png",
  "./install-guide/install-step-2-more.png",
  "./install-guide/install-step-3-add-home.png",
  "./data/question-assets/113_113100_0302_q13.png",
  "./data/question-assets/114_114100_0306_q12.png",
  "./data/index.json?v=20260705-157",
  "./data/law-lookup.json?v=20260705-157"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok && event.request.url.includes("/data/")) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      });
    })
  );
});
