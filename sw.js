const CACHE_NAME = "kaoshang-social-worker-v47";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=20260705-45",
  "./app.js?v=20260706-03",
  "./app-core.mjs?v=20260706-03",
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
  "./data/index.json?v=20260705-158",
  "./data/law-lookup.json?v=20260705-158"
];

function shouldUseNetworkFirst(request) {
  const url = new URL(request.url);
  return request.mode === "navigate" || url.pathname.endsWith("/index.html") || url.pathname.includes("/data/");
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request, { cache: "reload" });
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error("Network request failed and no cached response is available.");
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && request.url.includes("/data/")) {
    const copy = response.clone();
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, copy);
  }
  return response;
}

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
  event.respondWith(shouldUseNetworkFirst(event.request) ? networkFirst(event.request) : cacheFirst(event.request));
});
