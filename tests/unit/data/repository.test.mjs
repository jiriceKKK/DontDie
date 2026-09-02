// Durability contract for the local repository, against a real IndexedDB
// implementation (fake-indexeddb). These tests assert the three promises the
// UI depends on:
//   1. a save that returns `local` is genuinely stored AND queued;
//   2. a late acknowledgement cannot mark a newer local edit as synced;
//   3. a delete leaves a tombstone that a stale hydrate cannot resurrect.
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { STORE, getAllRecords } from '../../../js/data/indexedDb.js';
import { pendingFor } from '../../../js/data/outbox.js';
import { freshDatabase } from './_localDb.mjs';
import {
  saveDocument, readDocument, markDocumentSynced, adoptRemoteDocument, setRemoteRevision, isDirty,
} from '../../../js/data/documentRepository.js';
import {
  setHabitLog, readLogsByDate, readLogRecords, markLogSynced, hydrateLogs,
  createCustomHabit, deleteCustomHabit, readCustomHabits, readHabitTombstones,
  hydrateCustomHabits, reidentifyCustomHabit, clearAllLogs, logKey,
} from '../../../js/data/habitRepository.js';
import { mergeHabitLogs, recordConflict, listConflicts, resolveConflict, conflictExport } from '../../../js/data/conflicts.js';

const OWNER = 'owner-1';
const OTHER = 'owner-2';

const fresh = freshDatabase;

test('a document save is durable and queues exactly one operation', async () => {
  await fresh();
  const result = await saveDocument('split', OWNER, { days: ['a'] });
  assert.equal(result.status, 'local');

  const stored = await readDocument('split', OWNER);
  assert.deepEqual(stored.data, { days: ['a'] });
  assert.equal(stored.localRevision, 1);
  assert.equal(isDirty(stored), true, 'an unacknowledged save must read as dirty');

  const queued = await pendingFor(OWNER);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].kind, 'document');
  assert.equal(queued[0].entity, 'split');
});

test('the outbox payload is a snapshot, not a live reference', async () => {
  await fresh();
  const live = { days: ['a'] };
  await saveDocument('split', OWNER, live);
  live.days.push('mutated after the save');

  const [queued] = await pendingFor(OWNER);
  assert.deepEqual(queued.payload.data, { days: ['a'] },
    'a later mutation must not rewrite what was already promised to the cloud');
});

test('a late acknowledgement cannot mark a newer local edit as synced', async () => {
  await fresh();
  await saveDocument('split', OWNER, { v: 1 });   // localRevision 1 — in flight
  await saveDocument('split', OWNER, { v: 2 });   // localRevision 2 — newer

  // The response for revision 1 arrives after revision 2 was written.
  await markDocumentSynced('split', OWNER, 1, 7);

  const stored = await readDocument('split', OWNER);
  assert.deepEqual(stored.data, { v: 2 }, 'the newer local state must survive');
  assert.equal(stored.remoteRevision, 7);
  assert.equal(isDirty(stored), true, 'revision 2 is still unsent, so it stays dirty');
});

test('adopting the cloud copy clears dirtiness without queueing a write', async () => {
  await fresh();
  await saveDocument('split', OWNER, { v: 1 });
  await adoptRemoteDocument('split', OWNER, { v: 'cloud' }, 9, '2026-01-01T00:00:00.000Z');

  const stored = await readDocument('split', OWNER);
  assert.deepEqual(stored.data, { v: 'cloud' });
  assert.equal(stored.remoteRevision, 9);
  assert.equal(isDirty(stored), false);

  // Only the original save is queued; adopting added nothing.
  assert.equal((await pendingFor(OWNER)).length, 1);
});

test('documents are per owner', async () => {
  await fresh();
  await saveDocument('split', OWNER, { who: 'me' });
  await saveDocument('split', OTHER, { who: 'them' });
  assert.deepEqual((await readDocument('split', OWNER)).data, { who: 'me' });
  assert.deepEqual((await readDocument('split', OTHER)).data, { who: 'them' });
});

