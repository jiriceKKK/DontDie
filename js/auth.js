// ============================================================
// Authentication gate.
//
// Order of operations on boot:
//   1. restore a persisted Supabase Auth session (no network round-trip if a
//      valid token is cached, so returning does not mean signing in again);
//   2. if there is none, show the sign-in screen and establish one;
//   3. only then, if the owner enabled it, ask for the on-device privacy lock.
//
// The device lock is a UI courtesy layered on top of a real session — it is
// never the thing that authorizes cloud data. See js/deviceLock.js.
//
// A failure to authenticate never opens the app: on any error path the gate
// stays up with a readable state (pending / error / offline / session expired).
// ============================================================

import { CONFIG } from './config.js';
import { getSupabase, isSupabaseLibraryLoaded } from './supabaseClient.js';
import {
  setSession, clearSession, markExpired, getAuthState, isAuthenticated,
} from './session.js';
import {
  isDeviceLockSet, verifyDeviceLock, setDeviceLock, clearDeviceLock,
  getCooldownRemainingMs, validateSecret,
} from './deviceLock.js';
import { setText } from './ui/dom.js';

const LOCK_DECLINED_KEY = 'dontdie_device_lock_declined_v1';
const UNLOCKED_KEY = 'dontdie_device_unlocked';

let _onAuthenticated = null;
let _wired = false;

// ---- small DOM helpers ----------------------------------------------------
const el = id => document.getElementById(id);
const show = node => node && node.classList.remove('hidden');
const hide = node => node && node.classList.add('hidden');

function setStatus(message) { setText(el('auth-status'), message || ''); }

function setError(message) {
  const box = el('auth-error');
  setText(box, message || '');
  if (box) box.classList.toggle('hidden', !message);
}

function setBusy(busy) {
  for (const id of ['auth-submit', 'lock-submit', 'lock-setup-submit']) {
    const button = el(id);
    if (button) button.disabled = !!busy;
  }
}

function showView(view) {
  const views = {
    signin: el('auth-form'),
    lock: el('lock-form'),
    setup: el('lock-setup-form'),
  };
  for (const [name, node] of Object.entries(views)) {
    if (!node) continue;
    if (name === view) show(node); else hide(node);
  }
  const subtitle = el('auth-subtitle');
  if (subtitle) {
    setText(subtitle, view === 'signin' ? 'Sign in' : view === 'lock' ? 'Locked' : 'Device passcode');
  }
}

function showGate() { show(el('auth-screen')); }
function hideGate() { hide(el('auth-screen')); }

// ---- configuration --------------------------------------------------------
/** The public Supabase settings must be filled in before anything can run. */
export function isConfigValid() {
  return !!(
    CONFIG.SUPABASE_URL &&
    CONFIG.SUPABASE_URL !== 'YOUR_SUPABASE_PROJECT_URL' &&
    CONFIG.SUPABASE_ANON_KEY &&
    CONFIG.SUPABASE_ANON_KEY !== 'YOUR_SUPABASE_ANON_KEY'
  );
}

// ---- session restore ------------------------------------------------------
/**
 * Ask Supabase for the persisted session and mirror it into js/session.js.
 * @returns {Promise<{ ok: boolean, offline?: boolean, error?: string }>}
 */
export async function restoreSession() {
  if (!isSupabaseLibraryLoaded()) {
    return { ok: false, error: 'Supabase library did not load.' };
  }
  try {
    const { data, error } = await getSupabase().auth.getSession();
    if (error) throw error;
    if (data && data.session) {
      setSession(data.session);
      return { ok: true };
    }
    clearSession();
    return { ok: false };
  } catch (err) {
    console.error('[auth] restoreSession:', err);
    // A network failure must not be reported as "signed out": an unexpired
    // cached token is still a valid session for local-first reading.
    return { ok: false, offline: !navigator.onLine, error: 'Could not reach the account service.' };
  }
}

