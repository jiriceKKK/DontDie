/* eslint-env browser */
// ============================================================
// DURABLE OUTBOX — replaces the in-memory retry queue.
//
// Every remote-changing intent is written to IndexedDB in the SAME
// transaction as the local change it describes, so "the UI said saved" and
// "the change will reach the cloud" can never disagree. Operations are
// owner-bound: one queued under account A is never sent under account B.
//
// Collapse rule (documented, deliberately conservative):
//   A new operation replaces a pending one ONLY when both share the same
//   (kind, entity) AND both are state-replacing (`save`/`upsert`). Anything
//   involving `create`, `delete` or `deleteAll` is a boundary and is appended,
//   so a delete followed by a re-create — or a re-create followed by a delete
//   — keeps its order and its meaning.
// ============================================================

import { STORE, runTx } from './indexedDb.js';

/** Ordering counter. Seeded from the store at startup so it survives reloads. */
let _seq = 0;

/** Operations whose payload fully replaces remote state and may collapse. */
const REPLACING = new Set(['save', 'upsert']);

export function newId() {
  try {
    if (globalThis.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch { /* fall through */ }
  return 'op-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/** Re-seed the sequence counter from whatever is already queued. */
export async function initOutbox() {
  const ops = await runTx(STORE.outbox, 'readonly', ({ store, out }) => {
    store(STORE.outbox).getAll(values => { out.value = values; });
  });
  _seq = (ops || []).reduce((max, op) => Math.max(max, Number(op.seq) || 0), 0);
  return ops || [];
}

/** Build (but do not store) an operation record. */
export function buildOperation({ userId, kind, entity, op, payload, baseRevision = null }) {
  _seq += 1;
  return {
    id: newId(),
    seq: _seq,
    userId,
    kind,
    entity,
    op,
    payload,
    baseRevision,
    attempts: 0,
    nextAttemptAt: 0,
    lastError: null,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Decide which existing operations a new one supersedes.
 * Pure so the rule can be unit-tested without a database.
 * @param {any[]} pending
 * @param {any} incoming
 * @returns {{ replaceIds: string[] }}
 */
export function collapse(pending, incoming) {
  if (!REPLACING.has(incoming.op)) return { replaceIds: [] };
  const replaceIds = [];
  for (const existing of pending) {
    if (existing.userId !== incoming.userId) continue;
    if (existing.kind !== incoming.kind || existing.entity !== incoming.entity) continue;
    if (!REPLACING.has(existing.op)) {
      // A boundary sits between us and anything older: stop collapsing so the
      // delete/restore order is preserved.
      replaceIds.length = 0;
      break;
    }
    replaceIds.push(existing.id);
  }
  return { replaceIds };
}

/**
 * Enqueue inside a transaction the caller already owns.
 * @param {any} outboxStore wrapped store from runTx
 * @param {any[]} pending   current contents of the outbox
 * @param {any} operation
 */
export function enqueueWithin(outboxStore, pending, operation) {
  const { replaceIds } = collapse(pending, operation);
  for (const id of replaceIds) outboxStore.delete(id);
  outboxStore.put(operation);
  return operation;
}

/** Enqueue on its own (used by flows with nothing else to write). */
export async function enqueue(operation) {
  await runTx(STORE.outbox, 'readwrite', ({ store }) => {
    const outbox = store(STORE.outbox);
    outbox.getAll(pending => { enqueueWithin(outbox, pending, operation); });
  });
  return operation;
}

/** Every pending operation for one owner, in enqueue order. */
export async function pendingFor(userId) {
  const ops = await runTx(STORE.outbox, 'readonly', ({ store, out }) => {
    store(STORE.outbox).getAll(values => { out.value = values; });
  });
  return (ops || [])
    .filter(op => op.userId === userId)
    .sort((a, b) => a.seq - b.seq);
}

/** Count of everything still queued, for the status chip. */
export async function pendingCount(userId) {
  return (await pendingFor(userId)).length;
}

/** Remove an acknowledged operation. */
export async function acknowledge(id) {
  await runTx(STORE.outbox, 'readwrite', ({ store }) => { store(STORE.outbox).delete(id); });
}

/**
 * Exponential backoff with jitter, capped so a long outage still retries
 * roughly every five minutes rather than drifting to hours.
 */
export function backoffDelay(attempts) {
  const base = Math.min(300_000, 1000 * Math.pow(2, Math.max(0, attempts - 1)));
  return Math.round(base * (0.75 + Math.random() * 0.5));
}

/** Record a failed attempt and schedule the next one. */
export async function recordFailure(id, error) {
  await runTx(STORE.outbox, 'readwrite', ({ store }) => {
    const outbox = store(STORE.outbox);
    outbox.get(id, existing => {
      if (!existing) return;
      existing.attempts = (existing.attempts || 0) + 1;
      existing.lastError = error ? String(error.message || error).slice(0, 200) : 'unknown';
      existing.nextAttemptAt = Date.now() + backoffDelay(existing.attempts);
      outbox.put(existing);
    });
  });
}

/** Update the expected remote revision after a conflict refresh. */
export async function rebase(id, baseRevision) {
  await runTx(STORE.outbox, 'readwrite', ({ store }) => {
    const outbox = store(STORE.outbox);
    outbox.get(id, existing => {
      if (!existing) return;
      existing.baseRevision = baseRevision;
      existing.attempts = 0;
      existing.nextAttemptAt = 0;
      outbox.put(existing);
    });
  });
}

/** Drop everything belonging to an owner (used when that account signs out for good). */
export async function clearFor(userId) {
  await runTx(STORE.outbox, 'readwrite', ({ store }) => {
    const outbox = store(STORE.outbox);
    outbox.getAll(ops => {
      for (const op of ops) if (op.userId === userId) outbox.delete(op.id);
    });
  });
}

/** True when the operation is allowed to be attempted now. */
export function isDue(operation, now = Date.now()) {
  return !operation.nextAttemptAt || operation.nextAttemptAt <= now;
}

/**
 * Clear the backoff on everything an owner has queued.
 *
 * Backoff exists to stop hammering a link that is failing. When connectivity
 * is restored the reason for waiting has gone, so making the user wait out a
 * timer that was scheduled while offline would be pointless — and would leave
 * the shell saying "sync failed — retrying" long after it could have succeeded.
 * Conflict-parked operations are untouched: those wait for a decision, not a
 * network.
 */
export async function resetBackoff(userId) {
  await runTx(STORE.outbox, 'readwrite', ({ store }) => {
    const outbox = store(STORE.outbox);
    outbox.getAll(ops => {
      for (const op of ops) {
        if (op.userId !== userId || op.blockedBy) continue;
        if (!op.attempts && !op.nextAttemptAt) continue;
        op.attempts = 0;
        op.nextAttemptAt = 0;
        outbox.put(op);
      }
    });
  });
}
