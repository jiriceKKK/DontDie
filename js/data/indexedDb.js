/* eslint-env browser */
// ============================================================
// INDEXEDDB — the single local database for personal records.
//
// One database (`dontdie_local_v2`) with versioned object stores. Usage
// telemetry gets its OWN database in Phase 4, so clearing analytics can never
// endanger anything written here.
//
// Everything goes through runTx(). The body of a transaction is SYNCHRONOUS
// and issues IndexedDB requests with callbacks: awaiting a non-IndexedDB
// promise inside a transaction lets the browser auto-close it half way, which
// is exactly how "the write said it succeeded but nothing was stored" bugs
// happen. The transaction's own completion event is what resolves the promise,
// so a resolved runTx() means the data is durable.
// ============================================================

export const DB_NAME = 'dontdie_local_v2';
export const DB_VERSION = 1;

export const STORE = {
  documents: 'documents',
  habitLogs: 'habitLogs',
  customHabits: 'customHabits',
  outbox: 'outbox',
  conflicts: 'conflicts',
  meta: 'meta',
};

/** Thrown when the browser has no usable IndexedDB. Callers report, never pretend. */
export class LocalStorageUnavailableError extends Error {
  constructor(message = 'local database unavailable') {
    super(message);
    this.name = 'LocalStorageUnavailableError';
  }
}

let _dbPromise = null;
let _unavailable = null;

/** Test seam: drop the cached handle so a spec can reopen a fresh database. */
export function _resetForTests() {
  if (_dbPromise) _dbPromise.then(db => { try { db.close(); } catch { /* already closed */ } }, () => {});
  _dbPromise = null;
  _unavailable = null;
}

function upgrade(db) {
  if (!db.objectStoreNames.contains(STORE.documents)) {
    db.createObjectStore(STORE.documents, { keyPath: 'id' });
  }
  if (!db.objectStoreNames.contains(STORE.habitLogs)) {
    const logs = db.createObjectStore(STORE.habitLogs, { keyPath: 'key' });
    logs.createIndex('byDate', 'date', { unique: false });
    logs.createIndex('byUser', 'userId', { unique: false });
  }
  if (!db.objectStoreNames.contains(STORE.customHabits)) {
    const habits = db.createObjectStore(STORE.customHabits, { keyPath: 'id' });
    habits.createIndex('byUser', 'userId', { unique: false });
  }
  if (!db.objectStoreNames.contains(STORE.outbox)) {
    const outbox = db.createObjectStore(STORE.outbox, { keyPath: 'id' });
    outbox.createIndex('bySeq', 'seq', { unique: false });
    outbox.createIndex('byIdentity', ['kind', 'entity'], { unique: false });
  }
  if (!db.objectStoreNames.contains(STORE.conflicts)) {
    db.createObjectStore(STORE.conflicts, { keyPath: 'id' });
  }
  if (!db.objectStoreNames.contains(STORE.meta)) {
    db.createObjectStore(STORE.meta, { keyPath: 'key' });
  }
}

/** True when this browser exposes IndexedDB at all (private modes may not). */
export function hasIndexedDb() {
  try { return typeof indexedDB !== 'undefined' && !!indexedDB; } catch { return false; }
}

/**
 * Open (and if needed create/upgrade) the database.
 * @returns {Promise<IDBDatabase>}
 */
export function openDatabase() {
  if (_unavailable) return Promise.reject(_unavailable);
  if (_dbPromise) return _dbPromise;

  if (!hasIndexedDb()) {
    _unavailable = new LocalStorageUnavailableError('this browser exposes no IndexedDB');
    return Promise.reject(_unavailable);
  }

  _dbPromise = new Promise((resolve, reject) => {
    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(new LocalStorageUnavailableError('could not open the local database: ' + (err && err.name)));
      return;
    }
    // `blocked` fires when another tab holds an older version open. Surface it
    // rather than hanging forever behind a promise that never settles.
    const blockedTimer = setTimeout(() => {
      reject(new LocalStorageUnavailableError('the local database is blocked by another tab'));
    }, 8000);

    request.onupgradeneeded = () => { try { upgrade(request.result); } catch (err) { reject(err); } };
    request.onblocked = () => {
      clearTimeout(blockedTimer);
      reject(new LocalStorageUnavailableError('the local database is blocked by another tab'));
    };
    request.onerror = () => {
      clearTimeout(blockedTimer);
      reject(new LocalStorageUnavailableError('could not open the local database: ' + (request.error && request.error.name)));
    };
    request.onsuccess = () => {
      clearTimeout(blockedTimer);
      const db = request.result;
      // A version change from another tab must not leave a stale handle behind.
      db.onversionchange = () => { try { db.close(); } catch { /* ignore */ } _dbPromise = null; };
      resolve(db);
    };
  });

  _dbPromise.catch(err => { _unavailable = err instanceof Error ? err : new LocalStorageUnavailableError(String(err)); });
  return _dbPromise;
}

