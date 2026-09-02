/* eslint-env browser */
// ============================================================
// REPOSITORY FACADE — the single entry point module code uses.
//
// It owns the current owner id, boots the local database, runs the legacy
// migration, and exposes local-first read/write helpers that return an
// explicit {status} rather than a Supabase response. Module stores call these;
// renderers call module stores. Nothing outside js/data/ talks to IndexedDB.
//
// If the local database is unusable (private mode, blocked, quota) the app
// still runs from the legacy localStorage mirror, but a save is reported as
// `unavailable` instead of pretending it was durable.
// ============================================================

import { openDatabase, LocalStorageUnavailableError } from './indexedDb.js';
import { initOutbox, pendingCount } from './outbox.js';
import {
  DOCUMENT_IDS, DOCUMENT_TABLES, readDocument, readAllDocuments, saveDocument, adoptRemoteDocument, setRemoteRevision,
} from './documentRepository.js';
import {
  readLogsByDate, readCustomHabits, setHabitLog, clearAllLogs,
  createCustomHabit, updateCustomHabit, deleteCustomHabit,
} from './habitRepository.js';
import { migrateLegacyDocuments, LEGACY_KEYS } from './migrations.js';
import {
  dbGetDocumentRevisioned, dbWriteDocumentRevisioned, dbUpsertLog, dbDeleteAllLogs,
  dbCreateCustomHabit, dbUpdateCustomHabit, dbDeleteCustomHabit,
} from '../db.js';
import { setOwner, flush, hydrateFromRemote, setOnline, getSyncState, onSyncStateChanged, onRemoteAdopted } from './reconcile.js';
import { listConflicts, countConflicts } from './conflicts.js';

let _userId = null;
let _localReady = false;
let _localError = null;
/**
 * 'pending' until initRepositories() settles, then 'ready' or 'unavailable'.
 * @type {'pending'|'ready'|'unavailable'}
 */
let _localStatus = 'pending';

export { onSyncStateChanged, onRemoteAdopted, getSyncState, flush, setOnline, hydrateFromRemote, listConflicts, countConflicts };
export { DOCUMENT_IDS, LEGACY_KEYS };

export function currentOwner() { return _userId; }
export function localStoreReady() { return _localReady; }
export function localStoreError() { return _localError; }
/** @returns {'pending'|'ready'|'unavailable'} */
export function localStoreStatus() { return _localStatus; }

/**
 * Boot the local layer for one owner.
 * @param {string} userId
 * @param {Record<string, (value:any)=>any>} normalizers per-store normalisers
 */
export async function initRepositories(userId, normalizers = {}) {
  _userId = userId;
  setOwner(userId);
  try {
    await openDatabase();
    _localReady = true;
    _localStatus = 'ready';
  } catch (err) {
    _localReady = false;
    _localStatus = 'unavailable';
    _localError = err instanceof LocalStorageUnavailableError ? err : new LocalStorageUnavailableError(String(err));
    console.warn('[repository] local database unavailable — running from the legacy mirror:', _localError.message);
    return { ready: false, error: _localError, migration: [] };
  }

  await initOutbox();
  const migration = await migrateLegacyDocuments(userId, normalizers);
  return { ready: true, migration };
}

/** Every locally stored document, keyed by store id: `{ split: <doc>, ... }`. */
export async function loadLocalDocuments() {
  if (!_localReady || !_userId) return {};
  const records = await readAllDocuments(_userId);
  const out = {};
  for (const [storeId, record] of Object.entries(records)) out[storeId] = record.data;
  return out;
}

/** One locally stored document, or null. */
export async function loadLocalDocument(storeId) {
  if (!_localReady || !_userId) return null;
  const record = await readDocument(storeId, _userId);
  return record ? record.data : null;
}

/**
 * Durably store a document and queue its cloud write.
 * @returns {Promise<import('./types.js').RepositoryResult>}
 */
export async function persistDocument(storeId, data) {
  if (!_userId) return { status: 'error', error: new Error('no owner') };
  if (!_localReady) return directDocumentWrite(storeId, data);
  const result = await saveDocument(storeId, _userId, data);
  if (result.status === 'local') flush();
  return result;
}

/** Re-base the local copy on a remote revision we have now observed. */
export async function rebaseDocument(storeId, remoteRevision) {
  if (!_localReady || !_userId) return { status: 'unavailable' };
  await setRemoteRevision(storeId, _userId, remoteRevision);
  return { status: 'local' };
}

