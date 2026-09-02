// The outbox collapse rule decides what a user's queued intent MEANS after a
// burst of edits. Getting it wrong either loses a change or resurrects a
// deleted one, so the rule is tested as a pure function first, then end to end
// against a real (fake-backed) IndexedDB.
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { collapse, buildOperation, backoffDelay, isDue, enqueue, pendingFor, acknowledge, recordFailure } from '../../../js/data/outbox.js';
import { freshDatabase } from './_localDb.mjs';

const OWNER = 'owner-1';

function op(overrides = {}) {
  return buildOperation({
    userId: OWNER, kind: 'document', entity: 'split', op: 'save', payload: {}, ...overrides,
  });
}

test('a newer save supersedes an older save for the same entity', () => {
  const first = op();
  const second = op();
  const { replaceIds } = collapse([first], second);
  assert.deepEqual(replaceIds, [first.id]);
});

test('saves for different entities never collapse into each other', () => {
  const split = op({ entity: 'split' });
  const school = op({ entity: 'school' });
  assert.deepEqual(collapse([split], school).replaceIds, []);
});

test('another account’s queued work is never collapsed away', () => {
  const theirs = op({ userId: 'someone-else' });
  assert.deepEqual(collapse([theirs], op()).replaceIds, []);
});

test('a delete boundary stops collapsing so a re-create keeps its meaning', () => {
  const create = op({ kind: 'customHabit', entity: 'h1', op: 'create' });
  const remove = op({ kind: 'customHabit', entity: 'h1', op: 'delete' });
  const resave = op({ kind: 'customHabit', entity: 'h1', op: 'save' });
  // The delete sits between the create and the new save: nothing may be
  // dropped, or the row would be deleted after being recreated.
  assert.deepEqual(collapse([create, remove], resave).replaceIds, []);
});

test('a create is itself a boundary and is never collapsed', () => {
  const create = op({ kind: 'customHabit', entity: 'h1', op: 'create' });
  const another = op({ kind: 'customHabit', entity: 'h1', op: 'create' });
  assert.deepEqual(collapse([create], another).replaceIds, []);
});

test('a delete never collapses a pending save', () => {
  const save = op();
  const remove = op({ op: 'delete' });
  assert.deepEqual(collapse([save], remove).replaceIds, []);
});

test('habit log upserts collapse per (date, habit)', () => {
  const monday = op({ kind: 'habitLog', entity: '2026-01-05|gym', op: 'upsert' });
  const mondayAgain = op({ kind: 'habitLog', entity: '2026-01-05|gym', op: 'upsert' });
  const tuesday = op({ kind: 'habitLog', entity: '2026-01-06|gym', op: 'upsert' });
  assert.deepEqual(collapse([monday], mondayAgain).replaceIds, [monday.id]);
  assert.deepEqual(collapse([monday], tuesday).replaceIds, []);
});

test('backoff grows, stays bounded, and is jittered', () => {
  const first = backoffDelay(1);
  assert.ok(first >= 750 && first <= 1250, `unexpected first delay ${first}`);
  assert.ok(backoffDelay(6) > backoffDelay(2));
  for (let attempts = 1; attempts <= 40; attempts++) {
    assert.ok(backoffDelay(attempts) <= 300_000 * 1.25);
  }
});

test('an operation is due only once its backoff has elapsed', () => {
  assert.equal(isDue({ nextAttemptAt: 0 }, 1000), true);
  assert.equal(isDue({ nextAttemptAt: 5000 }, 1000), false);
  assert.equal(isDue({ nextAttemptAt: 500 }, 1000), true);
});

test('queued operations survive in the durable store, in order, per owner', async () => {
  await freshDatabase();

  const a = await enqueue(op({ entity: 'split' }));
  const b = await enqueue(op({ entity: 'school' }));
  await enqueue(op({ userId: 'other-owner', entity: 'split' }));

  const mine = await pendingFor(OWNER);
  assert.deepEqual(mine.map(o => o.entity), ['split', 'school']);
  assert.ok(mine[0].seq < mine[1].seq, 'enqueue order must be recoverable');

  // A superseding save replaces the older one rather than queueing twice.
  await enqueue(op({ entity: 'split' }));
  const afterCollapse = await pendingFor(OWNER);
  assert.equal(afterCollapse.filter(o => o.entity === 'split').length, 1);
  assert.equal(afterCollapse.some(o => o.id === a.id), false);

  await acknowledge(b.id);
  assert.equal((await pendingFor(OWNER)).some(o => o.id === b.id), false);
});

test('a failure records an attempt and schedules the next one', async () => {
  await freshDatabase();
  const queued = await enqueue(op({ entity: 'mental' }));

  await recordFailure(queued.id, new Error('Failed to fetch'));
  const [stored] = (await pendingFor(OWNER)).filter(o => o.id === queued.id);
  assert.equal(stored.attempts, 1);
  assert.match(stored.lastError, /Failed to fetch/);
  assert.ok(stored.nextAttemptAt > Date.now(), 'a failed operation must not retry immediately');
});