test('setRemoteRevision records the base without touching the data', async () => {
  await fresh();
  await saveDocument('split', OWNER, { v: 1 });
  await setRemoteRevision('split', OWNER, 4);
  const stored = await readDocument('split', OWNER);
  assert.equal(stored.remoteRevision, 4);
  assert.deepEqual(stored.data, { v: 1 });
});

test('a stimulation-linked habit toggle is ONE transaction with TWO operations', async () => {
  await fresh();
  const result = await setHabitLog(OWNER, '2026-01-05', 'gym', true, {
    storeId: 'stimulation',
    data: { logs: { '2026-01-05': { blocks: { 3: [{ source: 'habit_link' }] } } } },
  });
  assert.equal(result.status, 'local');

  const logs = await readLogsByDate(OWNER);
  assert.equal(logs['2026-01-05'].gym, true);

  const doc = await readDocument('stimulation', OWNER);
  assert.ok(doc, 'the linked document must be stored by the same transaction');

  const queued = await pendingFor(OWNER);
  assert.equal(queued.length, 2);
  assert.deepEqual(queued.map(o => o.kind).sort(), ['document', 'habitLog']);
  // Order matters: the habit log was the user's intent, the document mirrors it.
  assert.ok(queued[0].seq < queued[1].seq);
});

test('toggling the same habit repeatedly leaves one queued operation with the final state', async () => {
  await fresh();
  for (const value of [true, false, true, false]) {
    await setHabitLog(OWNER, '2026-01-05', 'gym', value);
  }
  const queued = await pendingFor(OWNER);
  assert.equal(queued.length, 1, 'four offline toggles must collapse to one intent');
  assert.equal(queued[0].payload.completed, false, 'and it must be the FINAL state');
  assert.equal((await readLogsByDate(OWNER))['2026-01-05'].gym, false);
});

test('a hydrate never overwrites an unsynced local edit', async () => {
  await fresh();
  await setHabitLog(OWNER, '2026-01-05', 'gym', true);          // local, unsent
  await hydrateLogs(OWNER, { '2026-01-05': { gym: false, run: true } });

  const logs = await readLogsByDate(OWNER);
  assert.equal(logs['2026-01-05'].gym, true, 'the local edit wins');
  assert.equal(logs['2026-01-05'].run, true, 'untouched remote rows are adopted');
});

test('a hydrate adopts a remote value once the local edit is acknowledged', async () => {
  await fresh();
  await setHabitLog(OWNER, '2026-01-05', 'gym', true);
  await markLogSynced(OWNER, '2026-01-05', 'gym', 1);
  await hydrateLogs(OWNER, { '2026-01-05': { gym: false } });
  assert.equal((await readLogsByDate(OWNER))['2026-01-05'].gym, false);
});

test('clearing all logs leaves tombstones a hydrate cannot resurrect', async () => {
  await fresh();
  await setHabitLog(OWNER, '2026-01-05', 'gym', true);
  await markLogSynced(OWNER, '2026-01-05', 'gym', 1);
  await clearAllLogs(OWNER);

  assert.deepEqual(await readLogsByDate(OWNER), {}, 'cleared logs must not read back');
  const records = await readLogRecords(OWNER);
  assert.equal(records[logKey(OWNER, '2026-01-05', 'gym')].deleted, true);

  await hydrateLogs(OWNER, { '2026-01-05': { gym: true } });
  assert.deepEqual(await readLogsByDate(OWNER), {}, 'a stale cloud copy must not undo the reset');
});

