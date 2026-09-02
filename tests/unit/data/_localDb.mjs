// Shared helper: give each test a genuinely empty local database.
//
// `_resetForTests()` only drops the cached handle — the fake IndexedDB keeps
// its contents, which would let one test's queued operations leak into the
// next and quietly weaken every assertion about counts.
import { DB_NAME, _resetForTests } from '../../../js/data/indexedDb.js';
import { initOutbox } from '../../../js/data/outbox.js';

export function deleteDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve(); // the handle is already closed below
  });
}

/** Empty database, fresh handle, outbox sequence re-seeded from zero. */
export async function freshDatabase() {
  _resetForTests();
  await deleteDatabase();
  await initOutbox();
}
