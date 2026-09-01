// On-device privacy lock. It is not an authorization boundary, but it must
// still resist a weak secret, a quick brute force, and a leaked verifier.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateSecret, setDeviceLock, verifyDeviceLock, isDeviceLockSet,
  clearDeviceLock, getCooldownRemainingMs, getFailureCount, resetThrottle,
  timingSafeEqualHex, PBKDF2_ITERATIONS, MIN_DIGIT_LENGTH,
  _resetDeviceLockForTests, _readStoredRecordForTests,
} from '../../js/deviceLock.js';

test.beforeEach(() => _resetDeviceLockForTests());

test('secret policy rejects short or trivial passcodes', () => {
  assert.equal(validateSecret('').ok, false);
  assert.equal(validateSecret('3510').ok, false, 'the old 4-digit PIN must no longer qualify');
  assert.equal(validateSecret('12345').ok, false);
  assert.equal(validateSecret('000000').ok, false, 'a repeated digit is not a passcode');
  assert.equal(validateSecret('abc').ok, false);
  assert.equal(validateSecret('x'.repeat(300)).ok, false);
});

test('secret policy accepts at least six digits or a passphrase', () => {
  assert.equal(validateSecret('195023').ok, true);
  assert.equal(validateSecret(`${'1'.repeat(MIN_DIGIT_LENGTH - 1)}2`).ok, true);
  assert.equal(validateSecret('correct horse battery').ok, true);
});

test('setting the lock stores a salted PBKDF2 verifier and never the secret', async () => {
  assert.equal(isDeviceLockSet(), false);
  const result = await setDeviceLock('correct horse battery');
  assert.equal(result.ok, true);
  assert.equal(isDeviceLockSet(), true);

  const stored = _readStoredRecordForTests();
  assert.equal(stored.algo, 'PBKDF2-SHA256');
  assert.equal(stored.iterations, PBKDF2_ITERATIONS);
  assert.match(stored.salt, /^[0-9a-f]{32}$/);
  assert.match(stored.hash, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(stored).includes('correct horse battery'),
    'the secret itself must never be written to storage');
});

test('the same secret produces a different verifier on each device (unique salt)', async () => {
  await setDeviceLock('195023');
  const first = _readStoredRecordForTests();
  _resetDeviceLockForTests();
  await setDeviceLock('195023');
  const second = _readStoredRecordForTests();
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.hash, second.hash);
});

test('a weak secret is refused and leaves no lock behind', async () => {
  const result = await setDeviceLock('3510');
  assert.equal(result.ok, false);
  assert.match(result.reason, /digits|passphrase/i);
  assert.equal(isDeviceLockSet(), false);
});

test('the correct secret unlocks and a wrong one does not', async () => {
  await setDeviceLock('195023');
  assert.equal((await verifyDeviceLock('195023')).ok, true);
  const wrong = await verifyDeviceLock('195024');
  assert.equal(wrong.ok, false);
  assert.match(wrong.reason, /incorrect/i);
});

test('repeated failures escalate into a cooldown', async () => {
  await setDeviceLock('195023');
  for (let i = 0; i < 3; i++) await verifyDeviceLock('000001');
  assert.equal(getFailureCount(), 3);
  const cooldown = getCooldownRemainingMs();
  assert.ok(cooldown > 0, 'a cooldown should be active after three failures');

  const blocked = await verifyDeviceLock('195023');
  assert.equal(blocked.ok, false, 'even the right secret waits out the cooldown');
  assert.match(blocked.reason, /too many/i);

  resetThrottle();
  assert.equal((await verifyDeviceLock('195023')).ok, true);
  assert.equal(getFailureCount(), 0, 'a success clears the failure count');
});

test('clearing the lock removes it and its throttle state', async () => {
  await setDeviceLock('195023');
  await verifyDeviceLock('bad-guess');
  clearDeviceLock();
  assert.equal(isDeviceLockSet(), false);
  assert.equal(getFailureCount(), 0);
  const result = await verifyDeviceLock('195023');
  assert.equal(result.ok, false);
  assert.match(result.reason, /no device lock/i);
});

test('timingSafeEqualHex compares full length and rejects mismatched input', () => {
  assert.equal(timingSafeEqualHex('abcd', 'abcd'), true);
  assert.equal(timingSafeEqualHex('abcd', 'abce'), false);
  assert.equal(timingSafeEqualHex('abcd', 'abcdef'), false);
  assert.equal(timingSafeEqualHex('', ''), false);
  assert.equal(timingSafeEqualHex('zz', 'zz'), false, 'non-hex input is never equal');
  assert.equal(timingSafeEqualHex(null, undefined), false);
});
