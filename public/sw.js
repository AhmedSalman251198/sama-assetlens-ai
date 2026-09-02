const VERSION = new URL(self.location.href).searchParams.get("v") || "14.0.0";
const CACHE = `assetlens-shell-${VERSION}`;
const PRECACHE = [
  "/",
  "/capture",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/assetlens-logo.png",
  "/assetlens-icon.png",
  "/icon-192.png",
  "/icon-512.png",
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(PRECACHE.map(path => cache.add(new Request(path, { cache: "reload" }))));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith("assetlens-") && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") void self.skipWaiting();
});

function isNextRouterPayload(request, url) {
  return url.searchParams.has("_rsc") ||
    request.headers.get("RSC") === "1" ||
    request.headers.has("Next-Router-Prefetch") ||
    request.headers.has("Next-Router-State-Tree");
}

async function networkFirstDocument(request, url) {
  const cache = await caches.open(CACHE);
  const cacheKey = new Request(url.pathname);
  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response.ok && response.type === "basic") await cache.put(cacheKey, response.clone());
    return response;
  } catch {
    return (await cache.match(cacheKey)) || (await cache.match("/capture")) || (await cache.match("/")) || Response.error();
  }
}

async function cacheFirstStatic(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === "basic") await cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // Never cache authentication, APIs, Next.js RSC payloads, or route prefetches.
  // Caching those responses can combine an old page tree with a new root layout.
  if (url.pathname === "/login" || url.pathname.startsWith("/api/") || isNextRouterPayload(request, url)) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstDocument(request, url));
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || PRECACHE.includes(url.pathname)) {
    event.respondWith(cacheFirstStatic(request));
  }
});
