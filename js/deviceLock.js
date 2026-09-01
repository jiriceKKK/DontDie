// ============================================================
// On-device privacy lock.
//
// WHAT THIS IS: a convenience screen so a returning owner is not showing their
// journal to whoever picks the phone up. It is enabled by the owner, stored
// per device, and verified entirely offline.
//
// WHAT THIS IS NOT: authorization. It never gates a Supabase request, never
// unlocks data by itself, and cannot be the reason a database row is readable.
// Cloud access is decided by the Supabase Auth session plus Row Level Security
// (see supabase/migrations/001_owner_auth_and_rls.sql).
//
// The stored verifier is a salted PBKDF2-SHA-256 derivation of the secret.
// The secret itself is never stored. Failed attempts are throttled with an
// escalating cooldown so a short numeric secret cannot be ground down quickly
// by someone holding the device.
// ============================================================

const STORE_KEY = 'dontdie_device_lock_v1';
const THROTTLE_KEY = 'dontdie_device_lock_throttle_v1';

export const PBKDF2_ITERATIONS = 210000;
export const MIN_DIGIT_LENGTH = 6;
export const MIN_PASSPHRASE_LENGTH = 6;
export const MAX_SECRET_LENGTH = 256;

/** Cooldown after N consecutive failures, in milliseconds. */
const COOLDOWN_STEPS = [0, 0, 0, 5_000, 15_000, 60_000, 300_000];
const MAX_COOLDOWN_MS = 900_000;

// ---- storage seam ---------------------------------------------------------
// Falls back to an in-memory map so the module is unit-testable in Node and
// never throws in a browser with storage disabled.
const memoryStore = new Map();

function storage() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
  } catch { /* storage blocked (private mode / iframe) */ }
  return {
    getItem: k => (memoryStore.has(k) ? memoryStore.get(k) : null),
    setItem: (k, v) => { memoryStore.set(k, String(v)); },
    removeItem: k => { memoryStore.delete(k); },
  };
}

