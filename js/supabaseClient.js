// ============================================================
// Single shared Supabase browser client.
//
// One instance so the Auth session established by js/auth.js is the same
// session every database call in js/db.js runs under. The client persists the
// session (localStorage) and refreshes it automatically, so the owner does not
// re-authenticate on every page load.
//
// The library itself is vendored at vendor/supabase-js-<version>.umd.js and
// loaded as a classic script from our own origin, which lets the CSP stay at
// `script-src 'self'`.
// ============================================================

import { CONFIG } from './config.js';

/** localStorage key holding the persisted Supabase session for this app. */
export const AUTH_STORAGE_KEY = 'dontdie-auth-v1';

let _client = null;

/**
 * @returns {any} the shared Supabase client
 * @throws {Error} if the Supabase library has not loaded yet
 */
export function getSupabase() {
  if (_client) return _client;

  const lib = globalThis.supabase;
  if (!lib || typeof lib.createClient !== 'function') {
    throw new Error('Supabase library is not loaded');
  }

  _client = lib.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: AUTH_STORAGE_KEY,
    },
  });
  return _client;
}

/** True when the vendored library has attached itself to the page. */
export function isSupabaseLibraryLoaded() {
  const lib = globalThis.supabase;
  return !!(lib && typeof lib.createClient === 'function');
}
