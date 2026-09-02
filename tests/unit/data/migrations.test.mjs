// The localStorage → IndexedDB migration is the one moment where existing
// personal data could be lost. These tests hold it to its contract: legacy keys
// survive, a rerun is a no-op, an interrupted run resumes, and an unparsable
// key is never treated as "empty".
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { freshDatabase } from './_localDb.mjs';
import { getMeta, STORE, getAllRecords } from '../../../js/data/indexedDb.js';
import { readDocument, saveDocument } from '../../../js/data/documentRepository.js';
import { listConflicts } from '../../../js/data/conflicts.js';
import { migrateStore, migrateLegacyDocuments, migrationComplete, markerKey, LEGACY_KEYS } from '../../../js/data/migrations.js';

const OWNER = 'owner-1';

/** Minimal localStorage stand-in — the migration only reads it. */
function installLocalStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  globalThis.localStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key),
    get length() { return store.size; },
  };
  return store;
}

test('a legacy document is migrated, normalised, and its key is left in place', async () => {
  await freshDatabase();
  const legacy = installLocalStorage({
    [LEGACY_KEYS.split]: JSON.stringify({ days: ['mon'], updatedAt: '2026-01-01T00:00:00.000Z' }),
  });

  const normalise = value => ({ ...value, normalised: true });
  const result = await migrateStore('split', OWNER, normalise);
  assert.equal(result.status, 'migrated');

  const stored = await readDocument('split', OWNER);
  assert.equal(stored.data.normalised, true, 'the owning module normalises before storage');
  assert.deepEqual(stored.data.days, ['mon']);
  assert.equal(stored.updatedAt, '2026-01-01T00:00:00.000Z');
  assert.equal(stored.syncedRevision, 0, 'migrated data is not yet known to the server');

  assert.ok(legacy.has(LEGACY_KEYS.split), 'the legacy key must survive for recovery');
});

test('a second run is a no-op and cannot duplicate anything', async () => {
  await freshDatabase();
  installLocalStorage({ [LEGACY_KEYS.split]: JSON.stringify({ days: ['mon'] }) });

  assert.equal((await migrateStore('split', OWNER)).status, 'migrated');
  assert.equal((await migrateStore('split', OWNER)).status, 'skipped');

  const documents = await getAllRecords(STORE.documents);
  assert.equal(documents.length, 1);
});

test('an interrupted run resumes without overwriting newer local data', async () => {
  await freshDatabase();
  installLocalStorage({ [LEGACY_KEYS.split]: JSON.stringify({ days: ['legacy'] }) });

  // Simulate: the record was written, then the tab closed before the marker.
  await saveDocument('split', OWNER, { days: ['written since'] });
  assert.equal(await getMeta(markerKey('split', OWNER)), null);

  const result = await migrateStore('split', OWNER);
  assert.equal(result.status, 'migrated');
  const stored = await readDocument('split', OWNER);
  assert.deepEqual(stored.data, { days: ['written since'] },
    'a rerun must never replace live data with older legacy data');
  assert.ok(await getMeta(markerKey('split', OWNER)), 'the marker is written on the resumed run');
});

test('an unparsable legacy key becomes a recovery conflict, never an empty document', async () => {
  await freshDatabase();
  installLocalStorage({ [LEGACY_KEYS.school]: '{"truncated": ' });

  const result = await migrateStore('school', OWNER);
  assert.equal(result.status, 'unreadable');

  assert.equal(await readDocument('school', OWNER), null,
    'a broken key must not be silently stored as an empty document');
  assert.equal(await getMeta(markerKey('school', OWNER)), null,
    'no marker, so a future release can still try');

  const [conflict] = await listConflicts(OWNER);
  assert.equal(conflict.entity, 'legacy:school');
  assert.equal(conflict.localData.unparsableLegacyValue, '{"truncated": ',
    'the raw value is retained so it can be exported');
});

test('an absent legacy key is marked done without inventing data', async () => {
  await freshDatabase();
  installLocalStorage({});
  const result = await migrateStore('mental', OWNER);
  assert.equal(result.status, 'empty');
  assert.equal(await readDocument('mental', OWNER), null);
  assert.ok(await getMeta(markerKey('mental', OWNER)));
});

test('every store is covered and the run reports completion', async () => {
  await freshDatabase();
  installLocalStorage({
    [LEGACY_KEYS.split]: JSON.stringify({ a: 1 }),
    [LEGACY_KEYS.mental]: JSON.stringify({ b: 2 }),
    [LEGACY_KEYS.mindTexts]: JSON.stringify({ c: 3 }),
    [LEGACY_KEYS.stimulation]: JSON.stringify({ d: 4 }),
    [LEGACY_KEYS.school]: JSON.stringify({ e: 5 }),
    [LEGACY_KEYS.habitConfig]: JSON.stringify({ f: 6 }),
  });

  const results = await migrateLegacyDocuments(OWNER);
  assert.equal(results.length, 6);
  assert.ok(results.every(r => r.status === 'migrated'), JSON.stringify(results));
  assert.equal(await migrationComplete(OWNER), true);

  const documents = await getAllRecords(STORE.documents);
  assert.equal(documents.length, 6);
});

test('one owner’s migration does not satisfy another owner’s', async () => {
  await freshDatabase();
  installLocalStorage({ [LEGACY_KEYS.split]: JSON.stringify({ a: 1 }) });
  await migrateStore('split', OWNER);
  assert.equal(await getMeta(markerKey('split', 'someone-else')), null);
  assert.equal((await migrateStore('split', 'someone-else')).status, 'migrated');
});