/** Keep js/session.js in step with Supabase (refresh, expiry, other tabs). */
function watchAuthChanges() {
  try {
    getSupabase().auth.onAuthStateChange((event, session) => {
      if (session) {
        setSession(session);
        return;
      }
      if (event === 'SIGNED_OUT') {
        clearSession();
      } else {
        markExpired();
        onSessionLost();
      }
    });
  } catch (err) {
    console.error('[auth] onAuthStateChange unavailable:', err);
  }
}

function onSessionLost() {
  try { sessionStorage.removeItem(UNLOCKED_KEY); } catch { /* ignore */ }
  const app = el('app');
  if (app && !app.classList.contains('hidden')) {
    showGate();
    showView('signin');
    setError('Your session expired. Sign in again to keep syncing.');
    setStatus('Local data stays on this device until you sign in.');
  }
}

// ---- sign in / out --------------------------------------------------------
/**
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function signIn(email, password) {
  if (!email || !password) return { ok: false, error: 'Enter your email and password.' };
  try {
    const { data, error } = await getSupabase().auth.signInWithPassword({ email, password });
    if (error) {
      const message = /invalid login credentials/i.test(error.message || '')
        ? 'Email or password is incorrect.'
        : (error.message || 'Sign-in failed.');
      return { ok: false, error: message };
    }
    setSession(data.session);
    return { ok: true };
  } catch (err) {
    console.error('[auth] signIn:', err);
    return { ok: false, error: navigator.onLine ? 'Sign-in failed. Try again.' : 'You are offline — sign-in needs a connection.' };
  }
}

/**
 * Clear the Supabase session, the device-unlock flag, and sensitive in-memory
 * state, then return to the gate.
 */
export async function signOut({ reload = true } = {}) {
  try { await getSupabase().auth.signOut(); } catch (err) { console.error('[auth] signOut:', err); }
  clearSession();
  try { sessionStorage.removeItem(UNLOCKED_KEY); } catch { /* ignore */ }
  if (reload && typeof location !== 'undefined' && typeof location.reload === 'function') {
    location.reload();
  }
}

// ---- device lock ----------------------------------------------------------
function lockDeclined() {
  try { return localStorage.getItem(LOCK_DECLINED_KEY) === '1'; } catch { return false; }
}

function declineLock() {
  try { localStorage.setItem(LOCK_DECLINED_KEY, '1'); } catch { /* ignore */ }
}

function markUnlocked() {
  try { sessionStorage.setItem(UNLOCKED_KEY, '1'); } catch { /* ignore */ }
}

function isUnlockedThisSession() {
  try { return sessionStorage.getItem(UNLOCKED_KEY) === '1'; } catch { return false; }
}

/** True when the gate should ask for the device passcode before revealing data. */
export function deviceLockRequired() {
  return !!CONFIG.DEVICE_LOCK_ENABLED && isDeviceLockSet() && !isUnlockedThisSession();
}

function cooldownMessage(ms) {
  const seconds = Math.ceil(ms / 1000);
  if (seconds <= 90) return `Too many attempts. Wait ${seconds}s.`;
  return `Too many attempts. Wait ${Math.ceil(seconds / 60)} min.`;
}

