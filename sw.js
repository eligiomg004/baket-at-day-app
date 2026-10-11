/* Baket At Day - Service Worker
 * Estrategia: precache completo de assets + network-first con fallback offline.
 * - Al instalar, precarga index.html y todos sus recursos (JS, CSS, WASM, icons).
 * - La app funciona 100% offline desde el primer arranque.
 * - Las llamadas al relay (otro origen) NO se cachean.
 */
const CACHE = "baket-at-day-v4";
const CACHE_VERSION = 4;

// Assets que siempre precacheamos (shell básico)
const SHELL = [".", "./index.html", "./manifest.webmanifest"];

// Precache dinámico: extraer assets de index.html y cachearlos
async function precacheAssets(cache) {
  try {
    const res = await fetch("./index.html");
    const html = await res.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    const assets = [];
    // Scripts
    doc.querySelectorAll('script[src]').forEach(s => assets.add(s.src));
    // CSS
    doc.querySelectorAll('link[rel="stylesheet"][href]').forEach(l => assets.add(l.href));
    // Icons en manifest
    doc.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]').forEach(l => assets.add(l.href));

    // También buscar assets con variables de Vite (imports dinámicos)
    // agregamos los assets conocidos por nombre (sin hash)
    const knownAssets = [
      "./assets/sql-wasm.wasm",
      "./icons",
      "./favicon.svg",
    ];
    const allAssets = [...assets, ...knownAssets].filter(a => !a.includes("node_modules"));
    
    const results = await Promise.allSettled(allAssets.map(a => fetch(a).then(r => cache.put(a, r)).catch(() => {})));
    const ok = results.filter(r => r.status === "fulfilled").length;
    console.log(`[SW] Precached ${ok}/${allAssets.length} assets`);
  } catch (e) {
    console.warn("[SW] Error precaching assets:", e);
  }
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then(async cache => {
      // 1. Precargar shell básico
      await cache.addAll(SHELL);
      // 2. Precargar assets dinámicos de index.html
      await precacheAssets(cache);
    }).catch(e => console.warn("[SW] Install error:", e))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // relay y otros orígenes: sin caché

  event.respondWith(
    (async () => {
      try {
        const res = await fetch(req);
        if (res && res.status === 200) {
          const cache = await caches.open(CACHE);
          cache.put(req, res.clone());
        }
        return res;
      } catch (e) {
        const cache = await caches.open(CACHE);
        // Para navegaciones HTML, fallback a index.html (SPA routing)
        if (req.mode === "navigate") {
          return cache.match("./index.html") || Response.error();
        }
        const cached = await cache.match(req);
        return cached || Response.error();
      }
    })()
  );
});