// Two devices, one document. The contract is simple and absolute: when the
// cloud has moved on, NEITHER copy is thrown away, the owner is told, and both
// versions stay downloadable until they choose.
import { test, expect } from '@playwright/test';
import { installFakeSupabase, populatedRows, settleSync } from './fixtures/seed.js';

async function boot(page) {
  await installFakeSupabase(page, { scenario: 'signed-in', rows: populatedRows() });
  await page.goto('/index.html');
  await expect(page.locator('#app')).toBeVisible();
  await settleSync(page);
}

/**
 * Produce a genuine stale-revision conflict:
 *   1. take the link down and edit the School document on this device;
 *   2. another device writes the same document, bumping the server revision;
 *   3. bring the link back — our compare-and-set is now based on an old revision.
 */
async function createConflict(page) {
  await page.evaluate(() => { window.__DONTDIE_NET__ = 'down'; });

  await page.evaluate(async () => {
    const { getSchool, saveSchool } = await import('/js/school/store.js');
    const school = getSchool();
    school.subjects.push({ id: 'device-only', name: 'WRITTEN ON THIS DEVICE', difficulty: 1 });
    await saveSchool();
  });

  await page.evaluate(() => {
    const current = window.__DONTDIE_CLOUD__.read('school_store');
    const cloud = JSON.parse(JSON.stringify(current.data));
    cloud.subjects = [...(cloud.subjects || []), { id: 'cloud-only', name: 'WRITTEN ON THE OTHER DEVICE', difficulty: 2 }];
    cloud.updatedAt = new Date().toISOString();
    window.__DONTDIE_CLOUD__.write('school_store', cloud);
  });

  await page.evaluate(async () => {
    window.__DONTDIE_NET__ = 'up';
    const { setOnline } = await import('/js/sync.js');
    setOnline(true);
  });

  await page.waitForFunction(async () => {
    const conflicts = await import('/js/data/conflicts.js');
    const { requireUserId } = await import('/js/session.js');
    return (await conflicts.listConflicts(requireUserId())).length > 0;
  }, undefined, { timeout: 10_000 });
}

