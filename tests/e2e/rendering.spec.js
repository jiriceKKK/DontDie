// Baseline rendering evidence: every mode and its tabs come up behind the new
// authenticated gate, storage-backed values are escaped rather than executed,
// and the CSP does not break normal flows.
import { test, expect } from '@playwright/test';
import { installFakeSupabase, watchPage, OWNER_ROWS } from './fixtures/seed.js';

const MODES = ['home', 'physical', 'mental', 'stimulation', 'school'];

async function bootSignedIn(page, rows = OWNER_ROWS) {
  await installFakeSupabase(page, { scenario: 'signed-in', rows });
  await page.goto('/index.html');
  await expect(page.locator('#app')).toBeVisible();
}

test.describe('rendering behind the auth gate', () => {
  test('the shell renders with navigation and no fatal error', async ({ page }) => {
    const watcher = watchPage(page);
    await bootSignedIn(page);

    await expect(page.locator('#main-content')).toBeVisible();
    await expect(page.locator('#fatal-error')).toHaveCount(0);
    await expect(page.locator('#tab-slider > *').first()).toBeVisible();
    expect(watcher.cspViolations, 'the CSP must not block normal boot').toEqual([]);
  });

  test('every mode and each of its tabs renders', async ({ page }) => {
    await bootSignedIn(page);

    for (const mode of MODES) {
      await page.evaluate(async (id) => {
        const { setMode } = await import('/js/modes/controller.js');
        setMode(id);
      }, mode);

      const tabs = await page.evaluate(async () => {
        const { state } = await import('/js/state.js');
        return state.modeTabs.slice();
      });
      expect(tabs.length, `${mode} should expose tabs`).toBeGreaterThan(0);

      for (const tab of tabs) {
        await page.evaluate(async (id) => {
          const { switchTab } = await import('/js/navigation.js');
          switchTab(id);
        }, tab);
        await expect(page.locator(`#tab-${tab}`), `${mode}/${tab} should render`).toHaveCount(1);
      }
    }

    await expect(page.locator('#fatal-error')).toHaveCount(0);
  });

  test('the page never scrolls horizontally', async ({ page }) => {
    await bootSignedIn(page);
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('no request reaches the real Supabase project or a CDN', async ({ page }) => {
    const external = [];
    page.on('request', request => {
      const url = request.url();
      if (!url.startsWith('http://127.0.0.1') && !url.startsWith('data:') && !url.startsWith('blob:')) {
        external.push(url);
      }
    });

    await bootSignedIn(page);
    const offenders = external.filter(url => /supabase\.co|jsdelivr/.test(url));
    expect(offenders, 'the suite must never touch the production project').toEqual([]);
  });
});

test.describe('output safety', () => {
  test('a hostile stored habit name is shown as text, never executed', async ({ page }) => {
    await bootSignedIn(page);

    // Physical -> Today renders custom habits from the (fake) database.
    await page.evaluate(async () => {
      const { setMode } = await import('/js/modes/controller.js');
      setMode('physical');
    });
    await expect(page.locator('#tab-today')).toHaveCount(1);

    const name = await page.locator('#tab-today .habit-name').filter({ hasText: 'Reading' }).first().textContent();
    expect(name).toContain('<img src=x onerror=');

    // The markup must not have become a real element, and the payload must not
    // have run.
    expect(await page.locator('#tab-today .habit-name img').count()).toBe(0);
    expect(await page.evaluate(() => window.__XSS__)).toBeUndefined();
  });

  test('a hostile stored colour cannot escape the style attribute', async ({ page }) => {
    await bootSignedIn(page);
    await page.evaluate(async () => {
      const { setMode } = await import('/js/modes/controller.js');
      setMode('physical');
    });
    await expect(page.locator('#tab-today')).toHaveCount(1);

    const styles = await page.locator('#tab-today .cat-dot').evaluateAll(
      nodes => nodes.map(node => node.getAttribute('style') || ''));
    for (const style of styles) {
      expect(style).not.toMatch(/javascript:/i);
      expect(style).not.toMatch(/url\(/i);
    }
  });
});
