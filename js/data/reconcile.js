/* eslint-env browser */
// ============================================================
// RECONCILER — the only place in the app that performs a remote write.
//
// It drains the durable outbox in enqueue order, one operation at a time, so
// two writes for the same document can never be in flight together and a late
// response can never install an older snapshot as current. Document writes are
// compare-and-set; when the server has moved on, BOTH snapshots are kept as a
// conflict and the operation is parked instead of overwriting anything.
//
// It also hydrates from the cloud in the background after the UI has already
// rendered local state, and it never resurrects a local delete.
// ============================================================

import {
  dbGetDocumentRevisioned, dbWriteDocumentRevisioned,
  dbUpsertLog, dbDeleteAllLogs, dbGetLogsForRange, dbGetCustomHabits,
  dbCreateCustomHabit, dbUpdateCustomHabit, dbDeleteCustomHabit,
} from '../db.js';
import { DOCUMENT_TABLES, readDocument, markDocumentSynced, adoptRemoteDocument, setRemoteRevision, isDirty } from './documentRepository.js';
import {
  markLogSynced, hydrateLogs, hydrateCustomHabits, forgetCustomHabit, reidentifyCustomHabit,
} from './habitRepository.js';
import { STORE, runTx } from './indexedDb.js';
import { pendingFor, acknowledge, recordFailure, rebase, isDue, resetBackoff } from './outbox.js';
import { recordConflict, conflictId } from './conflicts.js';

/** Aggregate sync state broadcast to the shell. @type {import('./types.js').SyncState} */
let _state = 'synced';
let _userId = null;
let _flushing = null;
let _flushQueued = false;
let _online = true;
let _retryTimer = null;
/** Document stores whose remote table is not installed (production has no habit_config). */
const _missingTables = new Set();

const stateListeners = new Set();
const adoptListeners = new Set();

export function onSyncStateChanged(listener) {
  stateListeners.add(listener);
  try { listener(_state); } catch { /* a listener must not break the reconciler */ }
  return () => stateListeners.delete(listener);
}

/** Notified when a remote copy has been adopted so module stores can re-read. */
export function onRemoteAdopted(listener) {
  adoptListeners.add(listener);
  return () => adoptListeners.delete(listener);
}

export function getSyncState() { return _state; }
export function isOnline() { return _online; }
export function missingDocumentTables() { return [..._missingTables]; }

function setState(next) {
  if (_state === next) return;
  _state = next;
  for (const listener of stateListeners) {
    try { listener(next); } catch (err) { console.error('[sync] listener failed:', err); }
  }
}

function announceAdopted(storeId, data) {
  for (const listener of adoptListeners) {
    try { listener(storeId, data); } catch (err) { console.error('[sync] adopt listener failed:', err); }
  }
}

/** Bind the reconciler to one owner. Operations for anyone else are never sent. */
export function setOwner(userId) {
  _userId = userId;
}

// ---- outbox parking -------------------------------------------------------

/** Park an operation behind an unresolved conflict so it stops retrying. */
async function parkOperation(id, reason) {
  await runTx(STORE.outbox, 'readwrite', ({ store }) => {
    const outbox = store(STORE.outbox);
    outbox.get(id, existing => {
      if (!existing) return;
      existing.blockedBy = reason;
      outbox.put(existing);
    });
  });
}

/** Park every queued operation for one entity behind a conflict. */
async function parkOperationsFor(kind, entity, reason) {
  await runTx(STORE.outbox, 'readwrite', ({ store }) => {
    const outbox = store(STORE.outbox);
    outbox.getAll(ops => {
      for (const op of ops) {
        if (op.kind !== kind || op.entity !== entity) continue;
        op.blockedBy = reason;
        outbox.put(op);
      }
    });
  });
}

/** Release a parked operation after the owner resolved its conflict. */
export async function releaseOperations(kind, entity, baseRevision) {
  await runTx(STORE.outbox, 'readwrite', ({ store }) => {
    const outbox = store(STORE.outbox);
    outbox.getAll(ops => {
      for (const op of ops) {
        if (op.kind !== kind || op.entity !== entity || !op.blockedBy) continue;
        op.blockedBy = null;
        op.attempts = 0;
        op.nextAttemptAt = 0;
        if (baseRevision !== undefined) op.baseRevision = baseRevision;
        outbox.put(op);
      }
    });
  });
}

/** Drop parked operations for an entity (the owner chose the cloud copy). */
export async function discardOperations(kind, entity) {
  await runTx(STORE.outbox, 'readwrite', ({ store }) => {
    const outbox = store(STORE.outbox);
    outbox.getAll(ops => {
      for (const op of ops) if (op.kind === kind && op.entity === entity) outbox.delete(op.id);
    });
  });
}

// ---- per-operation execution ---------------------------------------------

function isNetworkError(err) {
  if (!err) return false;
  const message = String(err.message || err);
  return /Failed to fetch|NetworkError|network|offline|timeout/i.test(message) || err.name === 'TypeError';
}

