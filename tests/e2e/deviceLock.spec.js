// The optional on-device privacy lock, end to end.
//
// The point of these tests is the boundary: the lock is a UI courtesy on top of
// a real session, it is never required to have one, and it never authorizes a
// database request on its own.
import { test, expect } from '@playwright/test';
import { installFakeSupabase, OWNER_ROWS } from './fixtures/seed.js';

const PASSCODE = '4820 windmill';

test.describe('device lock', () => {
  test('is optional: declining at setup is remembered', async ({ page }) => {
    await installFakeSupabase(page, { scenario: 'signed-out', rows: OWNER_ROWS });
    await page.goto('/index.html');

    await page.fill('#auth-email', 'owner@example.invalid');
    await page.fill('#auth-password', 'correct horse battery');
    await page.click('#auth-submit');

    await expect(page.locator('#lock-setup-form')).toBeVisible();
    await page.click('#lock-setup-skip');
    await expect(page.locator('#app')).toBeVisible();

    const declined = await page.evaluate(() => localStorage.getItem('dontdie_device_lock_declined_v1'));
    expect(declined).toBe('1');
  });

  test('rejects a weak passcode and a mismatched confirmation', async ({ page }) => {
    await installFakeSupabase(page, { scenario: 'signed-out', rows: OWNER_ROWS });
    await page.goto('/index.html');
    await page.fill('#auth-email', 'owner@example.invalid');
    await page.fill('#auth-password', 'correct horse battery');
    await page.click('#auth-submit');
    await expect(page.locator('#lock-setup-form')).toBeVisible();

    // The old four-digit PIN is no longer an acceptable secret.
    await page.fill('#lock-setup-secret', '3510');
    await page.fill('#lock-setup-confirm', '3510');
    await page.click('#lock-setup-submit');
    await expect(page.locator('#auth-error')).toContainText(/at least 6 digits|passphrase/i);
    await expect(page.locator('#app')).toBeHidden();

    await page.fill('#lock-setup-secret', PASSCODE);
    await page.fill('#lock-setup-confirm', 'something else');
    await page.click('#lock-setup-submit');
    await expect(page.locator('#auth-error')).toContainText(/do not match/i);
    await expect(page.locator('#app')).toBeHidden();
  });

  test('once set, it is asked for on return and the secret is not stored', async ({ page }) => {
    await installFakeSupabase(page, { scenario: 'signed-in', rows: OWNER_ROWS });
    await page.goto('/index.html');
    await expect(page.locator('#app')).toBeVisible();

    // Set the lock through the module the gate uses.
    await page.evaluate(async (secret) => {
      const { setDeviceLock } = await import('/js/deviceLock.js');
      const result = await setDeviceLock(secret);
      if (!result.ok) throw new Error(result.reason);
    }, PASSCODE);

    const stored = await page.evaluate(() => localStorage.getItem('dontdie_device_lock_v1'));
    expect(stored).toBeTruthy();
    expect(stored).not.toContain(PASSCODE);
    expect(JSON.parse(stored).algo).toBe('PBKDF2-SHA256');

    // The unlock is session-scoped: clearing it is what a fresh tab looks like.
    await page.evaluate(() => sessionStorage.removeItem('dontdie_device_unlocked'));
    await page.reload();
    await expect(page.locator('#lock-form')).toBeVisible();
    await expect(page.locator('#app')).toBeHidden();

    await page.fill('#lock-secret', 'wrong passcode');
    await page.click('#lock-submit');
    await expect(page.locator('#auth-error')).toContainText(/incorrect|too many/i);
    await expect(page.locator('#app')).toBeHidden();

    await page.fill('#lock-secret', PASSCODE);
    await page.click('#lock-submit');
    await expect(page.locator('#app')).toBeVisible();
  });

  test('signing out from the lock screen clears the session', async ({ page }) => {
    await installFakeSupabase(page, { scenario: 'signed-in', rows: OWNER_ROWS });
    await page.goto('/index.html');
    await expect(page.locator('#app')).toBeVisible();

    await page.evaluate(async (secret) => {
      const { setDeviceLock } = await import('/js/deviceLock.js');
      await setDeviceLock(secret);
    }, PASSCODE);

    await page.evaluate(() => sessionStorage.removeItem('dontdie_device_unlocked'));
    await page.reload();
    await expect(page.locator('#lock-form')).toBeVisible();

    await page.click('#lock-signout');
    await expect(page.locator('#auth-form')).toBeVisible();
    await expect(page.locator('#app')).toBeHidden();

    const unlocked = await page.evaluate(() => sessionStorage.getItem('dontdie_device_unlocked'));
    expect(unlocked).toBeNull();
  });

  test('the lock never unlocks cloud data on its own', async ({ page }) => {
    // Signed out, but a device lock exists on this device: the gate must still
    // ask for the account, and no query may be issued.
    await installFakeSupabase(page, { scenario: 'signed-out', rows: OWNER_ROWS });
    await page.addInitScript(() => {
      localStorage.setItem('dontdie_device_lock_v1', JSON.stringify({
        v: 1, algo: 'PBKDF2-SHA256', iterations: 210000,
        salt: '0'.repeat(32), hash: '0'.repeat(64), createdAt: new Date().toISOString(),
      }));
      sessionStorage.setItem('dontdie_device_unlocked', '1');
    });

    await page.goto('/index.html');

    await expect(page.locator('#auth-form')).toBeVisible();
    await expect(page.locator('#app')).toBeHidden();
    expect(await page.evaluate(() => window.__DONTDIE_QUERIES__.length)).toBe(0);
  });
});
