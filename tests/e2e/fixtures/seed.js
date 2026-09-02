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

/** Activities the populated logs refer to. Without these the module has an
 * empty catalogue and any habit/stimulation link test is vacuous. */
const STIM_ACTIVITIES = [
  { id: 'a-social', name: 'Social feeds', stimulationScore: 8, defaultDurationMinutes: 30, tags: ['cheap'], active: true },
  { id: 'a-reading', name: 'Deep reading', stimulationScore: 2, defaultDurationMinutes: 45, tags: ['productive'], active: true },
];

/**
 * A realistically populated owner. Empty panels make a swipe look fast for the
 * wrong reason, so the performance specs render against this instead.
 */
export function populatedRows({ days = 84, habits = 6 } = {}) {
  const habitIds = ['gym_push_a', 'mobility', 'reading', 'cold_shower', 'walk', 'sleep_by_23'].slice(0, habits);
  const logs = [];
  const start = new Date('2026-06-01T00:00:00.000Z');
  for (let d = 0; d < days; d++) {
    const date = new Date(start.getTime() + d * 86_400_000).toISOString().slice(0, 10);
    for (const habitId of habitIds) {
      if ((d + habitId.length) % 3 === 0) continue;   // deliberately gappy
      logs.push({ id: `l${d}-${habitId}`, user_id: OWNER.id, date, habit_id: habitId, completed: (d + habitId.length) % 2 === 0 });
    }
  }

  const checkins = {};
  const tasks = [];
  const journal = [];
  for (let d = 0; d < 60; d++) {
    const date = new Date(start.getTime() + d * 86_400_000).toISOString().slice(0, 10);
    checkins[date] = { mood: (d % 5) + 1, energy: (d % 4) + 1, focus: (d % 3) + 1, sleepHours: 6 + (d % 3) };
    tasks.push({ id: `t${d}`, text: `Task ${d}`, date, done: d % 2 === 0, createdAt: `${date}T08:00:00.000Z` });
    if (d % 4 === 0) journal.push({ id: `j${d}`, date, template: 'free', body: `Entry ${d}`, createdAt: `${date}T21:00:00.000Z` });
  }

  const stimLogs = {};
  for (let d = 0; d < 60; d++) {
    const date = new Date(start.getTime() + d * 86_400_000).toISOString().slice(0, 10);
    stimLogs[date] = {
      blocks: {
        2: [{ id: `s${d}a`, activityId: 'a-social', durationMinutes: 30, intensity: 1, source: 'manual', createdAt: `${date}T10:00:00.000Z` }],
        5: [{ id: `s${d}b`, activityId: 'a-reading', durationMinutes: 45, intensity: 1, source: 'manual', createdAt: `${date}T17:00:00.000Z` }],
      },
    };
  }

  const subjects = ['Maths', 'Physics', 'History', 'Biology'].map((name, i) => ({ id: `sub${i}`, name, difficulty: (i % 3) + 1 }));
  const tests = subjects.map((s, i) => ({
    id: `test${i}`, subjectId: s.id, title: `${s.name} exam`, date: '2026-09-20',
    importance: (i % 3) + 1, status: 'active', createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z',
  }));
  const sessions = [];
  for (let d = 0; d < 40; d++) {
    const date = new Date(start.getTime() + d * 86_400_000).toISOString().slice(0, 10);
    sessions.push({
      id: `ses${d}`, testId: tests[d % tests.length].id, subjectId: subjects[d % subjects.length].id,
      date, minutes: 45, type: 'practice', status: d % 3 === 0 ? 'done' : 'planned',
      createdAt: `${date}T07:00:00.000Z`, updatedAt: `${date}T07:00:00.000Z`,
    });
  }

  const texts = [];
  for (let i = 0; i < 25; i++) {
    texts.push({
      id: `txt${i}`, title: `Reading ${i}`, body: 'Lorem ipsum '.repeat(40),
      status: i < 5 ? 'read' : 'unread', queueOrder: i, wordCount: 80,
      createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z',
    });
  }

  return {
    habit_logs: logs,
    custom_habits: [
      { id: 'c1', user_id: OWNER.id, name: 'Reading', days: [0, 1, 2, 3, 4, 5, 6], color: '#6ee7b7', active: true, sort_order: 0 },
      { id: 'c2', user_id: OWNER.id, name: 'Cold shower', days: [1, 3, 5], color: '#38bdf8', active: true, sort_order: 1 },
    ],
    mh_store: [{ user_id: OWNER.id, id: 1, revision: 1, updated_at: '2026-06-01T00:00:00.000Z', data: { version: 1, updatedAt: '2026-06-01T00:00:00.000Z', checkins, tasks, journal } }],
    stimulation_store: [{ user_id: OWNER.id, id: 1, revision: 1, updated_at: '2026-06-01T00:00:00.000Z', data: { version: 1, updatedAt: '2026-06-01T00:00:00.000Z', activities: STIM_ACTIVITIES, logs: stimLogs } }],
    school_store: [{ user_id: OWNER.id, id: 1, revision: 1, updated_at: '2026-06-01T00:00:00.000Z', data: { version: 1, updatedAt: '2026-06-01T00:00:00.000Z', subjects, tests, sessions, results: [] } }],
    mind_texts_store: [{ user_id: OWNER.id, id: 1, revision: 1, updated_at: '2026-06-01T00:00:00.000Z', data: { version: 1, updatedAt: '2026-06-01T00:00:00.000Z', texts, books: [] } }],
  };
}

