// Shared E2E scaffolding: the fake-Supabase install, the production-host
// block, and the console/CSP watcher every spec uses.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const FAKE_SUPABASE = readFileSync(join(ROOT, 'tests', 'e2e', 'fixtures', 'fakeSupabase.js'), 'utf8');

export const OWNER = {
  id: 'e2e-owner-0000-4000-8000-000000000001',
  email: 'owner@example.invalid',
};
export const PASSWORD = 'correct horse battery';

/** Fake rows the owner is allowed to see, including one hostile habit name. */
export const OWNER_ROWS = {
  habit_logs: [
    { id: 'l1', user_id: OWNER.id, date: '2025-01-02', habit_id: 'gym_push_a', completed: true },
  ],
  custom_habits: [
    {
      id: 'c1',
      user_id: OWNER.id,
      // Storage-backed values that would be an XSS if interpolated raw.
      name: '<img src=x onerror="window.__XSS__=1">Reading',
      days: [0, 1, 2, 3, 4, 5, 6],
      color: 'red;background:url(javascript:alert(1))',
      active: true,
      sort_order: 0,
    },
  ],
};

/**
 * Install the fake client and block the real Supabase host.
 * @param {import('@playwright/test').Page} page
 * @param {{ scenario?: string, rows?: object, password?: string }} options
 */
export async function installFakeSupabase(page, options = {}) {
  const settings = {
    scenario: options.scenario || 'signed-out',
    user: OWNER,
    password: options.password || PASSWORD,
    rows: options.rows || {},
  };

  await page.addInitScript(config => { window.__DONTDIE_FAKE__ = config; }, settings);
  await page.addInitScript({ content: FAKE_SUPABASE });

  // The page loads the vendored Supabase library as a classic script, which
  // would overwrite window.supabase with the real client. Serve an empty file
  // instead so the fake installed above survives.
  await page.route('**/vendor/supabase-js-*.js*', route =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: '/* replaced by the E2E fake */' }));

  // Belt and braces: even if something tried, the production project is
  // unreachable from the suite.
  await page.route('**://*.supabase.co/**', route => route.abort());
  await page.route('**://cdn.jsdelivr.net/**', route => route.abort());

  // Remote fonts are irrelevant here; serve them empty so an aborted request
  // does not masquerade as an application console error.
  await page.route('**://fonts.googleapis.com/**', route =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('**://fonts.gstatic.com/**', route =>
    route.fulfill({ status: 200, contentType: 'font/woff2', body: '' }));
}

/**
 * Collect console errors and CSP violations for the lifetime of a page.
 * @param {import('@playwright/test').Page} page
 */
export function watchPage(page) {
  const consoleErrors = [];
  const cspViolations = [];

  page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/Content Security Policy|Refused to (load|execute|apply)/i.test(text)) cspViolations.push(text);
    consoleErrors.push(text);
  });
  page.on('pageerror', error => consoleErrors.push(String(error)));

  return { consoleErrors, cspViolations };
}
