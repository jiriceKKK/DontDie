/* eslint-env browser */
// ============================================================
// DOCUMENT REPOSITORY — local-first persistence for the whole-document stores
// (split, mind, texts, stimulation, school, habit config).
//
// A module action calls save(). That writes the document AND its outbox
// operation in ONE IndexedDB transaction, so a successful return genuinely
// means "durably stored on this device, and the cloud write is guaranteed to
// be attempted". Nothing here talks to the network; js/data/reconcile.js owns
// that and is the only place a remote write happens.
// ============================================================

import { STORE, runTx, isQuotaError } from './indexedDb.js';
import { buildOperation, enqueueWithin } from './outbox.js';

/** Store id -> Supabase table. `habit_config` is not installed in production. */
export const DOCUMENT_TABLES = {
  split: 'split_config',
  mental: 'mh_store',
  mindTexts: 'mind_texts_store',
  stimulation: 'stimulation_store',
  school: 'school_store',
  habitConfig: 'habit_config',
};

export const DOCUMENT_IDS = Object.keys(DOCUMENT_TABLES);

/** Local record key — one document per store per owner. */
export function documentKey(storeId, userId) {
  return `${userId}::${storeId}`;
}

/**
 * Read the durable local copy.
 * @returns {Promise<any|null>}
 */
export async function readDocument(storeId, userId) {
  return runTx(STORE.documents, 'readonly', ({ store, out }) => {
    store(STORE.documents).get(documentKey(storeId, userId), value => { out.value = value; });
  });
}

/** Read every local document for an owner, keyed by store id. */
export async function readAllDocuments(userId) {
  const all = await runTx(STORE.documents, 'readonly', ({ store, out }) => {
    store(STORE.documents).getAll(values => { out.value = values; });
  });
  const byStore = {};
  for (const record of (all || [])) {
    if (record.userId === userId) byStore[record.id.split('::')[1]] = record;
  }
  return byStore;
}

/**
 * Durably store a new version of a document and queue its cloud write.
 *
 * @param {string} storeId
 * @param {string} userId
 * @param {any} data                    the domain document (already normalised)
 * @param {{ enqueue?: boolean }} [options]
 * @returns {Promise<import('./types.js').RepositoryResult>}
 */
export async function saveDocument(storeId, userId, data, options = {}) {
  const shouldEnqueue = options.enqueue !== false;
  const key = documentKey(storeId, userId);
  // Snapshot immediately: the caller's object is a live singleton that later
  // edits will mutate, and an outbox payload must be the version we promised.
  let snapshot;
  try {
    snapshot = structuredCloneSafe(data);
  } catch (err) {
    return { status: 'error', error: err };
  }
  const updatedAt = new Date().toISOString();

  try {
    const record = await runTx([STORE.documents, STORE.outbox], 'readwrite', ({ store, out }) => {
      const documents = store(STORE.documents);
      const outbox = store(STORE.outbox);
      documents.get(key, existing => {
        const next = {
          id: key,
          userId,
          storeId,
          data: snapshot,
          localRevision: ((existing && existing.localRevision) || 0) + 1,
          syncedRevision: (existing && existing.syncedRevision) || 0,
          remoteRevision: existing ? existing.remoteRevision : null,
          updatedAt,
        };
        documents.put(next);
        out.value = next;
        if (!shouldEnqueue) return;
        outbox.getAll(pending => {
          enqueueWithin(outbox, pending, buildOperation({
            userId,
            kind: 'document',
            entity: storeId,
            op: 'save',
            payload: { storeId, table: DOCUMENT_TABLES[storeId], data: snapshot, localRevision: next.localRevision },
            baseRevision: next.remoteRevision,
          }));
        });
      });
    });
    return { status: 'local', value: record };
  } catch (err) {
    // A quota failure must never be reported as a successful save.
    return { status: isQuotaError(err) ? 'unavailable' : 'error', error: err };
  }
}

/**
 * Record the result of an accepted remote write.
 * `localRevision` is the version that was actually sent, so a newer local edit
 * made while the request was in flight stays dirty instead of being marked synced.
 */
export async function markDocumentSynced(storeId, userId, localRevision, remoteRevision) {
  return runTx(STORE.documents, 'readwrite', ({ store, out }) => {
    const documents = store(STORE.documents);
    documents.get(documentKey(storeId, userId), existing => {
      if (!existing) return;
      existing.remoteRevision = remoteRevision;
      if ((existing.localRevision || 0) <= localRevision) existing.syncedRevision = existing.localRevision;
      documents.put(existing);
      out.value = existing;
    });
  });
}

/**
 * Adopt the remote copy verbatim (used when the owner chooses "use cloud", and
 * when there is no local copy at all). Does not enqueue: the cloud already has it.
 */
export async function adoptRemoteDocument(storeId, userId, data, remoteRevision, remoteUpdatedAt) {
  const key = documentKey(storeId, userId);
  return runTx(STORE.documents, 'readwrite', ({ store, out }) => {
    const documents = store(STORE.documents);
    documents.get(key, existing => {
      const next = {
        id: key,
        userId,
        storeId,
        data,
        localRevision: ((existing && existing.localRevision) || 0) + 1,
        syncedRevision: ((existing && existing.localRevision) || 0) + 1,
        remoteRevision,
        updatedAt: remoteUpdatedAt || new Date().toISOString(),
      };
      documents.put(next);
      out.value = next;
    });
  });
}

/** Note the remote revision a local copy is based on, without touching data. */
export async function setRemoteRevision(storeId, userId, remoteRevision) {
  return runTx(STORE.documents, 'readwrite', ({ store }) => {
    const documents = store(STORE.documents);
    documents.get(documentKey(storeId, userId), existing => {
      if (!existing) return;
      existing.remoteRevision = remoteRevision;
      documents.put(existing);
    });
  });
}

/** True when the local copy holds edits the server has not acknowledged. */
export function isDirty(record) {
  if (!record) return false;
  return (record.localRevision || 0) > (record.syncedRevision || 0);
}

/**
 * structuredClone where available, JSON round-trip otherwise. Throws on values
 * that genuinely cannot be stored, which the caller reports rather than hides.
 */
export function structuredCloneSafe(value) {
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value); } catch { /* fall through to JSON */ }
  }
  return JSON.parse(JSON.stringify(value));
}