/**
 * Install the fake client and block the real Supabase host.
 * @param {import('@playwright/test').Page} page
 * @param {{ scenario?: string, rows?: object, password?: string, installedTables?: string[] }} options
 */
export async function installFakeSupabase(page, options = {}) {
  const settings = {
    scenario: options.scenario || 'signed-out',
    user: OWNER,
    password: options.password || PASSWORD,
    rows: options.rows || {},
    installedTables: options.installedTables,
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

/**
 * Boot the app signed in and wait until the local layer has hydrated and the
 * first background reconciliation has settled.
 * @param {import('@playwright/test').Page} page
 */
export async function bootSignedIn(page, options = {}) {
  await installFakeSupabase(page, { scenario: 'signed-in', ...options });
  await page.goto('/index.html');
  await page.locator('#app').waitFor({ state: 'visible' });
  await page.locator('#tab-slider > *').first().waitFor({ state: 'attached' });
  await settleSync(page);
}

/**
 * Wait until the outbox has drained AND background reconciliation has gone
 * quiet. Startup hydration is a burst of legitimate reads; a spec that starts
 * measuring before it finishes would blame the feature under test for them.
 */
export async function settleSync(page, timeout = 8000) {
  // Wait for the local layer to finish booting first: 'pending' is not the
  // same as 'unavailable', and treating it as such let assertions run before
  // anything had been stored.
  await page.waitForFunction(async () => {
    const module = await import('/js/data/repository.js');
    return module.localStoreStatus() !== 'pending';
  }, undefined, { timeout });

  await page.waitForFunction(async () => {
    const module = await import('/js/data/repository.js');
    if (!module.localStoreReady()) return true;
    return (await module.outboxSize()) === 0;
  }, undefined, { timeout });

  await page.waitForFunction(() => {
    const queries = window.__DONTDIE_QUERIES__ || [];
    const now = Date.now();
    const last = queries.length ? queries[queries.length - 1].at : 0;
    window.__DONTDIE_SETTLED_AT__ = queries.length;
    return now - last > 400;                    // no cloud traffic for 400 ms
  }, undefined, { timeout });
}

/** How many operations are still queued locally. */
export function outboxSize(page) {
  return page.evaluate(async () => {
    const module = await import('/js/data/repository.js');
    return module.outboxSize();
  });
}

/** Switch modes/tabs through the real controller. */
export async function goTo(page, mode, tab) {
  await page.evaluate(async ([modeId, tabId]) => {
    const { setMode } = await import('/js/modes/controller.js');
    const { switchTab } = await import('/js/navigation.js');
    setMode(modeId);
    if (tabId) switchTab(tabId, false);
  }, [mode, tab]);
}
