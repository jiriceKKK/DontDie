/* eslint-env browser */
// ============================================================
// LEGACY MIGRATION — localStorage documents to IndexedDB.
//
// Non-destructive by contract:
//   * every legacy key is READ and never removed, so the old release remains a
//     working recovery path for at least one cycle;
//   * each store is migrated in its own transaction and its marker is written
//     only after the record reads back, so an interrupted run simply resumes;
//   * an unparsable key is NEVER treated as empty. It is recorded as a local
//     recovery conflict holding the raw string, so nothing is silently lost.
// ============================================================

import { STORE, runTx, getMeta, setMeta, isQuotaError } from './indexedDb.js';
import { documentKey } from './documentRepository.js';
import { recordConflict } from './conflicts.js';

/** Legacy localStorage keys, in the order the modules were introduced. */
export const LEGACY_KEYS = {
  split: 'dontdie_split_v1',
  mental: 'dontdie_mh_v1',
  mindTexts: 'dontdie_mind_texts_v1',
  stimulation: 'dontdie_stim_v1',
  school: 'dontdie_school_v1',
  habitConfig: 'dontdie_habitcfg_v1',
};

const MARKER_PREFIX = 'migration:localStorage->idb:v1:';

export function markerKey(storeId, userId) {
  return `${MARKER_PREFIX}${userId}::${storeId}`;
}

function readRaw(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

/**
 * Migrate one store. Idempotent: a completed store is skipped, and a run that
 * died before its marker was written simply repeats the same write.
 * @returns {Promise<{storeId: string, status: 'migrated'|'skipped'|'empty'|'unreadable'|'failed', error?: any, quota?: boolean}>}
 */
export async function migrateStore(storeId, userId, normalize) {
  const legacyKey = LEGACY_KEYS[storeId];
  if (!legacyKey) return { storeId, status: 'skipped' };

  if (await getMeta(markerKey(storeId, userId))) return { storeId, status: 'skipped' };

  const raw = readRaw(legacyKey);
  if (raw === null || raw === '') {
    await setMeta(markerKey(storeId, userId), { at: new Date().toISOString(), source: 'empty' });
    return { storeId, status: 'empty' };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    // Keep the raw text so the owner can export and inspect it. The marker is
    // deliberately NOT written: a future release may be able to read it.
    await recordConflict({
      userId,
      kind: 'document',
      entity: `legacy:${storeId}`,
      storeId,
      localData: { unparsableLegacyValue: raw.slice(0, 200_000) },
      remoteData: null,
      localUpdatedAt: new Date().toISOString(),
    });
    console.error(`[migrate] ${legacyKey} could not be parsed; kept for recovery`, err);
    return { storeId, status: 'unreadable', error: err };
  }

  let value = parsed;
  if (typeof normalize === 'function') {
    try { value = normalize(parsed); } catch (err) {
      console.error(`[migrate] normalising ${storeId} failed; storing the raw document`, err);
      value = parsed;
    }
  }

  const key = documentKey(storeId, userId);
  try {
    await runTx(STORE.documents, 'readwrite', ({ store }) => {
      const documents = store(STORE.documents);
      documents.get(key, existing => {
        // A local record already exists (an interrupted run, or the app has
        // been used since). Never overwrite it with older legacy data.
        if (existing) return;
        documents.put({
          id: key,
          userId,
          storeId,
          data: value,
          localRevision: 1,
          // Migrated data is not yet known to the server, so it stays dirty and
          // the reconciler will push it under compare-and-set.
          syncedRevision: 0,
          remoteRevision: null,
          updatedAt: (value && value.updatedAt) || new Date().toISOString(),
        });
      });
    });
  } catch (err) {
    return { storeId, status: 'failed', error: err, quota: isQuotaError(err) };
  }

  // Verify before claiming success: the marker means "this data is in IndexedDB".
  const stored = await runTx(STORE.documents, 'readonly', ({ store, out }) => {
    store(STORE.documents).get(key, value2 => { out.value = value2; });
  });
  if (!stored) return { storeId, status: 'failed', error: new Error('record did not read back') };

  await setMeta(markerKey(storeId, userId), { at: new Date().toISOString(), source: legacyKey });
  return { storeId, status: 'migrated' };
}

/**
 * Migrate every legacy document store.
 * @param {string} userId
 * @param {Record<string, (value: any) => any>} normalizers
 */
export async function migrateLegacyDocuments(userId, normalizers = {}) {
  const results = [];
  for (const storeId of Object.keys(LEGACY_KEYS)) {
    try {
      results.push(await migrateStore(storeId, userId, normalizers[storeId]));
    } catch (err) {
      results.push({ storeId, status: 'failed', error: err });
    }
  }
  return results;
}

/** True once every store has a marker — used by tests and diagnostics. */
export async function migrationComplete(userId) {
  for (const storeId of Object.keys(LEGACY_KEYS)) {
    if (!(await getMeta(markerKey(storeId, userId)))) return false;
  }
  return true;
}
