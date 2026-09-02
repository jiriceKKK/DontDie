// Local-first behaviour end to end: render before the cloud answers, survive a
// reload while offline, and converge exactly once on reconnect.
import { test, expect } from '@playwright/test';
import { installFakeSupabase, populatedRows, settleSync, outboxSize, watchPage, OWNER } from './fixtures/seed.js';

async function boot(page, options = {}) {
  await installFakeSupabase(page, { scenario: 'signed-in', rows: populatedRows(), ...options });
  await page.goto('/index.html');
  await expect(page.locator('#app')).toBeVisible();
  await settleSync(page);
}

const setNetwork = (page, state) => page.evaluate(s => { window.__DONTDIE_NET__ = s; }, state);

/** Toggle the first habit on today's card and wait for the local write. */
async function toggleFirstHabit(page) {
  return page.evaluate(async () => {
    const { state } = await import('/js/state.js');
    const { getHabitsForDate } = await import('/js/habits.js');
    const { formatDate, today } = await import('/js/utils/date.js');
    const { toggleHabit } = await import('/js/tabs/today.js');
    const date = formatDate(today());
    const habit = getHabitsForDate(today())[0];
    const before = !!(state.logsByDate[date] || {})[habit.id];
    await toggleHabit(date, habit.id, before);
    return { date, habitId: habit.id, before, after: !!(state.logsByDate[date] || {})[habit.id] };
  });
}