// ---- wiring ---------------------------------------------------------------
function wireHandlers() {
  if (_wired) return;
  _wired = true;

  const signInForm = el('auth-form');
  if (signInForm) {
    signInForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      setError('');
      setBusy(true);
      setStatus('Signing in…');
      const email = (el('auth-email')?.value || '').trim();
      const password = el('auth-password')?.value || '';
      const result = await signIn(email, password);
      setBusy(false);
      if (!result.ok) {
        setStatus('');
        setError(result.error);
        return;
      }
      const passwordField = el('auth-password');
      if (passwordField) passwordField.value = '';
      setStatus('');
      await afterAuthenticated({ freshSignIn: true });
    });
  }

  const lockForm = el('lock-form');
  if (lockForm) {
    lockForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      setError('');
      const waiting = getCooldownRemainingMs();
      if (waiting > 0) { setError(cooldownMessage(waiting)); return; }

      setBusy(true);
      const secret = el('lock-secret')?.value || '';
      const result = await verifyDeviceLock(secret);
      setBusy(false);
      const field = el('lock-secret');
      if (field) field.value = '';

      if (!result.ok) {
        setError(result.cooldownMs > 0 ? cooldownMessage(result.cooldownMs) : (result.reason || 'Incorrect passcode.'));
        const container = el('auth-card');
        if (container) {
          container.classList.add('shake');
          container.addEventListener('animationend', () => container.classList.remove('shake'), { once: true });
        }
        return;
      }
      markUnlocked();
      enterApp();
    });
  }

  const signOutFromLock = el('lock-signout');
  if (signOutFromLock) {
    signOutFromLock.addEventListener('click', () => { signOut(); });
  }

  const setupForm = el('lock-setup-form');
  if (setupForm) {
    setupForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      setError('');
      const secret = el('lock-setup-secret')?.value || '';
      const confirmation = el('lock-setup-confirm')?.value || '';
      const policy = validateSecret(secret);
      if (!policy.ok) { setError(policy.reason); return; }
      if (secret !== confirmation) { setError('The two entries do not match.'); return; }

      setBusy(true);
      const result = await setDeviceLock(secret);
      setBusy(false);
      if (!result.ok) { setError(result.reason || 'Could not set the passcode.'); return; }
      markUnlocked();
      enterApp();
    });
  }

  const skipSetup = el('lock-setup-skip');
  if (skipSetup) {
    skipSetup.addEventListener('click', () => { declineLock(); markUnlocked(); enterApp(); });
  }
}

function enterApp() {
  setError('');
  setStatus('');
  hideGate();
  if (_onAuthenticated) {
    const start = _onAuthenticated;
    _onAuthenticated = null;
    start();
  }
}

async function afterAuthenticated({ freshSignIn }) {
  if (deviceLockRequired()) {
    showGate();
    showView('lock');
    setStatus('This device is locked. Your account is still signed in.');
    return;
  }
  if (freshSignIn && CONFIG.DEVICE_LOCK_ENABLED && !isDeviceLockSet() && !lockDeclined()) {
    showGate();
    showView('setup');
    setStatus('Optional: lock this device so your data is not visible if someone else picks it up. This is a privacy lock, not your account password.');
    return;
  }
  markUnlocked();
  enterApp();
}

/**
 * Boot the gate. `onAuthenticated` runs exactly once, only after a real
 * Supabase session exists (and the device lock, if any, is satisfied).
 * @param {() => void} onAuthenticated
 */
export async function initAuth(onAuthenticated) {
  _onAuthenticated = onAuthenticated;
  wireHandlers();
  watchAuthChanges();

  showGate();
  showView('signin');
  setStatus('Checking your session…');

  const restored = await restoreSession();
  setStatus('');

  if (restored.ok && isAuthenticated()) {
    await afterAuthenticated({ freshSignIn: false });
    return;
  }

  showView('signin');
  if (restored.offline) {
    setStatus('You appear to be offline. Sign in when you have a connection.');
  } else if (restored.error) {
    setError(restored.error);
  }
  const emailField = el('auth-email');
  if (emailField) emailField.focus();
}

/** Exposed for the app shell / settings: forget the lock on this device. */
export function forgetDeviceLock() {
  clearDeviceLock();
  try { localStorage.removeItem(LOCK_DECLINED_KEY); } catch { /* ignore */ }
}

/** Current gate-relevant state, for tests and UI. */
export function authSnapshot() {
  return { ...getAuthState(), deviceLockSet: isDeviceLockSet(), deviceLockRequired: deviceLockRequired() };
}
