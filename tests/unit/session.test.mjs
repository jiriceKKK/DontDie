// Authentication state machine. js/db.js depends on these transitions to decide
// whether a request may be sent at all, so the states must be exact.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  setSession, clearSession, markExpired, getAuthState, getUserId,
  isAuthenticated, requireUserId, onAuthStateChanged, AuthRequiredError,
  _resetSessionForTests,
} from '../../js/session.js';

const OWNER = '11111111-1111-4111-8111-111111111111';

test.beforeEach(() => _resetSessionForTests());

test('starts signed out with no owner', () => {
  const state = getAuthState();
  assert.equal(state.status, 'signed-out');
  assert.equal(state.userId, null);
  assert.equal(state.isAuthenticated, false);
  assert.equal(getUserId(), null);
  assert.equal(isAuthenticated(), false);
});

test('a Supabase session makes the owner available', () => {
  setSession({ user: { id: OWNER, email: 'owner@example.invalid' } });
  assert.equal(getUserId(), OWNER);
  assert.equal(isAuthenticated(), true);
  assert.equal(getAuthState().email, 'owner@example.invalid');
  assert.equal(requireUserId(), OWNER);
});

test('requireUserId throws AuthRequiredError when signed out', () => {
  assert.throws(() => requireUserId(), (err) => {
    assert.ok(err instanceof AuthRequiredError);
    assert.equal(err.isAuthRequired, true);
    return true;
  });
});

test('a lost session becomes expired, not signed out, and blocks writes', () => {
  setSession({ user: { id: OWNER } });
  markExpired();
  const state = getAuthState();
  assert.equal(state.status, 'expired');
  assert.equal(state.userId, null);
  assert.equal(isAuthenticated(), false);
  assert.throws(() => requireUserId(), AuthRequiredError);
});

test('setSession(null) after authentication reports expiry rather than silent anonymity', () => {
  setSession({ user: { id: OWNER } });
  setSession(null);
  assert.equal(getAuthState().status, 'expired');
  assert.equal(getUserId(), null);
});

test('explicit sign-out clears everything', () => {
  setSession({ user: { id: OWNER, email: 'owner@example.invalid' } });
  clearSession();
  const state = getAuthState();
  assert.equal(state.status, 'signed-out');
  assert.equal(state.userId, null);
  assert.equal(state.email, null);
});

test('a malformed session never yields an owner id', () => {
  setSession({ user: { id: 42 } });
  assert.equal(getUserId(), null);
  setSession({});
  assert.equal(getUserId(), null);
});

test('listeners observe transitions and can unsubscribe', () => {
  const seen = [];
  const off = onAuthStateChanged(state => seen.push(state.status));
  setSession({ user: { id: OWNER } });
  markExpired();
  off();
  clearSession();
  assert.deepEqual(seen, ['authenticated', 'expired']);
});

test('a throwing listener cannot break the state machine', () => {
  onAuthStateChanged(() => { throw new Error('listener exploded'); });
  assert.doesNotThrow(() => setSession({ user: { id: OWNER } }));
  assert.equal(getUserId(), OWNER);
});