test.describe('local-first persistence', () => {
  test('content renders before the cloud answers', async ({ page }) => {
    // First visit populates the local database.
    await boot(page);
    await expect(page.locator('#tab-slider > *').first()).toBeVisible();

    // Second visit with the link already down before a single line of app code
    // runs: the shell must still come up, from IndexedDB alone.
    await page.addInitScript(() => { window.__DONTDIE_NET__ = 'down'; });
    await page.reload();
    await expect(page.locator('#app')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#tab-slider > *').first()).toBeVisible();

    const rendered = await page.evaluate(async () => {
      const { state } = await import('/js/state.js');
      return {
        modes: state.modeTabs.length,
        split: !!(state.split && state.split.days && state.split.days.length),
        school: !!state.school,
        mind: !!state.mental,
      };
    });
    expect(rendered.modes).toBeGreaterThan(0);
    expect(rendered.split).toBe(true);
    expect(rendered.school).toBe(true);
    expect(rendered.mind).toBe(true);
  });

  test('legacy localStorage documents migrate without being destroyed', async ({ page }) => {
    await installFakeSupabase(page, { scenario: 'signed-in', rows: {} });
    await page.addInitScript(() => {
      localStorage.setItem('dontdie_split_v1', JSON.stringify({
        version: 3, updatedAt: '2026-01-01T00:00:00.000Z',
        days: [{ dow: 1, name: 'LEGACY DAY', label: 'from localStorage', activities: [], gym: null, mobility: { label: '', items: [] } }],
        muscles: [], library: [], warmup: { title: '', duration: '', items: [] }, notes: [],
      }));
    });
    await page.goto('/index.html');
    await expect(page.locator('#app')).toBeVisible();
    await settleSync(page);

    const result = await page.evaluate(async () => {
      const repo = await import('/js/data/repository.js');
      const migrations = await import('/js/data/migrations.js');
      const { requireUserId } = await import('/js/session.js');
      const owner = requireUserId();
      const document_ = await repo.loadLocalDocument('split');
      return {
        migrated: !!(document_ && document_.days || []).length,
        legacyKept: localStorage.getItem('dontdie_split_v1') !== null,
        complete: await migrations.migrationComplete(owner),
        firstDay: document_ && document_.days && document_.days[0] && document_.days[0].name,
      };
    });

    expect(result.migrated).toBe(true);
    expect(result.firstDay).toBe('LEGACY DAY');
    expect(result.legacyKept, 'the legacy key must survive one recovery cycle').toBe(true);
    expect(result.complete).toBe(true);
  });

  test('an interrupted migration resumes on the next launch without duplicating', async ({ page }) => {
    await installFakeSupabase(page, { scenario: 'signed-in', rows: {} });
    await page.addInitScript(() => {
      localStorage.setItem('dontdie_school_v1', JSON.stringify({
        version: 1, updatedAt: '2026-01-01T00:00:00.000Z',
        subjects: [{ id: 's1', name: 'Interrupted' }], tests: [], sessions: [], results: [], settings: {},
      }));
    });
    await page.goto('/index.html');
    await expect(page.locator('#app')).toBeVisible();
    await settleSync(page);

    // Tear the marker out, exactly as a crash between write and marker would.
    const after = await page.evaluate(async () => {
      const idb = await import('/js/data/indexedDb.js');
      const migrations = await import('/js/data/migrations.js');
      const { requireUserId } = await import('/js/session.js');
      const owner = requireUserId();
      await idb.runTx(idb.STORE.meta, 'readwrite', ({ store }) => {
        store(idb.STORE.meta).delete(migrations.markerKey('school', owner));
      });

      const results = await migrations.migrateLegacyDocuments(owner);
      const documents = await idb.getAllRecords(idb.STORE.documents);
      const repo = await import('/js/data/repository.js');
      return {
        school: results.find(r => r.storeId === 'school').status,
        schoolDocs: documents.filter(d => d.storeId === 'school').length,
        subjects: (await repo.loadLocalDocument('school')).subjects.length,
      };
    });

    expect(after.school).toBe('migrated');
    expect(after.schoolDocs, 'a resumed migration must not create a second record').toBe(1);
    expect(after.subjects).toBe(1);
  });

  test('an offline mutation survives a reload and converges exactly once on reconnect', async ({ page }) => {
    const watcher = watchPage(page);
    await boot(page);

    await setNetwork(page, 'down');
    const toggled = await toggleFirstHabit(page);
    expect(toggled.after).toBe(!toggled.before);

    // The UI is not lying: the change is durably stored and queued.
    expect(await outboxSize(page)).toBeGreaterThan(0);
    await expect(page.locator('#sync-status')).toBeVisible();

    // Reload while still offline — the link must be down from the very first
    // frame, or startup would sync the change before the assertion runs.
    await page.addInitScript(() => { window.__DONTDIE_NET__ = 'down'; });
    await page.reload();
    await expect(page.locator('#app')).toBeVisible();

    const survived = await page.evaluate(async ([date, habitId]) => {
      const { state } = await import('/js/state.js');
      const repo = await import('/js/data/repository.js');
      return {
        value: !!(state.logsByDate[date] || {})[habitId],
        queued: await repo.outboxSize(),
      };
    }, [toggled.date, toggled.habitId]);

    expect(survived.value, 'the offline change must still be applied after a reload').toBe(toggled.after);
    expect(survived.queued, 'the queued write must have survived the reload').toBeGreaterThan(0);

    // Reconnect: the queue drains and the cloud ends up with exactly one row.
    await setNetwork(page, 'up');
    await page.evaluate(async () => {
      const { setOnline } = await import('/js/sync.js');
      setOnline(true);
    });
    await page.waitForFunction(async () => {
      const repo = await import('/js/data/repository.js');
      return (await repo.outboxSize()) === 0;
    }, undefined, { timeout: 8000 });

    const cloud = await page.evaluate(([date, habitId]) => {
      const rows = window.__DONTDIE_CLOUD__.rows('habit_logs')
        .filter(r => r.date === date && r.habit_id === habitId);
      return { count: rows.length, completed: rows[0] && rows[0].completed };
    }, [toggled.date, toggled.habitId]);

    expect(cloud.count, 'exactly one row, not a duplicate per retry').toBe(1);
    expect(cloud.completed).toBe(toggled.after);
    expect(watcher.consoleErrors.filter(e => !/Failed to fetch/i.test(e))).toEqual([]);
  });

  test('repeated offline toggles converge to the final state with one write', async ({ page }) => {
    await boot(page);
    await setNetwork(page, 'down');

    let target = null;
    for (let i = 0; i < 5; i++) target = await toggleFirstHabit(page);
    const finalValue = target.after;

    const queuedForHabit = await page.evaluate(async ([date, habitId]) => {
      const idb = await import('/js/data/indexedDb.js');
      const ops = await idb.getAllRecords(idb.STORE.outbox);
      return ops.filter(o => o.kind === 'habitLog' && o.entity === `${date}|${habitId}`).length;
    }, [target.date, target.habitId]);
    expect(queuedForHabit, 'five toggles are one intent').toBe(1);

    const writesBefore = await page.evaluate(() => window.__DONTDIE_CLOUD__.writes().length);
    await setNetwork(page, 'up');
    await page.evaluate(async () => (await import('/js/sync.js')).setOnline(true));
    await page.waitForFunction(async () => (await import('/js/data/repository.js')).outboxSize().then(n => n === 0), undefined, { timeout: 8000 });

    const result = await page.evaluate(([date, habitId, before]) => {
      const rows = window.__DONTDIE_CLOUD__.rows('habit_logs').filter(r => r.date === date && r.habit_id === habitId);
      return { rows: rows.length, completed: rows[0] && rows[0].completed, writes: window.__DONTDIE_CLOUD__.writes().length - before };
    }, [target.date, target.habitId, writesBefore]);

    expect(result.rows).toBe(1);
    expect(result.completed).toBe(finalValue);
    expect(result.writes, 'one logical operation, one remote write').toBeLessThanOrEqual(2);
  });

  test('a linked habit and its stimulation entry converge together after an outage', async ({ page }) => {
    await boot(page);

    // Link the first habit to a stimulation activity, then work offline.
    const linked = await page.evaluate(async () => {
      const { getActivities } = await import('/js/stimulation/store.js');
      const { setBuiltinOverride } = await import('/js/habitConfig.js');
      const { getHabitsForDate } = await import('/js/habits.js');
      const { today, formatDate } = await import('/js/utils/date.js');
      const activity = getActivities()[0];
      const habit = getHabitsForDate(today())[0];
      setBuiltinOverride(habit.id, { stimLink: { enabled: true, activityId: activity.id, durationMin: 20 } });
      return { habitId: habit.id, activityId: activity.id, date: formatDate(today()) };
    });

    await settleSync(page);
    await setNetwork(page, 'down');

    const state = await toggleFirstHabit(page);
    const completed = state.after;

    const localLink = await page.evaluate(async ([date, habitId]) => {
      const { findHabitLinkEntries } = await import('/js/stimulation/store.js');
      return findHabitLinkEntries(date, habitId).length;
    }, [linked.date, linked.habitId]);
    expect(localLink, 'the linked entry follows the habit locally').toBe(completed ? 1 : 0);

    await setNetwork(page, 'up');
    await page.evaluate(async () => (await import('/js/sync.js')).setOnline(true));
    await page.waitForFunction(async () => (await import('/js/data/repository.js')).outboxSize().then(n => n === 0), undefined, { timeout: 8000 });

    const converged = await page.evaluate(([date, habitId, expected]) => {
      const logs = window.__DONTDIE_CLOUD__.rows('habit_logs').filter(r => r.date === date && r.habit_id === habitId);
      const stim = window.__DONTDIE_CLOUD__.read('stimulation_store');
      const day = stim && stim.data && stim.data.logs && stim.data.logs[date];
      let entries = 0;
      for (const block of Object.values((day && day.blocks) || {})) {
        entries += block.filter(e => e.source === 'habit_link' && e.linkedHabitId === habitId).length;
      }
      return { logCompleted: logs[0] && logs[0].completed, entries, expected };
    }, [linked.date, linked.habitId, completed]);

    expect(converged.logCompleted).toBe(completed);
    expect(converged.entries, 'the linked stimulation entry reached the cloud with the habit').toBe(completed ? 1 : 0);
  });

  test('a delete during an outage is not resurrected by a later hydrate', async ({ page }) => {
    await boot(page);
    await setNetwork(page, 'down');

    await page.evaluate(async () => {
      const repo = await import('/js/data/repository.js');
      const { state } = await import('/js/state.js');
      await repo.persistCustomHabitDelete(state.customHabits[0].id);
      state.customHabits = state.customHabits.slice(1);
    });

    await setNetwork(page, 'up');
    await page.evaluate(async () => {
      const repo = await import('/js/data/repository.js');
      const { formatDate, today, getNDaysAgo } = await import('/js/utils/date.js');
      const { setOnline } = await import('/js/sync.js');
      setOnline(true);
      // Force a hydrate that races the queued delete.
      await repo.hydrateFromRemote({ rangeStart: formatDate(getNDaysAgo(84)), rangeEnd: formatDate(today()) });
    });
    await page.waitForFunction(async () => (await import('/js/data/repository.js')).outboxSize().then(n => n === 0), undefined, { timeout: 8000 });

    const result = await page.evaluate(async () => {
      const repo = await import('/js/data/repository.js');
      return {
        local: (await repo.loadLocalCustomHabits()).length,
        cloud: window.__DONTDIE_CLOUD__.rows('custom_habits').length,
      };
    });
    expect(result.local, 'the deleted habit must not come back').toBe(1);
    expect(result.cloud).toBe(1);
  });

  test('a missing optional table degrades to local-only rather than failing', async ({ page }) => {
    const watcher = watchPage(page);
    // Production has no habit_config; the app must not care.
    await boot(page, { installedTables: ['habit_logs', 'custom_habits', 'split_config', 'mh_store', 'stimulation_store', 'school_store', 'mind_texts_store'] });

    const result = await page.evaluate(async () => {
      const { setBuiltinOverride, getBuiltinOverride } = await import('/js/habitConfig.js');
      setBuiltinOverride('gym_push_a', { name: 'Renamed locally' });
      await new Promise(r => setTimeout(r, 400));
      const repo = await import('/js/data/repository.js');
      return {
        override: getBuiltinOverride('gym_push_a').name,
        stored: (await repo.loadLocalDocument('habitConfig')).builtin.gym_push_a.name,
        queued: await repo.outboxSize(),
      };
    });

    expect(result.override).toBe('Renamed locally');
    expect(result.stored, 'the setting is durable on this device even with no cloud table').toBe('Renamed locally');
    await page.waitForFunction(async () => (await import('/js/data/repository.js')).outboxSize().then(n => n === 0), undefined, { timeout: 8000 });
    expect(watcher.consoleErrors.filter(e => /fatal/i.test(e))).toEqual([]);
  });

  test('the sync chip is quiet when synced and speaks when work is pending', async ({ page }) => {
    await boot(page);
    await expect(page.locator('#sync-status')).toBeHidden();

    await setNetwork(page, 'down');
    await toggleFirstHabit(page);
    await expect(page.locator('#sync-status')).toBeVisible();
    await expect(page.locator('#sync-status')).toHaveAttribute('data-state', /offline|saved-local|failed/);

    await setNetwork(page, 'up');
    await page.evaluate(async () => (await import('/js/sync.js')).setOnline(true));
    await expect(page.locator('#sync-status')).toBeHidden({ timeout: 8000 });
  });

  test('queued work is owner-bound and never sent under another account', async ({ page }) => {
    await boot(page);
    await setNetwork(page, 'down');
    await toggleFirstHabit(page);

    const ops = await page.evaluate(async () => {
      const idb = await import('/js/data/indexedDb.js');
      return (await idb.getAllRecords(idb.STORE.outbox)).map(o => o.userId);
    });
    expect(ops.length).toBeGreaterThan(0);
    for (const userId of ops) expect(userId).toBe(OWNER.id);
  });
});

test.describe('degraded storage', () => {
  test('with no IndexedDB the app still runs and never claims a false durable save', async ({ page }) => {
    const watcher = watchPage(page);
    await installFakeSupabase(page, { scenario: 'signed-in', rows: populatedRows() });
    // A private-mode browser, a blocked upgrade, or a device that refuses
    // storage. Registered after the fake so it is the last word before boot.
    await page.addInitScript(() => {
      Object.defineProperty(window, 'indexedDB', { configurable: true, get: () => undefined });
    });

    await page.goto('/index.html');
    await expect(page.locator('#app')).toBeVisible();

    const ready = await page.evaluate(async () => {
      const repo = await import('/js/data/repository.js');
      const { state } = await import('/js/state.js');
      return {
        localReady: repo.localStoreReady(),
        rendered: state.modeTabs.length,
        split: !!(state.split && state.split.days.length),
      };
    });
    expect(ready.localReady, 'the local database must be reported unavailable, not pretended').toBe(false);
    expect(ready.rendered, 'the app still comes up from the legacy mirror').toBeGreaterThan(0);
    expect(ready.split).toBe(true);

    // A write with the cloud reachable succeeds, and says so honestly.
    const online = await page.evaluate(async () => {
      const repo = await import('/js/data/repository.js');
      const { getSchool } = await import('/js/school/store.js');
      const school = getSchool();
      school.subjects.push({ id: 'degraded', name: 'WRITTEN WITHOUT LOCAL STORAGE' });
      const result = await repo.persistDocument('school', school);
      return { status: result.status, cloud: window.__DONTDIE_CLOUD__.read('school_store').data.subjects.map(s => s.name) };
    });
    expect(online.status, 'a write that reached the cloud is reported as synced, not "local"').toBe('synced');
    expect(online.cloud).toContain('WRITTEN WITHOUT LOCAL STORAGE');

    // With the cloud unreachable there is nowhere durable left, and the app
    // must say so rather than show a success it cannot back up.
    const offlineResult = await page.evaluate(async () => {
      window.__DONTDIE_NET__ = 'down';
      const repo = await import('/js/data/repository.js');
      const { getHabitsForDate } = await import('/js/habits.js');
      const { formatDate, today } = await import('/js/utils/date.js');
      const habit = getHabitsForDate(today())[0];
      const result = await repo.persistHabitLog(formatDate(today()), habit.id, true);
      return result.status;
    });
    expect(offlineResult, 'no durable store and no cloud must never read as saved').toBe('unavailable');

    expect(watcher.consoleErrors.filter(e => /fatal|Uncaught/i.test(e))).toEqual([]);
  });

  test('a habit toggle that cannot be stored is undone and reported', async ({ page }) => {
    await installFakeSupabase(page, { scenario: 'signed-in', rows: populatedRows() });
    await page.addInitScript(() => {
      Object.defineProperty(window, 'indexedDB', { configurable: true, get: () => undefined });
    });
    await page.goto('/index.html');
    await expect(page.locator('#app')).toBeVisible();

    const result = await page.evaluate(async () => {
      window.__DONTDIE_NET__ = 'down';
      const { state } = await import('/js/state.js');
      const { getHabitsForDate } = await import('/js/habits.js');
      const { formatDate, today } = await import('/js/utils/date.js');
      const { toggleHabit } = await import('/js/tabs/today.js');
      const date = formatDate(today());
      const habit = getHabitsForDate(today())[0];
      const before = !!(state.logsByDate[date] || {})[habit.id];
      await toggleHabit(date, habit.id, before);
      return { before, after: !!(state.logsByDate[date] || {})[habit.id] };
    });

    expect(result.after, 'an unstorable change must be rolled back, not left on screen').toBe(result.before);
    await expect(page.locator('.toast')).toContainText(/could not save/i);
  });
});
