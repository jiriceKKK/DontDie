// ============================================================
// Service worker — network-first for same-origin GETs so a new deploy always
// shows up on the next reload (this fixes the stale ES-module cache where only
// index.html / main.js / style.css were version-busted). Falls back to the
// cache when offline, which also gives basic offline support. Cross-origin
// requests (Supabase, Google Fonts CDN) and non-GET requests pass straight
// through and are never intercepted.
// Bump CACHE on each deploy that should hard-invalidate old cached assets.
// ============================================================

const CACHE = 'dontdie-v13';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;                       // never touch writes
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // let Supabase / CDN pass through

  event.respondWith((async () => {
    try {
      const fresh = await fetch(req);                     // network-first: always try latest
      if (fresh && fresh.ok) {
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone()).catch(() => {});
      }
      return fresh;
    } catch {
      const cached = await caches.match(req);             // offline fallback
      return cached || new Response('Offline', { status: 503, statusText: 'Offline' });
    }
  })());
});
