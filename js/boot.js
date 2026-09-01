/* eslint-env browser */
// ============================================================
// Self-healing bootstrap (moved out of index.html so the page needs no inline
// script and the CSP can stay at `script-src 'self'`).
//
// Why it exists: an ES-module graph fails to LINK before any of our code runs
// (e.g. a freshly deployed module importing a symbol from a still-cached older
// module), which aborts the whole graph and leaves a blank background. This
// classic script catches that specific failure and, exactly once per session,
// clears the caches + service worker and reloads so the browser refetches a
// self-consistent set.
//
// It never hides a genuine bug: the guard only clears after the app actually
// boots, so a real error still surfaces in the console and cannot loop.
//
// Loaded as a classic (non-module) script so it is running before the module
// graph is evaluated.
// ============================================================
(function () {
  var KEY = 'dd_module_reload';

  function booted() {
    return ['app', 'auth-screen', 'setup-screen'].some(function (id) {
      var el = document.getElementById(id);
      return el && !el.classList.contains('hidden');
    });
  }

  window.addEventListener('error', function (e) {
    var msg = (e && (e.message || (e.error && e.error.message))) || '';
    var moduleFail = /does not provide an export|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unexpected token '?<'?/i.test(msg);
    if (!moduleFail) return;
    if (sessionStorage.getItem(KEY)) return;          // already retried this session — don't loop
    try { sessionStorage.setItem(KEY, '1'); } catch (_) {}
    var reload = function () { location.reload(); };
    var jobs = [];
    try {
      if (window.caches && caches.keys) {
        jobs.push(caches.keys().then(function (ks) {
          return Promise.all(ks.map(function (k) { return caches.delete(k); }));
        }));
      }
    } catch (_) {}
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
        jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) {
          return Promise.all(rs.map(function (r) { return r.unregister(); }));
        }));
      }
    } catch (_) {}
    (jobs.length ? Promise.all(jobs) : Promise.resolve()).then(reload, reload);
  }, true);

  // Only release the guard once the app genuinely came up, so a future desync
  // can self-heal again but a real, persistent failure can never reload-loop.
  window.addEventListener('load', function () {
    setTimeout(function () {
      if (booted()) { try { sessionStorage.removeItem(KEY); } catch (_) {} }
    }, 3000);
  });

  // Network-first service worker: a new deploy shows up on the next reload.
  // updateViaCache:'none' makes the browser always fetch sw.js fresh so the
  // worker itself can't get stuck.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(function () {});
    });
  }
})();