test.describe('conflict recovery', () => {
  test('a stale revision produces a conflict instead of an overwrite', async ({ page }) => {
    await boot(page);
    await createConflict(page);

    const state = await page.evaluate(async () => {
      const conflicts = await import('/js/data/conflicts.js');
      const { requireUserId } = await import('/js/session.js');
      const [conflict] = await conflicts.listConflicts(requireUserId());
      const cloud = window.__DONTDIE_CLOUD__.read('school_store');
      return {
        storeId: conflict.storeId,
        localNames: conflict.localData.subjects.map(s => s.name),
        remoteNames: conflict.remoteData.subjects.map(s => s.name),
        cloudNames: cloud.data.subjects.map(s => s.name),
        hasLocalTime: !!conflict.localUpdatedAt,
        hasRemoteTime: !!conflict.remoteUpdatedAt,
      };
    });

    expect(state.storeId).toBe('school');
    expect(state.localNames).toContain('WRITTEN ON THIS DEVICE');
    expect(state.remoteNames).toContain('WRITTEN ON THE OTHER DEVICE');
    expect(state.hasLocalTime).toBe(true);
    expect(state.hasRemoteTime).toBe(true);

    // The crucial part: the cloud was NOT overwritten by this device.
    expect(state.cloudNames, 'the other device’s write must survive').toContain('WRITTEN ON THE OTHER DEVICE');
    expect(state.cloudNames, 'and ours must not have silently replaced it').not.toContain('WRITTEN ON THIS DEVICE');
  });

  test('the shell shows it, and the sheet offers both copies', async ({ page }) => {
    await boot(page);
    await createConflict(page);

    const chip = page.locator('#sync-status');
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute('data-state', 'conflict');
    await expect(chip).toContainText(/needs your choice/i);

    await chip.click();
    await expect(page.locator('#modal-wrapper')).toBeVisible();
    await expect(page.locator('.sync-conflict')).toHaveCount(1);
    await expect(page.locator('.sync-conflict-title')).toContainText('School');
    for (const label of ['Download both', 'Use cloud', 'Keep this device']) {
      await expect(page.locator('.sync-conflict-actions button', { hasText: label })).toBeVisible();
    }
  });

  test('“Download both” hands over a file containing each version', async ({ page }) => {
    await boot(page);
    await createConflict(page);

    // Capture the export payload rather than the browser download dialog.
    await page.evaluate(() => {
      window.__DOWNLOADS__ = [];
      const original = Blob;
      window.Blob = function (parts, options) {
        try { window.__DOWNLOADS__.push(String(parts[0])); } catch { /* ignore */ }
        return new original(parts, options);
      };
    });

    await page.locator('#sync-status').click();
    await page.locator('.sync-conflict-actions button', { hasText: 'Download both' }).click();

    const payload = await page.evaluate(() => window.__DOWNLOADS__[0]);
    const parsed = JSON.parse(payload);
    expect(parsed.thisDevice.data.subjects.map(s => s.name)).toContain('WRITTEN ON THIS DEVICE');
    expect(parsed.cloud.data.subjects.map(s => s.name)).toContain('WRITTEN ON THE OTHER DEVICE');
    expect(parsed.store).toBe('school');
  });

  test('“Keep this device” re-bases and wins, and the conflict clears', async ({ page }) => {
    await boot(page);
    await createConflict(page);

    await page.locator('#sync-status').click();
    await page.locator('.sync-conflict-actions button', { hasText: 'Keep this device' }).click();

    await page.waitForFunction(async () => {
      const conflicts = await import('/js/data/conflicts.js');
      const { requireUserId } = await import('/js/session.js');
      const repo = await import('/js/data/repository.js');
      return (await conflicts.listConflicts(requireUserId())).length === 0
        && (await repo.outboxSize()) === 0;
    }, undefined, { timeout: 20_000 });

    const cloud = await page.evaluate(() => {
      const row = window.__DONTDIE_CLOUD__.read('school_store');
      return { names: row.data.subjects.map(s => s.name), revision: row.revision };
    });
    expect(cloud.names).toContain('WRITTEN ON THIS DEVICE');
    expect(cloud.revision).toBeGreaterThan(1);
    await expect(page.locator('#sync-status')).toBeHidden({ timeout: 15_000 });
  });

  test('“Use cloud” adopts the remote copy and drops the queued write', async ({ page }) => {
    await boot(page);
    await createConflict(page);

    await page.locator('#sync-status').click();

    // The sheet reloads the page a beat after applying the choice. Mark this
    // document so the reload can be waited for positively — waitForLoadState
    // would otherwise resolve against the page that is about to be replaced,
    // and the next evaluate would race the navigation.
    await page.evaluate(() => { window.__BEFORE_RELOAD__ = true; });
    await page.locator('.sync-conflict-actions button', { hasText: 'Use cloud' }).click();
    await page.waitForFunction(() => !window.__BEFORE_RELOAD__, undefined, { timeout: 10_000 });

    await expect(page.locator('#app')).toBeVisible();
    await settleSync(page);

    // The reconciler is asynchronous: retry until the adopted document is
    // readable rather than snapshotting between two of its steps.
    const result = await page.evaluate(async () => {
      const repo = await import('/js/data/repository.js');
      const conflicts = await import('/js/data/conflicts.js');
      const { requireUserId } = await import('/js/session.js');
      let document_ = null;
      for (let attempt = 0; attempt < 40 && !document_; attempt++) {
        document_ = await repo.loadLocalDocument('school');
        if (!document_) await new Promise(r => setTimeout(r, 100));
      }
      if (!document_) return { error: 'the adopted document never became readable' };
      return {
        names: document_.subjects.map(s => s.name),
        conflicts: (await conflicts.listConflicts(requireUserId())).length,
        queued: await repo.outboxSize(),
        cloudNames: window.__DONTDIE_CLOUD__.read('school_store').data.subjects.map(s => s.name),
      };
    });
    expect(result.error).toBeUndefined();

    expect(result.names).toContain('WRITTEN ON THE OTHER DEVICE');
    expect(result.names, 'the discarded local edit must not linger').not.toContain('WRITTEN ON THIS DEVICE');
    expect(result.conflicts).toBe(0);
    expect(result.queued).toBe(0);
    expect(result.cloudNames).toContain('WRITTEN ON THE OTHER DEVICE');
  });

  test('while a conflict is unresolved the queued write is parked, not retried blindly', async ({ page }) => {
    await boot(page);
    await createConflict(page);

    const parked = await page.evaluate(async () => {
      const idb = await import('/js/data/indexedDb.js');
      const ops = await idb.getAllRecords(idb.STORE.outbox);
      const school = ops.filter(o => o.kind === 'document' && o.entity === 'school');
      return { count: school.length, blocked: school.every(o => !!o.blockedBy) };
    });
    expect(parked.count).toBe(1);
    expect(parked.blocked, 'the write waits for a decision instead of hammering the server').toBe(true);

    const before = await page.evaluate(() => window.__DONTDIE_CLOUD__.read('school_store').revision);
    await page.evaluate(async () => (await import('/js/data/reconcile.js')).flush());
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => window.__DONTDIE_CLOUD__.read('school_store').revision);
    expect(after, 'a parked operation must not touch the cloud').toBe(before);
  });
});