async function runDocumentSave(op) {
  const table = op.payload.table || DOCUMENT_TABLES[op.payload.storeId];
  if (!table) return { done: true };
  if (_missingTables.has(op.payload.storeId)) return { done: true };

  const local = await readDocument(op.payload.storeId, op.userId);
  const expected = local ? local.remoteRevision : op.baseRevision;

  const result = await dbWriteDocumentRevisioned(table, op.payload.data, expected);
  if (result.missing) {
    // The optional table is not installed; the store stays fully functional
    // locally. Acknowledge so the operation does not retry forever.
    _missingTables.add(op.payload.storeId);
    return { done: true };
  }
  if (result.error) return { done: false, error: result.error };

  if (result.applied) {
    await markDocumentSynced(op.payload.storeId, op.userId, op.payload.localRevision, result.revision);
    return { done: true };
  }

  // Not applied and no error: the server revision moved on.
  const remote = await dbGetDocumentRevisioned(table);
  if (remote.error) return { done: false, error: remote.error };

  if (!remote.data) {
    // The row vanished (a reset elsewhere). Re-create from this device.
    await setRemoteRevision(op.payload.storeId, op.userId, null);
    return { done: false, retryNow: true };
  }

  if (sameJson(remote.data.data, op.payload.data)) {
    // Someone already wrote exactly this — idempotent success.
    await markDocumentSynced(op.payload.storeId, op.userId, op.payload.localRevision, remote.data.revision);
    return { done: true };
  }

  if (expected === null || expected === undefined) {
    // We believed there was no row. There is one, and it differs — adopt its
    // revision and retry the compare-and-set against reality.
    await setRemoteRevision(op.payload.storeId, op.userId, remote.data.revision);
    return { done: false, retryNow: true };
  }

  await recordConflict({
    userId: op.userId,
    kind: 'document',
    entity: op.payload.storeId,
    storeId: op.payload.storeId,
    localData: op.payload.data,
    remoteData: remote.data.data,
    localUpdatedAt: (local && local.updatedAt) || op.createdAt,
    remoteUpdatedAt: remote.data.updatedAt,
    remoteRevision: remote.data.revision,
  });
  await parkOperation(op.id, conflictId('document', op.payload.storeId, op.userId));
  return { done: false, conflict: true };
}

async function runHabitLogUpsert(op) {
  const { error } = await dbUpsertLog(op.payload.date, op.payload.habitId, op.payload.completed);
  if (error) return { done: false, error };
  await markLogSynced(op.userId, op.payload.date, op.payload.habitId, op.payload.localRevision);
  return { done: true };
}

async function runHabitLogDeleteAll(op) {
  const { error } = await dbDeleteAllLogs();
  if (error) return { done: false, error };
  await runTx(STORE.habitLogs, 'readwrite', ({ store }) => {
    const logs = store(STORE.habitLogs);
    logs.getAll(all => {
      for (const log of all) if (log.userId === op.userId && log.deleted) logs.delete(log.key);
    });
  });
  return { done: true };
}

async function runCustomHabitOp(op) {
  if (op.op === 'create') {
    const { data, error } = await dbCreateCustomHabit(op.payload.row);
    if (error) return { done: false, error };
    if (data && String(data.id) !== String(op.payload.row.id)) {
      await reidentifyCustomHabit(op.userId, op.payload.row.id, data);
    }
    return { done: true };
  }
  if (op.op === 'update') {
    const { error } = await dbUpdateCustomHabit(op.payload.id, op.payload.updates);
    if (error) return { done: false, error };
    return { done: true };
  }
  if (op.op === 'delete') {
    const { error } = await dbDeleteCustomHabit(op.payload.id);
    if (error) return { done: false, error };
    await forgetCustomHabit(op.payload.id);
    return { done: true };
  }
  return { done: true };
}

