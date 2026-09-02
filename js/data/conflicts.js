/* eslint-env browser */
// ============================================================
// CONFLICT STORE — when a compare-and-set write is rejected because the server
// moved on, NEITHER copy is thrown away. Both snapshots are kept locally with
// their timestamps until the owner chooses, and both can be downloaded first.
//
// Automatic merging is allowed only where rows are independently keyed (habit
// logs). Journals, imported texts, school plans and stimulation documents are
// never auto-merged: their semantics are not row-wise and a silent merge would
// invent history.
// ============================================================

import { STORE, runTx } from './indexedDb.js';
import { newId } from './outbox.js';

const listeners = new Set();

/** Subscribe to conflict-count changes (the shell status chip uses this). */
export function onConflictsChanged(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function announce(count) {
  for (const listener of listeners) {
    try { listener(count); } catch (err) { console.error('[conflicts] listener failed:', err); }
  }
}

/** Stable identity so the same divergence is not recorded twice. */
export function conflictId(kind, entity, userId) {
  return `${userId}::${kind}::${entity}`;
}

/**
 * Record a divergence, keeping both sides verbatim.
 * @returns {Promise<any>} the stored conflict
 */
export async function recordConflict({
  userId, kind, entity, storeId = null,
  localData, remoteData,
  localUpdatedAt, remoteUpdatedAt = null, remoteRevision = null,
}) {
  const conflict = {
    id: conflictId(kind, entity, userId),
    ref: newId(),
    userId, kind, entity, storeId,
    localData, remoteData,
    localUpdatedAt,
    remoteUpdatedAt,
    remoteRevision,
    detectedAt: new Date().toISOString(),
  };
  await runTx(STORE.conflicts, 'readwrite', ({ store }) => { store(STORE.conflicts).put(conflict); });
  announce(await countConflicts(userId));
  return conflict;
}

/** Every unresolved conflict for one owner, newest first. */
export async function listConflicts(userId) {
  const all = await runTx(STORE.conflicts, 'readonly', ({ store, out }) => {
    store(STORE.conflicts).getAll(values => { out.value = values; });
  });
  return (all || [])
    .filter(c => c.userId === userId)
    .sort((a, b) => String(b.detectedAt).localeCompare(String(a.detectedAt)));
}

export async function countConflicts(userId) {
  return (await listConflicts(userId)).length;
}

export async function getConflict(id) {
  return runTx(STORE.conflicts, 'readonly', ({ store, out }) => {
    store(STORE.conflicts).get(id, value => { out.value = value; });
  });
}

/** Remove a conflict once the owner has chosen a side. */
export async function resolveConflict(id, userId) {
  await runTx(STORE.conflicts, 'readwrite', ({ store }) => { store(STORE.conflicts).delete(id); });
  announce(await countConflicts(userId));
}

/**
 * Merge two habit-log collections. Safe to automate because every log is
 * independently keyed by (date, habitId) and carries its own updatedAt; the
 * newer write for each key wins and nothing is invented.
 * @param {Record<string, any>} localLogs  key -> log record
 * @param {Record<string, any>} remoteLogs key -> log record
 */
export function mergeHabitLogs(localLogs, remoteLogs) {
  const merged = {};
  const keys = new Set([...Object.keys(localLogs || {}), ...Object.keys(remoteLogs || {})]);
  for (const key of keys) {
    const local = (localLogs || {})[key];
    const remote = (remoteLogs || {})[key];
    if (!local) { merged[key] = remote; continue; }
    if (!remote) { merged[key] = local; continue; }
    const localAt = Date.parse(local.updatedAt || 0) || 0;
    const remoteAt = Date.parse(remote.updatedAt || 0) || 0;
    // A local tombstone that is at least as new as the remote row wins, so a
    // delete is never resurrected by a hydrate that raced it.
    if (local.deleted && localAt >= remoteAt) { merged[key] = local; continue; }
    merged[key] = localAt >= remoteAt ? local : remote;
  }
  return merged;
}

/** A JSON blob the owner can download before deciding. Contains no credentials. */
export function conflictExport(conflict) {
  return {
    kind: conflict.kind,
    entity: conflict.entity,
    store: conflict.storeId,
    detectedAt: conflict.detectedAt,
    thisDevice: { updatedAt: conflict.localUpdatedAt, data: conflict.localData },
    cloud: { updatedAt: conflict.remoteUpdatedAt, revision: conflict.remoteRevision, data: conflict.remoteData },
  };
}
