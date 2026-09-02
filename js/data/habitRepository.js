/* eslint-env browser */
// ============================================================
// HABIT REPOSITORY — local-first habit logs and custom habits.
//
// Habit logs are independently keyed by (userId, date, habitId), which is what
// makes them the ONE data set safe to merge automatically. Deletes leave
// tombstones so a stale cloud hydrate cannot resurrect them.
//
// A habit toggle that is linked to a Stimulation activity writes the habit
// log, the linked stimulation document and BOTH outbox operations inside one
// IndexedDB transaction, so the two halves of a single user action can never
// be separated by a crash or a lost connection.
// ============================================================

import { STORE, runTx, isQuotaError } from './indexedDb.js';
import { buildOperation, enqueueWithin } from './outbox.js';
import { DOCUMENT_TABLES, documentKey, structuredCloneSafe } from './documentRepository.js';

export function logKey(userId, date, habitId) {
  return `${userId}|${date}|${habitId}`;
}

/** Every non-tombstoned log for an owner, shaped as `{ date: { habitId: completed } }`. */
export async function readLogsByDate(userId) {
  const all = await runTx(STORE.habitLogs, 'readonly', ({ store, out }) => {
    store(STORE.habitLogs).getAll(values => { out.value = values; });
  });
  const byDate = {};
  for (const log of (all || [])) {
    if (log.userId !== userId || log.deleted) continue;
    if (!byDate[log.date]) byDate[log.date] = {};
    byDate[log.date][log.habitId] = !!log.completed;
  }
  return byDate;
}

/** Raw records, including tombstones — used by reconciliation and merges. */
export async function readLogRecords(userId) {
  const all = await runTx(STORE.habitLogs, 'readonly', ({ store, out }) => {
    store(STORE.habitLogs).getAll(values => { out.value = values; });
  });
  const byKey = {};
  for (const log of (all || [])) if (log.userId === userId) byKey[log.key] = log;
  return byKey;
}