function sameJson(a, b) {
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

async function runOperation(op) {
  if (op.kind === 'document') return runDocumentSave(op);
  if (op.kind === 'habitLog') return op.op === 'deleteAll' ? runHabitLogDeleteAll(op) : runHabitLogUpsert(op);
  if (op.kind === 'customHabit') return runCustomHabitOp(op);
  return { done: true };
}

// ---- flush ----------------------------------------------------------------

/**
 * Drain the outbox. Sequential by design: ordering is part of correctness.
 * @returns {Promise<{sent: number, failed: number, conflicts: number, remaining: number}>}
 */
export async function flush() {
  // A flush requested while one is running is remembered rather than dropped:
  // the running pass may already have walked past the operation that prompted
  // it, or may have been started while the link was still down.
  if (_flushing) { _flushQueued = true; return _flushing; }
  _flushing = (async () => {
    const summary = { sent: 0, failed: 0, conflicts: 0, remaining: 0 };
    if (!_userId) return summary;

    let queue = await pendingFor(_userId);
    if (queue.length === 0) { setState('synced'); return summary; }
    setState('syncing');

    const now = Date.now();
    for (const op of queue) {
      if (op.blockedBy) { summary.conflicts += 1; continue; }
      if (!isDue(op, now)) continue;
      if (op.userId !== _userId) continue; // never send another account's work

      let result;
      try {
        result = await runOperation(op);
      } catch (err) {
        result = { done: false, error: err };
      }

      if (result.done) { await acknowledge(op.id); summary.sent += 1; continue; }
      if (result.conflict) { summary.conflicts += 1; continue; }
      if (result.retryNow) {
        try {
          const retry = await runOperation(op);
          if (retry.done) { await acknowledge(op.id); summary.sent += 1; continue; }
          if (retry.conflict) { summary.conflicts += 1; continue; }
          await recordFailure(op.id, retry.error);
        } catch (err) {
          await recordFailure(op.id, err);
        }
        summary.failed += 1;
        continue;
      }
      await recordFailure(op.id, result.error);
      summary.failed += 1;
      if (isNetworkError(result.error)) {
        // Believe the failure over navigator.onLine, which lies often enough to
        // matter. The shell should then say "offline", not "sync failed".
        _online = false;
        break;
      }
    }

    queue = await pendingFor(_userId);
    summary.remaining = queue.length;

    if (summary.conflicts > 0) setState('conflict');
    else if (summary.failed > 0) setState(_online ? 'failed' : 'offline');
    else if (summary.remaining > 0) setState(_online ? 'saved-local' : 'offline');
    else setState('synced');

    scheduleRetry(summary.remaining > 0);
    return summary;
  })().finally(() => {
    _flushing = null;
    if (_flushQueued) { _flushQueued = false; flush(); }
  });
  return _flushing;
}

/** Keep one timer, not one per queued item. */
function scheduleRetry(needed) {
  if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; }
  if (!needed) return;
  _retryTimer = setTimeout(() => { _retryTimer = null; flush(); }, 30_000);
}

/** Online/offline transitions. Going online flushes immediately. */
export function setOnline(online) {
  _online = online;
  if (!online) { setState('offline'); return; }
  // Restoring connectivity always invalidates a backoff that was scheduled
  // because the link was down, so retry now rather than after a timer the user
  // cannot see. This runs even when we already believed we were online: the
  // caller is asserting that connectivity changed, and navigator.onLine is not
  // reliable enough to argue with.
  if (_userId) resetBackoff(_userId).then(flush, () => flush());
  else flush();
}

// ---- background hydration -------------------------------------------------

/**
 * Reconcile with the cloud after the UI already rendered local state.
 * Local edits that have not been acknowledged always win; a local delete is
 * never resurrected.
 * @param {{ rangeStart: string, rangeEnd: string }} window
 */
export async function hydrateFromRemote({ rangeStart, rangeEnd }) {
  if (!_userId) return { ok: false };
  const adopted = [];

  // Documents first — they drive most of the UI.
  for (const [storeId, table] of Object.entries(DOCUMENT_TABLES)) {
    if (_missingTables.has(storeId)) continue;
    const remote = await dbGetDocumentRevisioned(table);
    if (remote.missing) { _missingTables.add(storeId); continue; }
    if (remote.error || !remote.data) continue;

    const local = await readDocument(storeId, _userId);
    if (!local) {
      const record = await adoptRemoteDocument(storeId, _userId, remote.data.data, remote.data.revision, remote.data.updatedAt);
      adopted.push(storeId);
      announceAdopted(storeId, record.data);
      continue;
    }
    if (isDirty(local)) {
      if (local.remoteRevision !== null) continue;   // our queued write resolves it

      // Never synced from this device — a migrated localStorage document, or a
      // first write made offline. Adopting the server revision here would hand
      // the queued write permission to overwrite a cloud copy this device has
      // never seen, which is exactly the silent clobber this phase removes.
      if (sameJson(local.data, remote.data.data)) {
        await setRemoteRevision(storeId, _userId, remote.data.revision);
        continue;
      }
      await recordConflict({
        userId: _userId,
        kind: 'document',
        entity: storeId,
        storeId,
        localData: local.data,
        remoteData: remote.data.data,
        localUpdatedAt: local.updatedAt,
        remoteUpdatedAt: remote.data.updatedAt,
        remoteRevision: remote.data.revision,
      });
      await parkOperationsFor('document', storeId, conflictId('document', storeId, _userId));
      continue;
    }
    if (local.remoteRevision !== null && local.remoteRevision === remote.data.revision) continue;
    if (sameJson(local.data, remote.data.data)) {
      await setRemoteRevision(storeId, _userId, remote.data.revision);
      continue;
    }
    const record = await adoptRemoteDocument(storeId, _userId, remote.data.data, remote.data.revision, remote.data.updatedAt);
    adopted.push(storeId);
    announceAdopted(storeId, record.data);
  }

  // Habit rows: independently keyed, so a row-wise merge is safe.
  const logs = await dbGetLogsForRange(rangeStart, rangeEnd);
  if (!logs.error) await hydrateLogs(_userId, logs.data || {});

  const habits = await dbGetCustomHabits();
  if (!habits.error) await hydrateCustomHabits(_userId, habits.data || []);

  return { ok: true, adopted };
}