test('a deleted custom habit is tombstoned and stays deleted through a hydrate', async () => {
  await fresh();
  await createCustomHabit(OWNER, { id: 'h1', name: 'Read', days: [0], sort_order: 0 });
  assert.equal((await readCustomHabits(OWNER)).length, 1);

  await deleteCustomHabit(OWNER, 'h1');
  assert.equal((await readCustomHabits(OWNER)).length, 0);
  assert.ok((await readHabitTombstones(OWNER)).has('h1'));

  await hydrateCustomHabits(OWNER, [{ id: 'h1', name: 'Read', days: [0], sort_order: 0 }]);
  assert.equal((await readCustomHabits(OWNER)).length, 0, 'the delete must survive the hydrate');

  const queued = await pendingFor(OWNER);
  assert.deepEqual(queued.map(o => o.op), ['create', 'delete'],
    'the create/delete boundary must be preserved, not collapsed');
});

test('a server-assigned habit id replaces the client one without duplicating the row', async () => {
  await fresh();
  await createCustomHabit(OWNER, { id: 'local-1', name: 'Read', days: [0], sort_order: 0 });
  await reidentifyCustomHabit(OWNER, 'local-1', { id: 'server-1', name: 'Read', days: [0], sort_order: 0 });

  const habits = await readCustomHabits(OWNER);
  assert.equal(habits.length, 1);
  assert.equal(habits[0].id, 'server-1');
  const raw = await getAllRecords(STORE.customHabits);
  assert.equal(raw.filter(r => r.userId === OWNER).length, 1, 'no orphan under the old id');
});

test('habit logs merge row-wise, newest wins, and a tombstone is never undone', () => {
  const local = {
    a: { key: 'a', completed: true, updatedAt: '2026-01-02T00:00:00.000Z' },
    b: { key: 'b', completed: true, deleted: true, updatedAt: '2026-01-02T00:00:00.000Z' },
    c: { key: 'c', completed: true, updatedAt: '2026-01-01T00:00:00.000Z' },
  };
  const remote = {
    a: { key: 'a', completed: false, updatedAt: '2026-01-01T00:00:00.000Z' },
    b: { key: 'b', completed: true, updatedAt: '2026-01-01T00:00:00.000Z' },
    c: { key: 'c', completed: false, updatedAt: '2026-01-03T00:00:00.000Z' },
    d: { key: 'd', completed: true, updatedAt: '2026-01-01T00:00:00.000Z' },
  };
  const merged = mergeHabitLogs(local, remote);
  assert.equal(merged.a.completed, true, 'newer local wins');
  assert.equal(merged.b.deleted, true, 'a tombstone at least as new as the remote row wins');
  assert.equal(merged.c.completed, false, 'newer remote wins');
  assert.equal(merged.d.completed, true, 'remote-only rows are kept');
});

test('a conflict keeps both snapshots until it is resolved', async () => {
  await fresh();
  await recordConflict({
    userId: OWNER, kind: 'document', entity: 'school', storeId: 'school',
    localData: { from: 'device' }, remoteData: { from: 'cloud' },
    localUpdatedAt: '2026-01-02T00:00:00.000Z',
    remoteUpdatedAt: '2026-01-03T00:00:00.000Z',
    remoteRevision: 5,
  });

  const [conflict] = await listConflicts(OWNER);
  assert.deepEqual(conflict.localData, { from: 'device' });
  assert.deepEqual(conflict.remoteData, { from: 'cloud' });

  const download = conflictExport(conflict);
  assert.deepEqual(download.thisDevice.data, { from: 'device' });
  assert.deepEqual(download.cloud.data, { from: 'cloud' });
  assert.equal(download.cloud.revision, 5);

  // Recording the same divergence twice must not stack up duplicates.
  await recordConflict({
    userId: OWNER, kind: 'document', entity: 'school', storeId: 'school',
    localData: { from: 'device' }, remoteData: { from: 'cloud' },
    localUpdatedAt: '2026-01-02T00:00:00.000Z',
  });
  assert.equal((await listConflicts(OWNER)).length, 1);

  await resolveConflict(conflict.id, OWNER);
  assert.equal((await listConflicts(OWNER)).length, 0);
});
