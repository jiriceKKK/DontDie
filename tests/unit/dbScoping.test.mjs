// Owner scoping in js/db.js.
//
// RLS is the real boundary, but the client must still (a) refuse to send any
// request without a session and (b) stamp/filter `user_id` on every statement.
// These tests drive db.js against a recording fake Supabase client, so they
// assert exactly what would go over the wire.
import test from 'node:test';
import assert from 'node:assert/strict';

import { setSession, clearSession, markExpired, _resetSessionForTests } from '../../js/session.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

// ---- recording fake Supabase ----------------------------------------------
const calls = [];

function makeQuery(table) {
  const record = { table, filters: {}, ops: [], payload: null, conflict: null };
  calls.push(record);

  const builder = {
    select(...args) { record.ops.push('select'); record.select = args[0]; return builder; },
    insert(rows) { record.ops.push('insert'); record.payload = rows; return builder; },
    upsert(row, options) { record.ops.push('upsert'); record.payload = row; record.conflict = options && options.onConflict; return builder; },
    update(patch) { record.ops.push('update'); record.payload = patch; return builder; },
    delete() { record.ops.push('delete'); return builder; },
    order() { return builder; },
    eq(column, value) { record.filters[column] = value; return builder; },
    gte(column, value) { record.filters['gte:' + column] = value; return builder; },
    lte(column, value) { record.filters['lte:' + column] = value; return builder; },
    single() { return Promise.resolve({ data: null, error: null }); },
    maybeSingle() { return Promise.resolve({ data: null, error: null }); },
    then(resolve, reject) { return Promise.resolve({ data: [], error: null }).then(resolve, reject); },
  };
  return builder;
}

globalThis.supabase = {
  createClient: () => ({
    from: table => makeQuery(table),
    auth: { getSession: async () => ({ data: { session: null }, error: null }) },
  }),
};

const db = await import('../../js/db.js');

test.beforeEach(() => { calls.length = 0; _resetSessionForTests(); });

// ---- no session: nothing may reach the network -----------------------------
test('every write is refused, without a request, when signed out', async () => {
  clearSession();

  const results = await Promise.all([
    db.dbUpsertLog('2025-01-01', 'gym_push_a', true),
    db.dbCreateCustomHabit({ name: 'x', days: [1] }),
    db.dbUpdateCustomHabit('id', { name: 'y' }),
    db.dbDeleteCustomHabit('id'),
    db.dbDeleteAllLogs(),
    db.dbSaveMentalStore({ any: 'thing' }),
    db.dbSaveSchoolStore({ any: 'thing' }),
    db.dbSaveHabitConfig({ any: 'thing' }),
    db.dbSaveSplitConfig({ any: 'thing' }),
    db.dbSaveStimulationStore({ any: 'thing' }),
    db.dbSaveMindTextsStore({ any: 'thing' }),
  ]);

  for (const result of results) {
    assert.ok(result.error, 'the call must report an error');
    assert.equal(result.error.isAuthRequired, true, 'and it must be the auth-required error');
  }
  assert.equal(calls.length, 0, 'no query may be built while signed out');
});

test('every read is refused, without a request, when signed out', async () => {
  clearSession();

  const logs = await db.dbGetLogsForRange('2025-01-01', '2025-03-01');
  assert.deepEqual(logs.data, {});
  assert.equal(logs.error.isAuthRequired, true);

  const habits = await db.dbGetCustomHabits();
  assert.deepEqual(habits.data, []);
  assert.equal(habits.error.isAuthRequired, true);

  const doc = await db.dbGetMentalStore();
  assert.equal(doc.data, null);
  assert.equal(doc.error.isAuthRequired, true);

  assert.equal(await db.dbCheckConnection(), false);
  assert.equal(calls.length, 0, 'no query may be built while signed out');
});

test('an expired session is treated as no session — never as anonymous access', async () => {
  setSession({ user: { id: OWNER } });
  markExpired();
  const result = await db.dbUpsertLog('2025-01-01', 'gym_push_a', true);
  assert.equal(result.error.isAuthRequired, true);
  assert.equal(calls.length, 0);
});

