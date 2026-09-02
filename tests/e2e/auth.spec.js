// The authentication gate: the four states plan.md requires evidence for —
// signed out, signed in, expired session, and offline with a cached session.
import { test, expect } from '@playwright/test';
import { installFakeSupabase, watchPage, settleSync, OWNER, OWNER_ROWS, PASSWORD } from './fixtures/seed.js';

test.describe('auth gate', () => {
  test('signed out: the gate is shown and the app stays hidden', async ({ page }) => {
    const watcher = watchPage(page);
    await installFakeSupabase(page, { scenario: 'signed-out' });
    await page.goto('/index.html');

    await expect(page.locator('#auth-screen')).toBeVisible();
    await expect(page.locator('#auth-form')).toBeVisible();
    await expect(page.locator('#app')).toBeHidden();

    // Nothing personal may be requested before there is a session.
    const queries = await page.evaluate(() => window.__DONTDIE_QUERIES__.length);
    expect(queries, 'no database query may be issued while signed out').toBe(0);
    expect(watcher.cspViolations).toEqual([]);
  });

  test('signed out: a wrong password shows an error and does not open the app', async ({ page }) => {
    await installFakeSupabase(page, { scenario: 'signed-out' });
    await page.goto('/index.html');

    await page.fill('#auth-email', OWNER.email);
    await page.fill('#auth-password', 'not-the-password');
    await page.click('#auth-submit');

    await expect(page.locator('#auth-error')).toContainText(/incorrect/i);
    await expect(page.locator('#app')).toBeHidden();
    expect(await page.evaluate(() => window.__DONTDIE_QUERIES__.length)).toBe(0);
  });

  test('signing in opens the app and every query carries the owner id', async ({ page }) => {
    const watcher = watchPage(page);
    await installFakeSupabase(page, { scenario: 'signed-out', rows: OWNER_ROWS });
    await page.goto('/index.html');

    await page.fill('#auth-email', OWNER.email);
    await page.fill('#auth-password', PASSWORD);
    await page.click('#auth-submit');

    // First sign-in offers the optional device lock; declining enters the app.
    await expect(page.locator('#lock-setup-form')).toBeVisible();
    await page.click('#lock-setup-skip');

    await expect(page.locator('#app')).toBeVisible();
    await expect(page.locator('#auth-screen')).toBeHidden();

    // Since Phase 2 the shell renders from IndexedDB and reconciles with the
    // cloud afterwards, so the first query may not have been issued yet when
    // the app becomes visible. Wait for reconciliation before inspecting it.
    await settleSync(page);
    const queries = await page.evaluate(() => window.__DONTDIE_QUERIES__);
    expect(queries.length, 'background reconciliation must still reach the cloud').toBeGreaterThan(0);
    for (const query of queries) {
      if (query.op === 'insert' || query.op === 'upsert') {
        // Writes carry the owner in the row itself.
        const rows = Array.isArray(query.payload) ? query.payload : [query.payload];
        for (const row of rows) {
          expect(row.user_id, `${query.table} ${query.op} must stamp user_id`).toBe(OWNER.id);
        }
      } else {
        // Reads, updates and deletes are filtered to the owner.
        const ownerFilter = query.filters.find(([op, column]) => op === 'eq' && column === 'user_id');
        expect(ownerFilter, `${query.table} ${query.op} must filter by user_id`).toBeTruthy();
        expect(ownerFilter[2]).toBe(OWNER.id);
      }
    }
    expect(watcher.cspViolations).toEqual([]);
  });

  test('a restored session skips sign-in entirely', async ({ page }) => {
    await installFakeSupabase(page, { scenario: 'signed-in', rows: OWNER_ROWS });
    await page.goto('/index.html');

    await expect(page.locator('#app')).toBeVisible();
    await expect(page.locator('#auth-screen')).toBeHidden();
  });

  test('an expired session leaves the gate up and sends no query', async ({ page }) => {
    await installFakeSupabase(page, { scenario: 'expired', rows: OWNER_ROWS });
    await page.goto('/index.html');

    await expect(page.locator('#auth-screen')).toBeVisible();
    await expect(page.locator('#auth-form')).toBeVisible();
    await expect(page.locator('#app')).toBeHidden();
    expect(await page.evaluate(() => window.__DONTDIE_QUERIES__.length)).toBe(0);
  });

  test('a session that dies while the app is open brings the gate back', async ({ page }) => {
    await installFakeSupabase(page, { scenario: 'signed-in', rows: OWNER_ROWS });
    await page.goto('/index.html');
    await expect(page.locator('#app')).toBeVisible();

    await page.evaluate(() => window.__DONTDIE_EXPIRE__());

    await expect(page.locator('#auth-screen')).toBeVisible();
    await expect(page.locator('#auth-error')).toContainText(/expired/i);
  });

  test('offline with no session: the gate explains rather than opening data', async ({ page }) => {
    await installFakeSupabase(page, { scenario: 'offline' });
    await page.goto('/index.html');

    await expect(page.locator('#auth-screen')).toBeVisible();
    await expect(page.locator('#app')).toBeHidden();
    const message = await page.evaluate(() =>
      `${document.getElementById('auth-status').textContent} ${document.getElementById('auth-error').textContent}`);
    expect(message).toMatch(/offline|could not reach/i);
  });

  test('offline with a cached session: local data still renders', async ({ page }) => {
    // A cached token is a valid session; only the data calls fail.
    await installFakeSupabase(page, { scenario: 'signed-in', rows: {} });
    await page.goto('/index.html');
    await expect(page.locator('#app')).toBeVisible();

    await page.context().setOffline(true);
    await expect(page.locator('#app')).toBeVisible();
    await page.context().setOffline(false);
  });
});
