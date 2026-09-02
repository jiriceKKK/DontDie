// ============================================================
// DATA LAYER TYPES — JSDoc typedefs shared by the repository, outbox,
// reconciler and conflict store. There is no runtime code here; the file
// exists so `npm run typecheck:core` has a single contract to check against
// and so UI code can be handed domain values plus an explicit result shape
// instead of raw Supabase responses.
// ============================================================

/**
 * Identifier of a whole-document store. One row per owner in Supabase
 * (`user_id`, `id = 1`) and one record per owner in IndexedDB.
 * @typedef {'split'|'mental'|'mindTexts'|'stimulation'|'school'|'habitConfig'} DocumentStoreId
 */

/**
 * A locally durable copy of a whole-document store.
 * @typedef {object} LocalDocument
 * @property {DocumentStoreId} id
 * @property {string} userId              Owner the record belongs to.
 * @property {any} data                   The domain document (module-normalised).
 * @property {number} localRevision       Monotonic local counter, bumped on every local write.
 * @property {number} syncedRevision      The localRevision last acknowledged by the server.
 * @property {number|null} remoteRevision Server revision the local copy is based on.
 * @property {string} updatedAt           ISO timestamp of the last local write.
 */

/**
 * One habit log, keyed locally by `${userId}|${date}|${habitId}`.
 * @typedef {object} LocalHabitLog
 * @property {string} key
 * @property {string} userId
 * @property {string} date                Local date, `YYYY-MM-DD`.
 * @property {string} habitId
 * @property {boolean} completed
 * @property {boolean} deleted            Tombstone: a local delete a stale hydrate must not resurrect.
 * @property {number} localRevision
 * @property {number} syncedRevision
 * @property {string} updatedAt
 */

/**
 * A custom habit row held locally.
 * @typedef {object} LocalCustomHabit
 * @property {string} id
 * @property {string} userId
 * @property {any} row                    The Supabase-shaped row.
 * @property {boolean} deleted            Tombstone until the remote delete is acknowledged.
 * @property {boolean} pendingCreate      True until the server has accepted the insert.
 * @property {number} localRevision
 * @property {number} syncedRevision
 * @property {string} updatedAt
 */

/**
 * What kind of entity an outbox operation targets.
 * @typedef {'document'|'habitLog'|'customHabit'} OutboxKind
 */

/**
 * The operation itself. `save`/`upsert` are state-replacing and may collapse;
 * `create`, `delete` and `deleteAll` are boundaries and never collapse.
 * @typedef {'save'|'upsert'|'create'|'update'|'delete'|'deleteAll'} OutboxOp
 */

/**
 * A durable, owner-bound intent to change remote state.
 * @typedef {object} OutboxOperation
 * @property {string} id                  Client-generated UUID; also the idempotency key.
 * @property {number} seq                 Monotonic order of enqueue. Flush follows this order.
 * @property {string} userId              Never sent under a different account.
 * @property {OutboxKind} kind
 * @property {string} entity              Collapse identity within `kind`.
 * @property {OutboxOp} op
 * @property {any} payload
 * @property {number|null} baseRevision   Expected remote revision for a compare-and-set write.
 * @property {number} attempts
 * @property {number} nextAttemptAt       Epoch ms; backoff gate.
 * @property {string|null} lastError
 * @property {string} createdAt
 */

/**
 * Both sides of an unresolved divergence, retained until the owner chooses.
 * @typedef {object} StoredConflict
 * @property {string} id
 * @property {string} userId
 * @property {OutboxKind} kind
 * @property {string} entity
 * @property {DocumentStoreId|null} storeId
 * @property {any} localData
 * @property {any} remoteData
 * @property {string} localUpdatedAt
 * @property {string|null} remoteUpdatedAt
 * @property {number|null} remoteRevision
 * @property {string} detectedAt
 */

/**
 * Uniform result handed to callers. `status` is the only thing UI code
 * branches on; `error` is for diagnostics, never for control flow.
 * @typedef {object} RepositoryResult
 * @property {'local'|'synced'|'queued'|'conflict'|'unavailable'|'error'} status
 * @property {any} [value]
 * @property {Error|null} [error]
 * @property {StoredConflict|null} [conflict]
 */

/**
 * Aggregate connection/sync state surfaced in the shell.
 * @typedef {'synced'|'saved-local'|'syncing'|'offline'|'conflict'|'failed'} SyncState
 */

export {};