// ---- with a session: every statement carries the owner ---------------------
test('habit-log writes stamp user_id and conflict on (user_id, date, habit_id)', async () => {
  setSession({ user: { id: OWNER } });
  await db.dbUpsertLog('2025-01-01', 'gym_push_a', true);

  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.equal(call.table, 'habit_logs');
  assert.equal(call.payload.user_id, OWNER);
  assert.equal(call.conflict, 'user_id,date,habit_id');
});

test('habit-log reads filter by owner as well as by date range', async () => {
  setSession({ user: { id: OWNER } });
  await db.dbGetLogsForRange('2025-01-01', '2025-03-01');

  const [call] = calls;
  assert.equal(call.filters.user_id, OWNER);
  assert.equal(call.filters['gte:date'], '2025-01-01');
  assert.equal(call.filters['lte:date'], '2025-03-01');
});

test('custom-habit create/update/delete are all owner-scoped', async () => {
  setSession({ user: { id: OWNER } });

  await db.dbCreateCustomHabit({ name: 'Reading', days: [1, 3] });
  assert.equal(calls[0].payload[0].user_id, OWNER);

  await db.dbUpdateCustomHabit('habit-1', { name: 'Reading more' });
  assert.equal(calls[1].filters.user_id, OWNER);
  assert.equal(calls[1].filters.id, 'habit-1');

  await db.dbDeleteCustomHabit('habit-1');
  assert.equal(calls[2].filters.user_id, OWNER);
  assert.equal(calls[2].filters.id, 'habit-1');
});

test('a caller cannot hand a habit to another account through an update', async () => {
  setSession({ user: { id: OWNER } });
  await db.dbUpdateCustomHabit('habit-1', { name: 'Reading', user_id: OTHER });

  const [call] = calls;
  assert.equal(call.payload.user_id, undefined, 'user_id must be stripped from the patch');
  assert.equal(call.filters.user_id, OWNER, 'and the filter stays on the real owner');
});

test('deleting all logs is bounded to the owner', async () => {
  setSession({ user: { id: OWNER } });
  await db.dbDeleteAllLogs();
  assert.equal(calls[0].filters.user_id, OWNER);
  assert.ok(calls[0].ops.includes('delete'));
});

test('every JSON document store reads and writes one row per owner', async () => {
  setSession({ user: { id: OWNER } });

  const stores = [
    ['split_config', db.dbGetSplitConfig, db.dbSaveSplitConfig],
    ['mh_store', db.dbGetMentalStore, db.dbSaveMentalStore],
    ['mind_texts_store', db.dbGetMindTextsStore, db.dbSaveMindTextsStore],
    ['stimulation_store', db.dbGetStimulationStore, db.dbSaveStimulationStore],
    ['school_store', db.dbGetSchoolStore, db.dbSaveSchoolStore],
    ['habit_config', db.dbGetHabitConfig, db.dbSaveHabitConfig],
  ];

  for (const [table, read, write] of stores) {
    calls.length = 0;
    await read();
    assert.equal(calls[0].table, table);
    assert.equal(calls[0].filters.user_id, OWNER, `${table} read must filter by owner`);
    assert.equal(calls[0].filters.id, 1);

    calls.length = 0;
    await write({ some: 'data' });
    assert.equal(calls[0].table, table);
    assert.equal(calls[0].payload.user_id, OWNER, `${table} write must stamp the owner`);
    assert.equal(calls[0].payload.id, 1);
    assert.equal(calls[0].conflict, 'user_id,id', `${table} must upsert on the composite key`);
  }
});

test('the full export only ever asks for the owner rows', async () => {
  setSession({ user: { id: OWNER } });
  await db.dbExportAll();
  assert.equal(calls.length, 2);
  for (const call of calls) assert.equal(call.filters.user_id, OWNER);
});

test('the connection check is an authenticated, owner-scoped probe', async () => {
  setSession({ user: { id: OWNER } });
  await db.dbCheckConnection();
  assert.equal(calls[0].table, 'habit_logs');
  assert.equal(calls[0].filters.user_id, OWNER);
});