function readJson(key) {
  try {
    const raw = storage().getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function writeJson(key, value) {
  try { storage().setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

function removeKey(key) {
  try { storage().removeItem(key); } catch { /* ignore */ }
}

// ---- crypto helpers -------------------------------------------------------
function subtle() {
  const c = globalThis.crypto;
  if (!c || !c.subtle) throw new Error('WebCrypto is unavailable');
  return c.subtle;
}

function toHex(bytes) {
  return Array.from(new Uint8Array(bytes)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  const clean = typeof hex === 'string' ? hex.trim() : '';
  if (!/^(?:[0-9a-f]{2})+$/i.test(clean)) return new Uint8Array(0);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Comparison whose duration does not depend on where the first difference is. */
export function timingSafeEqualHex(a, b) {
  const left = fromHex(a);
  const right = fromHex(b);
  if (left.length === 0 || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

async function derive(secret, saltHex, iterations) {
  const key = await subtle().importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const bits = await subtle().deriveBits(
    { name: 'PBKDF2', salt: fromHex(saltHex), iterations, hash: 'SHA-256' },
    key,
    256,
  );
  return toHex(bits);
}

// ---- secret policy --------------------------------------------------------
/**
 * @param {string} secret
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateSecret(secret) {
  const value = typeof secret === 'string' ? secret : '';
  if (!value) return { ok: false, reason: 'Enter a passcode.' };
  if (value.length > MAX_SECRET_LENGTH) return { ok: false, reason: 'Passcode is too long.' };
  if (/^\d+$/.test(value)) {
    if (value.length < MIN_DIGIT_LENGTH) return { ok: false, reason: `Use at least ${MIN_DIGIT_LENGTH} digits, or a passphrase.` };
    if (/^(\d)\1+$/.test(value)) return { ok: false, reason: 'Do not repeat a single digit.' };
    return { ok: true };
  }
  if (value.length < MIN_PASSPHRASE_LENGTH) return { ok: false, reason: `Use at least ${MIN_PASSPHRASE_LENGTH} characters.` };
  return { ok: true };
}

// ---- lock lifecycle -------------------------------------------------------
/** @returns {boolean} */
export function isDeviceLockSet() {
  const record = readJson(STORE_KEY);
  return !!(record && record.v === 1 && record.salt && record.hash && record.iterations);
}

/**
 * Create or replace the device lock.
 * @param {string} secret
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function setDeviceLock(secret) {
  const check = validateSecret(secret);
  if (!check.ok) return check;

  const salt = new Uint8Array(16);
  globalThis.crypto.getRandomValues(salt);
  const saltHex = toHex(salt);
  const hash = await derive(secret, saltHex, PBKDF2_ITERATIONS);

  const stored = writeJson(STORE_KEY, {
    v: 1,
    algo: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    salt: saltHex,
    hash,
    createdAt: new Date().toISOString(),
  });
  if (!stored) return { ok: false, reason: 'This device would not store the lock.' };

  resetThrottle();
  return { ok: true };
}

/** Remove the lock from this device. Does not touch the cloud session. */
export function clearDeviceLock() {
  removeKey(STORE_KEY);
  resetThrottle();
}

/**
 * Verify an entered secret against the stored verifier, applying throttling.
 * @param {string} secret
 * @returns {Promise<{ ok: boolean, reason?: string, cooldownMs?: number }>}
 */
export async function verifyDeviceLock(secret) {
  const cooldownMs = getCooldownRemainingMs();
  if (cooldownMs > 0) return { ok: false, reason: 'Too many attempts.', cooldownMs };

  const record = readJson(STORE_KEY);
  if (!record || record.v !== 1) return { ok: false, reason: 'No device lock is set.' };

  const iterations = Number(record.iterations) || PBKDF2_ITERATIONS;
  let candidate;
  try {
    candidate = await derive(typeof secret === 'string' ? secret : '', record.salt, iterations);
  } catch {
    return { ok: false, reason: 'Could not verify on this device.' };
  }

  if (timingSafeEqualHex(candidate, record.hash)) {
    resetThrottle();
    return { ok: true };
  }

  const failures = registerFailure();
  const nextCooldown = getCooldownRemainingMs();
  return {
    ok: false,
    reason: nextCooldown > 0 ? 'Too many attempts.' : 'Incorrect passcode.',
    cooldownMs: nextCooldown,
    failures,
  };
}

// ---- throttling -----------------------------------------------------------
function cooldownFor(failures) {
  if (failures < COOLDOWN_STEPS.length) return COOLDOWN_STEPS[failures];
  return MAX_COOLDOWN_MS;
}

function registerFailure() {
  const record = readJson(THROTTLE_KEY) || { failures: 0 };
  const failures = (Number(record.failures) || 0) + 1;
  writeJson(THROTTLE_KEY, { failures, until: Date.now() + cooldownFor(failures) });
  return failures;
}

/** @returns {number} milliseconds still to wait before another attempt */
export function getCooldownRemainingMs(now = Date.now()) {
  const record = readJson(THROTTLE_KEY);
  if (!record) return 0;
  const until = Number(record.until) || 0;
  return until > now ? until - now : 0;
}

/** @returns {number} consecutive failed attempts */
export function getFailureCount() {
  const record = readJson(THROTTLE_KEY);
  return record ? (Number(record.failures) || 0) : 0;
}

export function resetThrottle() {
  removeKey(THROTTLE_KEY);
}

/** Test seam: the stored verifier record, so tests can prove what is kept. */
export function _readStoredRecordForTests() {
  return readJson(STORE_KEY);
}

/** Test seam. */
export function _resetDeviceLockForTests() {
  removeKey(STORE_KEY);
  removeKey(THROTTLE_KEY);
  memoryStore.clear();
}