function logRecord(userId, date, habitId, completed, existing) {
  return {
    key: logKey(userId, date, habitId),
    userId, date, habitId,
    completed: !!completed,
    deleted: false,
    localRevision: ((existing && existing.localRevision) || 0) + 1,
    syncedRevision: (existing && existing.syncedRevision) || 0,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Set one habit log locally and queue its cloud upsert.
 *
 * `linkedDocument` lets a stimulation-linked toggle be part of the same
 * transaction: `{ storeId, data }` is stored and queued alongside the log.
 *
 * @returns {Promise<import('./types.js').RepositoryResult>}
 */
export async function setHabitLog(userId, date, habitId, completed, linkedDocument = null) {
  const key = logKey(userId, date, habitId);
  let docSnapshot = null;
  if (linkedDocument) {
    try { docSnapshot = structuredCloneSafe(linkedDocument.data); }
    catch (err) { return { status: 'error', error: err }; }
  }

  const stores = linkedDocument
    ? [STORE.habitLogs, STORE.documents, STORE.outbox]
    : [STORE.habitLogs, STORE.outbox];

  try {
    const record = await runTx(stores, 'readwrite', ({ store, out }) => {
      const logs = store(STORE.habitLogs);
      const outbox = store(STORE.outbox);
      const documents = linkedDocument ? store(STORE.documents) : null;

      logs.get(key, existing => {
        const next = logRecord(userId, date, habitId, completed, existing);
        logs.put(next);
        out.value = next;

        // Collect both operations first so the outbox is read exactly once.
        const operations = [buildOperation({
          userId,
          kind: 'habitLog',
          entity: `${date}|${habitId}`,
          op: 'upsert',
          payload: { date, habitId, completed: !!completed, localRevision: next.localRevision },
        })];

        if (linkedDocument && documents) {
          const docId = documentKey(linkedDocument.storeId, userId);
          documents.get(docId, existingDoc => {
            const nextDoc = {
              id: docId,
              userId,
              storeId: linkedDocument.storeId,
              data: docSnapshot,
              localRevision: ((existingDoc && existingDoc.localRevision) || 0) + 1,
              syncedRevision: (existingDoc && existingDoc.syncedRevision) || 0,
              remoteRevision: existingDoc ? existingDoc.remoteRevision : null,
              updatedAt: new Date().toISOString(),
            };
            documents.put(nextDoc);
            operations.push(buildOperation({
              userId,
              kind: 'document',
              entity: linkedDocument.storeId,
              op: 'save',
              payload: {
                storeId: linkedDocument.storeId,
                table: DOCUMENT_TABLES[linkedDocument.storeId],
                data: docSnapshot,
                localRevision: nextDoc.localRevision,
              },
              baseRevision: nextDoc.remoteRevision,
            }));
            outbox.getAll(pending => {
              for (const operation of operations) enqueueWithin(outbox, pending, operation);
            });
          });
        } else {
          outbox.getAll(pending => {
            for (const operation of operations) enqueueWithin(outbox, pending, operation);
          });
        }
      });
    });
    return { status: 'local', value: record };
  } catch (err) {
    return { status: isQuotaError(err) ? 'unavailable' : 'error', error: err };
  }
}

/** Acknowledge a synced log without clobbering a newer local edit. */
export async function markLogSynced(userId, date, habitId, localRevision) {
  return runTx(STORE.habitLogs, 'readwrite', ({ store }) => {
    const logs = store(STORE.habitLogs);
    logs.get(logKey(userId, date, habitId), existing => {
      if (!existing) return;
      if ((existing.localRevision || 0) <= localRevision) existing.syncedRevision = existing.localRevision;
      logs.put(existing);
    });
  });
}

/**
 * Adopt remote logs for a date range without resurrecting anything the owner
 * deleted or overwriting an unsynced local edit.
 */
export async function hydrateLogs(userId, remoteByDate) {
  return runTx(STORE.habitLogs, 'readwrite', ({ store, out }) => {
    const logs = store(STORE.habitLogs);
    logs.getAll(existingAll => {
      const byKey = {};
      for (const log of existingAll) if (log.userId === userId) byKey[log.key] = log;
      let adopted = 0;
      for (const [date, habits] of Object.entries(remoteByDate || {})) {
        for (const [habitId, completed] of Object.entries(habits)) {
          const key = logKey(userId, date, habitId);
          const local = byKey[key];
          // A local edit the server has not acknowledged always wins; so does a
          // tombstone. Everything else adopts the remote value.
          if (local && ((local.localRevision || 0) > (local.syncedRevision || 0) || local.deleted)) continue;
          if (local && local.completed === !!completed) continue;
          const revision = ((local && local.localRevision) || 0) + 1;
          logs.put({
            key, userId, date, habitId,
            completed: !!completed,
            deleted: false,
            localRevision: revision,
            syncedRevision: revision,
            updatedAt: new Date().toISOString(),
          });
          adopted += 1;
        }
      }
      out.value = adopted;
    });
  });
}

/** Tombstone every log for an owner (Settings → clear data) and queue the remote delete. */
export async function clearAllLogs(userId) {
  return runTx([STORE.habitLogs, STORE.outbox], 'readwrite', ({ store, out }) => {
    const logs = store(STORE.habitLogs);
    const outbox = store(STORE.outbox);
    logs.getAll(all => {
      let removed = 0;
      for (const log of all) {
        if (log.userId !== userId) continue;
        logs.put({ ...log, deleted: true, completed: false, localRevision: (log.localRevision || 0) + 1, updatedAt: new Date().toISOString() });
        removed += 1;
      }
      out.value = removed;
      outbox.getAll(pending => {
        enqueueWithin(outbox, pending, buildOperation({
          userId, kind: 'habitLog', entity: '*', op: 'deleteAll', payload: {},
        }));
      });
    });
  });
}

// ---- custom habits --------------------------------------------------------

/** Live (non-tombstoned) custom habits for an owner, in sort order. */
export async function readCustomHabits(userId) {
  const all = await runTx(STORE.customHabits, 'readonly', ({ store, out }) => {
    store(STORE.customHabits).getAll(values => { out.value = values; });
  });
  return (all || [])
    .filter(record => record.userId === userId && !record.deleted)
    .map(record => record.row)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
}

/** Ids the owner has deleted locally — a hydrate must not bring them back. */
export async function readHabitTombstones(userId) {
  const all = await runTx(STORE.customHabits, 'readonly', ({ store, out }) => {
    store(STORE.customHabits).getAll(values => { out.value = values; });
  });
  return new Set((all || []).filter(r => r.userId === userId && r.deleted).map(r => r.id));
}

export async function createCustomHabit(userId, row) {
  const record = {
    id: String(row.id),
    userId,
    row,
    deleted: false,
    pendingCreate: true,
    localRevision: 1,
    syncedRevision: 0,
    updatedAt: new Date().toISOString(),
  };
  try {
    await runTx([STORE.customHabits, STORE.outbox], 'readwrite', ({ store }) => {
      store(STORE.customHabits).put(record);
      const outbox = store(STORE.outbox);
      outbox.getAll(pending => {
        enqueueWithin(outbox, pending, buildOperation({
          userId, kind: 'customHabit', entity: record.id, op: 'create', payload: { row },
        }));
      });
    });
    return { status: 'local', value: record };
  } catch (err) {
    return { status: isQuotaError(err) ? 'unavailable' : 'error', error: err };
  }
}

export async function updateCustomHabit(userId, id, updates) {
  try {
    const record = await runTx([STORE.customHabits, STORE.outbox], 'readwrite', ({ store, out }) => {
      const habits = store(STORE.customHabits);
      const outbox = store(STORE.outbox);
      habits.get(String(id), existing => {
        if (!existing) return;
        const next = {
          ...existing,
          row: { ...existing.row, ...updates },
          localRevision: (existing.localRevision || 0) + 1,
          updatedAt: new Date().toISOString(),
        };
        habits.put(next);
        out.value = next;
        outbox.getAll(pending => {
          enqueueWithin(outbox, pending, buildOperation({
            userId, kind: 'customHabit', entity: String(id), op: 'update', payload: { id, updates },
          }));
        });
      });
    });
    return { status: 'local', value: record };
  } catch (err) {
    return { status: isQuotaError(err) ? 'unavailable' : 'error', error: err };
  }
}

/** Tombstone a custom habit; the record survives until the remote delete lands. */
export async function deleteCustomHabit(userId, id) {
  try {
    await runTx([STORE.customHabits, STORE.outbox], 'readwrite', ({ store }) => {
      const habits = store(STORE.customHabits);
      const outbox = store(STORE.outbox);
      habits.get(String(id), existing => {
        habits.put({
          id: String(id),
          userId,
          row: existing ? existing.row : { id },
          deleted: true,
          pendingCreate: false,
          localRevision: ((existing && existing.localRevision) || 0) + 1,
          syncedRevision: (existing && existing.syncedRevision) || 0,
          updatedAt: new Date().toISOString(),
        });
        outbox.getAll(pending => {
          enqueueWithin(outbox, pending, buildOperation({
            userId, kind: 'customHabit', entity: String(id), op: 'delete', payload: { id },
          }));
        });
      });
    });
    return { status: 'local' };
  } catch (err) {
    return { status: isQuotaError(err) ? 'unavailable' : 'error', error: err };
  }
}

/** Drop a tombstone once the server has confirmed the delete. */
export async function forgetCustomHabit(id) {
  return runTx(STORE.customHabits, 'readwrite', ({ store }) => {
    const habits = store(STORE.customHabits);
    habits.get(String(id), existing => { if (existing && existing.deleted) habits.delete(String(id)); });
  });
}

/** Adopt server rows, respecting tombstones and unsynced local edits. */
export async function hydrateCustomHabits(userId, rows) {
  return runTx(STORE.customHabits, 'readwrite', ({ store, out }) => {
    const habits = store(STORE.customHabits);
    habits.getAll(existingAll => {
      const byId = {};
      for (const record of existingAll) if (record.userId === userId) byId[record.id] = record;
      let adopted = 0;
      for (const row of (rows || [])) {
        const id = String(row.id);
        const local = byId[id];
        if (local && (local.deleted || (local.localRevision || 0) > (local.syncedRevision || 0))) continue;
        const revision = ((local && local.localRevision) || 0) + 1;
        habits.put({
          id, userId, row,
          deleted: false,
          pendingCreate: false,
          localRevision: revision,
          syncedRevision: revision,
          updatedAt: new Date().toISOString(),
        });
        adopted += 1;
      }
      out.value = adopted;
    });
  });
}

/** Replace a locally generated habit id with the one the server assigned. */
export async function reidentifyCustomHabit(userId, localId, serverRow) {
  return runTx(STORE.customHabits, 'readwrite', ({ store }) => {
    const habits = store(STORE.customHabits);
    habits.get(String(localId), existing => {
      if (existing) habits.delete(String(localId));
      const revision = ((existing && existing.localRevision) || 1);
      habits.put({
        id: String(serverRow.id),
        userId,
        row: serverRow,
        deleted: false,
        pendingCreate: false,
        localRevision: revision,
        syncedRevision: revision,
        updatedAt: new Date().toISOString(),
      });
    });
  });
}