/** Adopt a remote document without queueing a write (conflict resolution). */
export async function adoptDocument(storeId, data, remoteRevision, remoteUpdatedAt) {
  if (!_localReady || !_userId) return { status: 'unavailable' };
  const record = await adoptRemoteDocument(storeId, _userId, data, remoteRevision, remoteUpdatedAt);
  return { status: 'local', value: record };
}

// ---- degraded mode: no local database ------------------------------------
//
// Private browsing, a blocked upgrade, or a device that refuses storage leaves
// us with no durable local layer. The app still READS fine — every module store
// keeps its legacy localStorage mirror — so rather than turning the app
// read-only, a write goes straight to the cloud and reports what actually
// happened. What it must never do is claim a durable save it did not make.

/** @returns {Promise<import('./types.js').RepositoryResult>} */
async function directDocumentWrite(storeId, data) {
  const table = DOCUMENT_TABLES[storeId];
  if (!table) return { status: 'unavailable', error: _localError };
  try {
    const remote = await dbGetDocumentRevisioned(table);
    // An optional table that is not installed has no cloud copy to fail at;
    // the module's own localStorage mirror is the whole story.
    if (remote.missing) return { status: 'local' };
    if (remote.error) return { status: 'unavailable', error: remote.error };

    const result = await dbWriteDocumentRevisioned(table, data, remote.data ? remote.data.revision : null);
    if (result.missing) return { status: 'local' };
    if (result.applied) return { status: 'synced' };
    return { status: 'unavailable', error: result.error || new Error('the cloud copy changed under a device with no local storage') };
  } catch (err) {
    return { status: 'unavailable', error: err };
  }
}

/** @returns {Promise<import('./types.js').RepositoryResult>} */
async function directCall(run) {
  try {
    const { error } = await run();
    return error ? { status: 'unavailable', error } : { status: 'synced' };
  } catch (err) {
    return { status: 'unavailable', error: err };
  }
}

// ---- habit rows -----------------------------------------------------------

export async function loadLocalLogs() {
  if (!_localReady || !_userId) return {};
  return readLogsByDate(_userId);
}

export async function loadLocalCustomHabits() {
  if (!_localReady || !_userId) return [];
  return readCustomHabits(_userId);
}

/**
 * Toggle one habit log. `linkedDocument` makes the linked Stimulation change
 * part of the same durable transaction.
 */
export async function persistHabitLog(date, habitId, completed, linkedDocument = null) {
  if (!_userId) return { status: 'error', error: new Error('no owner') };
  if (!_localReady) {
    const log = await directCall(() => dbUpsertLog(date, habitId, completed));
    if (log.status !== 'synced' || !linkedDocument) return log;
    return directDocumentWrite(linkedDocument.storeId, linkedDocument.data);
  }
  const result = await setHabitLog(_userId, date, habitId, completed, linkedDocument);
  if (result.status === 'local') flush();
  return result;
}

export async function persistCustomHabitCreate(row) {
  if (!_userId) return { status: 'error', error: new Error('no owner') };
  if (!_localReady) return directCall(() => dbCreateCustomHabit(row));
  const result = await createCustomHabit(_userId, row);
  if (result.status === 'local') flush();
  return result;
}

export async function persistCustomHabitUpdate(id, updates) {
  if (!_userId) return { status: 'error', error: new Error('no owner') };
  if (!_localReady) return directCall(() => dbUpdateCustomHabit(id, updates));
  const result = await updateCustomHabit(_userId, id, updates);
  if (result.status === 'local') flush();
  return result;
}

export async function persistCustomHabitDelete(id) {
  if (!_userId) return { status: 'error', error: new Error('no owner') };
  if (!_localReady) return directCall(() => dbDeleteCustomHabit(id));
  const result = await deleteCustomHabit(_userId, id);
  if (result.status === 'local') flush();
  return result;
}

export async function persistClearAllLogs() {
  if (!_userId) return { status: 'error', error: new Error('no owner') };
  if (!_localReady) return directCall(() => dbDeleteAllLogs());
  await clearAllLogs(_userId);
  flush();
  return { status: 'local' };
}

/** How many operations are still waiting to reach the cloud. */
export async function outboxSize() {
  if (!_localReady || !_userId) return 0;
  return pendingCount(_userId);
}