/** Wrap one object store with callback-style helpers that stay inside the tx. */
function wrapStore(objectStore) {
  const api = {
    put(value) { objectStore.put(value); return api; },
    delete(key) { objectStore.delete(key); return api; },
    clear() { objectStore.clear(); return api; },
    get(key, onValue) {
      const req = objectStore.get(key);
      req.onsuccess = () => onValue(req.result === undefined ? null : req.result);
      return api;
    },
    getAll(onValues) {
      const req = objectStore.getAll();
      req.onsuccess = () => onValues(req.result || []);
      return api;
    },
    count(onCount) {
      const req = objectStore.count();
      req.onsuccess = () => onCount(req.result || 0);
      return api;
    },
    index(name) {
      const idx = objectStore.index(name);
      return {
        getAll(query, onValues) {
          const req = idx.getAll(query);
          req.onsuccess = () => onValues(req.result || []);
        },
      };
    },
  };
  return api;
}

/**
 * Run one transaction. `body` MUST be synchronous.
 * @template T
 * @param {string|string[]} names
 * @param {IDBTransactionMode} mode
 * @param {(ctx: {store: (name: string) => any, out: {value: any}}) => void} body
 * @returns {Promise<any>}
 */
export async function runTx(names, mode, body) {
  const db = await openDatabase();
  const storeNames = Array.isArray(names) ? names : [names];
  return new Promise((resolve, reject) => {
    let tx;
    try {
      tx = db.transaction(storeNames, mode);
    } catch (err) {
      reject(err);
      return;
    }
    /** @type {{value: any}} */
    const out = { value: undefined };
    const ctx = { store: name => wrapStore(tx.objectStore(name)), out };

    let bodyError = null;
    try {
      body(ctx);
    } catch (err) {
      bodyError = err;
      try { tx.abort(); } catch { /* already finishing */ }
    }

    tx.oncomplete = () => resolve(out.value);
    tx.onerror = () => reject(bodyError || tx.error || new Error('transaction failed'));
    tx.onabort = () => reject(bodyError || tx.error || new Error('transaction aborted'));
  });
}

/** Convenience read of one record. */
export async function getRecord(storeName, key) {
  return runTx(storeName, 'readonly', ({ store, out }) => {
    store(storeName).get(key, value => { out.value = value; });
  });
}

/** Convenience read of every record in a store. */
export async function getAllRecords(storeName) {
  return runTx(storeName, 'readonly', ({ store, out }) => {
    store(storeName).getAll(values => { out.value = values; });
  });
}

/** Convenience single write. */
export async function putRecord(storeName, value) {
  await runTx(storeName, 'readwrite', ({ store }) => { store(storeName).put(value); });
  return value;
}

/** Read one `meta` value. */
export async function getMeta(key, fallback = null) {
  const record = await getRecord(STORE.meta, key);
  return record ? record.value : fallback;
}

/** Write one `meta` value. */
export async function setMeta(key, value) {
  await putRecord(STORE.meta, { key, value });
  return value;
}

/**
 * Best-effort storage estimate, used to warn before a quota failure rather
 * than after it. Returns null when the browser will not say.
 */
export async function storageEstimate() {
  try {
    if (navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate();
  } catch { /* not available */ }
  return null;
}

/** True when an error came from the browser refusing to store more data. */
export function isQuotaError(err) {
  if (!err) return false;
  const name = err.name || (err.target && err.target.error && err.target.error.name) || '';
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED';
}
