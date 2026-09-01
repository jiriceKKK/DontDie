// ============================================================
// Authenticated session state.
//
// The single source of truth for "who is signed in". js/auth.js writes it,
// js/db.js reads it to stamp and filter every row by owner, and the UI reads
// it to distinguish signed-out / active / expired states.
//
// This module holds no secrets: the access token lives inside the Supabase
// client. Only the user id and a coarse status are kept here.
// ============================================================

/** @typedef {'signed-out'|'authenticated'|'expired'} AuthStatus */

/** Raised when an operation needs an owner but no session is active. */
export class AuthRequiredError extends Error {
  constructor(message = 'Sign in required') {
    super(message);
    this.name = 'AuthRequiredError';
    this.isAuthRequired = true;
  }
}

const listeners = new Set();

let _userId = null;
let _email = null;
/** @type {AuthStatus} */
let _status = 'signed-out';

function emit() {
  const snapshot = getAuthState();
  for (const listener of listeners) {
    try { listener(snapshot); } catch (err) { console.error('[session] listener failed:', err); }
  }
}

/**
 * Replace the current session from a Supabase session object (or null).
 * @param {{ user?: { id?: string, email?: string } }|null|undefined} supabaseSession
 */
export function setSession(supabaseSession) {
  const user = supabaseSession && supabaseSession.user;
  const nextId = user && typeof user.id === 'string' ? user.id : null;
  const nextEmail = user && typeof user.email === 'string' ? user.email : null;
  const nextStatus = nextId ? 'authenticated' : (_status === 'authenticated' ? 'expired' : _status);

  const changed = nextId !== _userId || nextStatus !== _status || nextEmail !== _email;
  _userId = nextId;
  _email = nextEmail;
  _status = nextId ? 'authenticated' : nextStatus;
  if (changed) emit();
}

/** Mark the session as expired without clearing the "there was an owner" hint. */
export function markExpired() {
  if (_status === 'expired' && _userId === null) return;
  _userId = null;
  _status = 'expired';
  emit();
}

/** Clear all session state (explicit sign-out). */
export function clearSession() {
  const changed = _userId !== null || _status !== 'signed-out' || _email !== null;
  _userId = null;
  _email = null;
  _status = 'signed-out';
  if (changed) emit();
}

/** @returns {{ status: AuthStatus, userId: string|null, email: string|null, isAuthenticated: boolean }} */
export function getAuthState() {
  return { status: _status, userId: _userId, email: _email, isAuthenticated: _status === 'authenticated' && !!_userId };
}

/** @returns {string|null} */
export function getUserId() {
  return _status === 'authenticated' ? _userId : null;
}

/** @returns {boolean} */
export function isAuthenticated() {
  return _status === 'authenticated' && !!_userId;
}

/**
 * Owner id for a database write. Never falls back to anonymous.
 * @returns {string}
 * @throws {AuthRequiredError}
 */
export function requireUserId() {
  const id = getUserId();
  if (!id) throw new AuthRequiredError();
  return id;
}

/**
 * Subscribe to session changes.
 * @param {(state: ReturnType<typeof getAuthState>) => void} listener
 * @returns {() => void} unsubscribe
 */
export function onAuthStateChanged(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test seam: drop every listener and reset state. */
export function _resetSessionForTests() {
  listeners.clear();
  _userId = null;
  _email = null;
  _status = 'signed-out';
}