test.describe('first sync after a legacy migration', () => {
  test('a migrated localStorage document never silently overwrites a different cloud copy', async ({ page }) => {
    // The cloud already holds the owner's School data. This device is arriving
    // with an older localStorage copy that has never been synced from here.
    await installFakeSupabase(page, { scenario: 'signed-in', rows: populatedRows() });
    await page.addInitScript(() => {
      localStorage.setItem('dontdie_school_v1', JSON.stringify({
        version: 1, updatedAt: '2020-01-01T00:00:00.000Z',
        subjects: [{ id: 'legacy', name: 'STALE LOCAL COPY' }],
        tests: [], sessions: [], results: [], settings: {},
      }));
    });
    await page.goto('/index.html');
    await expect(page.locator('#app')).toBeVisible();

    await page.waitForFunction(async () => {
      const conflicts = await import('/js/data/conflicts.js');
      const { requireUserId } = await import('/js/session.js');
      return (await conflicts.listConflicts(requireUserId())).length > 0;
    }, undefined, { timeout: 10_000 });

    const result = await page.evaluate(async () => {
      const conflicts = await import('/js/data/conflicts.js');
      const { requireUserId } = await import('/js/session.js');
      // Re-read here rather than trusting the poll above: the reconciler is
      // asynchronous, and a snapshot taken between two of its steps is not
      // evidence of anything.
      let list = [];
      for (let attempt = 0; attempt < 40 && list.length === 0; attempt++) {
        list = await conflicts.listConflicts(requireUserId());
        if (list.length === 0) await new Promise(r => setTimeout(r, 100));
      }
      const [conflict] = list;
      if (!conflict) return { error: 'no conflict was recorded' };
      return {
        storeId: conflict.storeId,
        local: conflict.localData.subjects.map(s => s.name),
        remote: conflict.remoteData.subjects.map(s => s.name),
        cloud: window.__DONTDIE_CLOUD__.read('school_store').data.subjects.map(s => s.name),
      };
    });
    expect(result.error).toBeUndefined();

    expect(result.storeId).toBe('school');
    expect(result.local).toContain('STALE LOCAL COPY');
    expect(result.remote).toContain('Maths');
    expect(result.cloud, 'the cloud copy must be untouched until the owner chooses')
      .not.toContain('STALE LOCAL COPY');
    await expect(page.locator('#sync-status')).toHaveAttribute('data-state', 'conflict');
  });
});
