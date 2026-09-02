/* eslint-env browser */
// ============================================================
// SYNC ADAPTER — the shell's view of connectivity.
//
// There is no in-memory retry queue any more. Every pending write lives in the
// durable outbox (js/data/outbox.js) and is drained by js/data/reconcile.js,
// so a reload, a crash or a closed tab cannot lose a change. This file only
// keeps the offline banner and the reconciler in step.
// ============================================================

import { state } from './state.js';
import { setOnline as reconcilerSetOnline, flush } from './data/reconcile.js';

export function setOnline(online) {
  state.isOnline = online;
  const banner = document.getElementById('offline-banner');
  if (banner) banner.classList.toggle('hidden', !!online);
  reconcilerSetOnline(online);
}

/** Ask the reconciler to drain whatever is queued. */
export function flushQueue() {
  return flush();
}

/** Listen for the browser's own connectivity events. Idempotent. */
let _wired = false;
export function watchConnectivity() {
  if (_wired) return;
  _wired = true;
  window.addEventListener('online', () => setOnline(true));
  window.addEventListener('offline', () => setOnline(false));
  setOnline(navigator.onLine !== false);
}
