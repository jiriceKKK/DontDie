// Content Security Policy, checked against the page as it is actually shipped.
//
// Unlike the other specs, this one does NOT install the fake Supabase client:
// the point is to prove the real vendored library loads under `script-src
// 'self'` and that nothing in the boot path is blocked. No session exists, so
// the app stops at the gate and makes no network call of its own; requests to
// the production host are aborted regardless.
import { test, expect } from '@playwright/test';
import { watchPage } from './fixtures/seed.js';

test.describe('content security policy', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**://*.supabase.co/**', route => route.abort());
    await page.route('**://fonts.googleapis.com/**', route =>
      route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.route('**://fonts.gstatic.com/**', route =>
      route.fulfill({ status: 200, contentType: 'font/woff2', body: '' }));
  });

  test('the vendored Supabase library loads and nothing is blocked', async ({ page }) => {
    const watcher = watchPage(page);
    await page.goto('/index.html');

    await expect(page.locator('#auth-screen')).toBeVisible();

    // The real library, served from our own origin, is what defines the client.
    const loaded = await page.evaluate(() =>
      typeof window.supabase?.createClient === 'function');
    expect(loaded, 'the vendored library must load under script-src self').toBe(true);

    expect(watcher.cspViolations, 'no CSP violation during boot').toEqual([]);
  });

  test('an injected inline script is refused by the policy', async ({ page }) => {
    const watcher = watchPage(page);
    await page.goto('/index.html');
    await expect(page.locator('#auth-screen')).toBeVisible();

    // Simulates what a stored-value injection would try to do.
    await page.evaluate(() => {
      const script = document.createElement('script');
      script.textContent = 'window.__CSP_BYPASS__ = true;';
      document.body.appendChild(script);
    });

    expect(await page.evaluate(() => window.__CSP_BYPASS__)).toBeUndefined();
    expect(watcher.cspViolations.length,
      'the policy should have reported refusing the inline script').toBeGreaterThan(0);
  });

  test('a third-party script host is refused by the policy', async ({ page }) => {
    const watcher = watchPage(page);
    let attempted = false;
    await page.route('**://cdn.jsdelivr.net/**', route => { attempted = true; route.abort(); });

    await page.goto('/index.html');
    await expect(page.locator('#auth-screen')).toBeVisible();

    await page.evaluate(() => new Promise(resolve => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
      script.onerror = () => resolve();
      script.onload = () => resolve();
      document.head.appendChild(script);
      setTimeout(resolve, 2000);
    }));

    expect(attempted, 'the CSP should block the request before it is even made').toBe(false);
    expect(watcher.cspViolations.length).toBeGreaterThan(0);
  });

  test('the page loads nothing from a third party but the font hosts', async ({ page }) => {
    const requested = [];
    page.on('request', request => requested.push(request.url()));

    await page.goto('/index.html');
    await expect(page.locator('#auth-screen')).toBeVisible();

    const thirdParty = requested.filter(url =>
      !url.startsWith('http://127.0.0.1') && !url.startsWith('data:') && !url.startsWith('blob:'));
    for (const url of thirdParty) {
      expect(url, `unexpected third-party request: ${url}`).toMatch(/fonts\.(googleapis|gstatic)\.com/);
    }
  });
});
