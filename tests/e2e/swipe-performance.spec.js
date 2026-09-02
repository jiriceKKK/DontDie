// Horizontal swipe performance — the owner-reported "laggy swiping" defect.
//
// MEASURED BEFORE THE FIX (mobile 390x844, populated panels):
//   * the gesture ran on a DOCUMENT-WIDE non-passive `touchmove` and wrote
//     `transform` once per event: 28 style writes across 28 events, with no
//     coalescing to the frame — on a device whose touch rate exceeds its frame
//     rate that is several layout-affecting writes per frame;
//   * finishing a swipe called switchTab(), which rendered the destination
//     panel SYNCHRONOUSLY in the settle frame (up to 2.8 ms per tab on a fast
//     desktop CPU, far worse throttled), and a mode change rendered all five
//     panels in one go (30 ms for Physical);
//   * one 97 ms long task was observed during mode/tab churn;
//   * `will-change: transform` was pinned on the slider permanently.
//
// The assertions below encode what must now be true instead. They run against
// realistically populated fixture data, because empty panels make any gesture
// look fast for the wrong reason.
import { test, expect } from '@playwright/test';
import { installFakeSupabase, populatedRows, settleSync, goTo } from './fixtures/seed.js';

const MODES = ['home', 'physical', 'mental', 'stimulation', 'school'];

/** Record every listener registration so duplicates cannot hide. */
const LISTENER_SPY = `
  window.__DONTDIE_LISTENERS__ = [];
  const add = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, handler, options) {
    try { window.__DONTDIE_LISTENERS__.push({ target: this, type }); } catch { /* ignore */ }
    return add.call(this, type, handler, options);
  };
`;

async function boot(page, { throttle = 2 } = {}) {
  await page.addInitScript({ content: LISTENER_SPY });
  await installFakeSupabase(page, { scenario: 'signed-in', rows: populatedRows() });

  // CPU throttling makes a regression visible on a desktop runner. It is only
  // available over CDP (Chromium), so it degrades to "unthrottled" elsewhere.
  let client = null;
  try {
    client = await page.context().newCDPSession(page);
    await client.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  } catch { client = null; }

  await page.goto('/index.html');
  await expect(page.locator('#app')).toBeVisible();
  await settleSync(page);
  return client;
}

/** Install the per-gesture instrumentation the assertions read back. */
async function instrument(page) {
  await page.evaluate(() => {
    const slider = document.getElementById('tab-slider');
    const probe = {
      writes: [],           // animation-frame index of each transform write
      frames: 0,
      longTasks: [],
      queriesAtStart: 0,
      queriesDuringMove: 0,
      moving: false,
      renders: 0,
    };
    window.__PROBE__ = probe;

    const tick = () => { probe.frames++; probe.rafId = requestAnimationFrame(tick); };
    probe.rafId = requestAnimationFrame(tick);

    try {
      probe.observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          probe.longTasks.push({ duration: Math.round(entry.duration), start: entry.startTime });
        }
      });
      probe.observer.observe({ entryTypes: ['longtask'] });
    } catch { /* not supported everywhere */ }

    // Count transform writes and the animation frame they landed in.
    //
    // A MutationObserver on the style attribute is used rather than patching
    // the CSSStyleDeclaration accessor: where that accessor lives on the
    // prototype chain is an engine detail, and a probe that silently records
    // nothing is worse than no probe at all. Records are delivered once per
    // attribute mutation, and the frame counter only advances inside a
    // requestAnimationFrame callback — so two writes in the same task land on
    // the same frame index and are correctly seen as two writes in one frame.
    const readTransform = value => {
      const match = /transform:\s*([^;]+)/.exec(value || '');
      return match ? match[1].trim() : '';
    };
    // Movement frames are the ones the requirement is about. The single write
    // that ends a gesture (settle, or the new tab's offset) legitimately lands
    // in the same frame as the last drag write, so the two phases are counted
    // separately instead of pretending that is a coalescing failure.
    probe.moveWindows = [];
    const openWindow = () => { probe.moving = true; probe.moveWindows.push([performance.now(), Infinity]); };
    const closeWindow = () => {
      probe.moving = false;
      const last = probe.moveWindows[probe.moveWindows.length - 1];
      if (last && last[1] === Infinity) last[1] = performance.now();
    };
    slider.addEventListener('pointerdown', openWindow, true);
    slider.addEventListener('pointerup', closeWindow, true);
    slider.addEventListener('pointercancel', closeWindow, true);

    probe.styleObserver = new MutationObserver(records => {
      for (const record of records) {
        const before = readTransform(record.oldValue);
        const after = readTransform(slider.getAttribute('style'));
        if (before === after) continue;         // will-change / transition churn
        probe.writes.push({ frame: probe.frames, moving: probe.moving });
      }
    });
    probe.styleObserver.observe(slider, { attributes: true, attributeFilter: ['style'], attributeOldValue: true });

    // Any query the fake client sees while a finger is down is a query too many.
    const queries = window.__DONTDIE_QUERIES__;
    probe.queriesAtStart = queries.length;
    probe.sampleQueries = () => { probe.queriesDuringMove = queries.length - probe.queriesAtStart; };
  });
}

/** One realistic horizontal drag, sampling the query count mid-gesture. */
async function swipe(page, { from, to, y, steps = 12 }) {
  await page.mouse.move(from, y);
  await page.mouse.down();
  const dx = (to - from) / steps;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from + dx * i, y);
  }
  await page.evaluate(() => window.__PROBE__.sampleQueries());
  await page.mouse.up();
  await page.waitForTimeout(340);   // let the settle transition finish
}

async function readProbe(page) {
  return page.evaluate(() => {
    const probe = window.__PROBE__;
    cancelAnimationFrame(probe.rafId);
    if (probe.observer) probe.observer.disconnect();
    if (probe.styleObserver) { probe.styleObserver.takeRecords(); probe.styleObserver.disconnect(); }
    const perFrame = {};
    const perMoveFrame = {};
    for (const write of probe.writes) {
      perFrame[write.frame] = (perFrame[write.frame] || 0) + 1;
      if (write.moving) perMoveFrame[write.frame] = (perMoveFrame[write.frame] || 0) + 1;
    }
    // A long task counts against the gesture only if it overlaps a window in
    // which a finger was actually down. Attributing the runner's own scheduling
    // — or the app's legitimate settle render — to "swipe lag" would make this
    // assertion noise rather than evidence.
    const overlapsMovement = task => (probe.moveWindows || []).some(([from, to]) =>
      task.start < to && task.start + task.duration > from);

    return {
      totalWrites: probe.writes.length,
      moveWrites: probe.writes.filter(w => w.moving).length,
      longTasksDuringMove: probe.longTasks.filter(overlapsMovement).map(t => t.duration),
      maxWritesInOneFrame: Math.max(0, ...Object.values(perFrame)),
      maxWritesInOneMoveFrame: Math.max(0, ...Object.values(perMoveFrame)),
      frames: probe.frames,
      longTasks: probe.longTasks.map(t => t.duration),
      queriesDuringMove: probe.queriesDuringMove,
      willChange: document.getElementById('tab-slider').style.willChange,
    };
  });
}

// Trace and video are retained for this whole file so the evidence can be
// inspected after the fact rather than re-derived.
test.use({ trace: 'on', video: 'on' });

test.describe('horizontal swipe', () => {
  // Serial, and retried: these are timing assertions. Running them alongside
  // each other on a throttled CPU measures the runner rather than the gesture,
  // and a single scheduling hiccup from a neighbouring worker is not a
  // regression. A real one fails every attempt; the measured numbers are
  // attached to the report either way.
  test.describe.configure({ mode: 'serial', retries: 1 });
  test.skip(({ viewport }) => viewport.width >= 768, 'the gesture is mobile-only by design');

  test('ten consecutive swipes stay compositor-only and never render in a move frame', async ({ page }, testInfo) => {
    const client = await boot(page);
    await goTo(page, 'physical');
    await instrument(page);

    const size = page.viewportSize();
    const y = Math.round(size.height / 2);
    const right = size.width - 40;
    const left = 40;

    const visited = [];
    for (let i = 0; i < 10; i++) {
      const forward = i % 5 !== 4;             // walk right, then come back
      await swipe(page, { from: forward ? right : left, to: forward ? left : right, y });
      visited.push(await page.evaluate(async () => (await import('/js/state.js')).state.activeTab));
    }

    const probe = await readProbe(page);
    const metrics = { viewport: size, visited, ...probe };
    // Attached for the HTML report AND logged, so the numbers survive in plain
    // test output rather than only inside a trace bundle.
    await testInfo.attach('swipe-metrics.json', { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' });
    console.log('SWIPE-METRICS 390x844 ' + JSON.stringify(metrics));

    expect(probe.moveWrites, 'the gesture must actually move the slider').toBeGreaterThan(10);
    expect(probe.maxWritesInOneMoveFrame,
      `transform was written ${probe.maxWritesInOneMoveFrame} times in one movement frame`).toBeLessThanOrEqual(1);
    // Outside movement a frame may legitimately carry the final coalesced drag
    // write, the settle write that follows pointerup, and — when the viewport
    // is being applied — one re-alignment write from the resize handler. Three
    // is the ceiling; anything beyond it means writes stopped being coalesced.
    expect(probe.maxWritesInOneFrame).toBeLessThanOrEqual(3);
    expect(probe.queriesDuringMove,
      'no database query may happen while a finger is down').toBe(0);

    const overBudget = probe.longTasksDuringMove.filter(duration => duration > 50);
    expect(overBudget,
      `long tasks over 50 ms while a finger was down: ${JSON.stringify(probe.longTasksDuringMove)} `
      + `(all long tasks in the run: ${JSON.stringify(probe.longTasks)})`).toEqual([]);

    // The tab really changed, and the compositor hint was released.
    expect(new Set(visited).size, 'the swipes must actually navigate').toBeGreaterThan(1);
    expect(probe.willChange, 'will-change must be cleared after settling').toBe('');

    if (client) await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  });

  test('a small phone viewport behaves the same', async ({ browser }, testInfo) => {
    const context = await browser.newContext({ viewport: { width: 320, height: 700 }, hasTouch: true });
    const page = await context.newPage();
    await boot(page);
    await goTo(page, 'school');
    await instrument(page);

    for (let i = 0; i < 10; i++) {
      const forward = i % 5 !== 4;
      await swipe(page, { from: forward ? 280 : 40, to: forward ? 40 : 280, y: 350 });
    }

    const probe = await readProbe(page);
    await testInfo.attach('swipe-metrics-320x700.json', { body: JSON.stringify(probe, null, 2), contentType: 'application/json' });
    console.log('SWIPE-METRICS 320x700 ' + JSON.stringify(probe));

    expect(probe.maxWritesInOneMoveFrame).toBeLessThanOrEqual(1);
    expect(probe.maxWritesInOneFrame).toBeLessThanOrEqual(3);
    expect(probe.queriesDuringMove).toBe(0);
    expect(probe.longTasksDuringMove.filter(d => d > 50)).toEqual([]);
    await context.close();
  });

  test('repeated mode changes never stack a second gesture listener', async ({ page }) => {
    await boot(page);

    const before = await page.evaluate(() => {
      const slider = document.getElementById('tab-slider');
      return window.__DONTDIE_LISTENERS__.filter(l => l.target === slider).map(l => l.type).sort();
    });

    for (let round = 0; round < 3; round++) {
      for (const mode of MODES) await goTo(page, mode);
    }

    const after = await page.evaluate(() => {
      const slider = document.getElementById('tab-slider');
      const types = window.__DONTDIE_LISTENERS__.filter(l => l.target === slider).map(l => l.type);
      const counts = {};
      for (const type of types) counts[type] = (counts[type] || 0) + 1;
      return counts;
    });

    expect(before.length, 'the slider must be wired at startup').toBeGreaterThan(0);
    for (const [type, count] of Object.entries(after)) {
      expect(count, `${type} was registered ${count} times after 15 mode changes`).toBe(1);
    }
  });

  test('a vertical drag scrolls the page instead of changing tabs', async ({ page }) => {
    await boot(page);
    await goTo(page, 'physical', 'stats');
    await instrument(page);

    const before = await page.evaluate(async () => (await import('/js/state.js')).state.activeTab);
    const size = page.viewportSize();
    await page.mouse.move(size.width / 2, size.height - 120);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(size.width / 2, size.height - 120 - i * 20);
    await page.mouse.up();
    await page.waitForTimeout(300);

    const after = await page.evaluate(async () => (await import('/js/state.js')).state.activeTab);
    expect(after, 'a vertical drag must not switch tabs').toBe(before);

    const probe = await readProbe(page);
    expect(probe.moveWrites, 'a vertical drag must not move the slider at all').toBe(0);
  });

  test('the first and last tab resist instead of running off the end', async ({ page }) => {
    await boot(page);
    await goTo(page, 'physical');

    const size = page.viewportSize();
    const y = Math.round(size.height / 2);

    const first = await page.evaluate(async () => (await import('/js/state.js')).state.activeTabIndex);
    expect(first).toBe(0);

    await instrument(page);
    await swipe(page, { from: 40, to: size.width - 40, y });   // swipe "back" past the start
    const stillFirst = await page.evaluate(async () => (await import('/js/state.js')).state.activeTabIndex);
    expect(stillFirst, 'the first tab has nowhere to go').toBe(0);

    const settled = await page.evaluate(() => document.getElementById('tab-slider').style.transform);
    expect(settled, 'it must settle back to the first panel').toMatch(/translate3d\(-?0(\.\d+)?px/);
  });

  test('a swipe that starts on a button does not also activate it', async ({ page }) => {
    await boot(page);
    await goTo(page, 'physical', 'split');

    const target = await page.evaluate(() => {
      window.__CLICKS__ = 0;
      const header = [...document.querySelectorAll('#split-content .split-day-header')]
        .find(h => h.getAttribute('aria-expanded') === 'false');
      header.addEventListener('click', () => { window.__CLICKS__++; });
      header.dataset.dragProbe = '1';
      const box = header.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    });

    await page.mouse.move(target.x, target.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(target.x - i * 20, target.y);
    await page.mouse.up();
    await page.waitForTimeout(350);

    const result = await page.evaluate(() => {
      const header = document.querySelector('[data-drag-probe="1"]');
      return {
        clicks: window.__CLICKS__,
        expanded: header.getAttribute('aria-expanded'),
        open: header.closest('.split-day-card').classList.contains('open'),
      };
    });
    expect(result.clicks, 'a drag must not deliver a click to the control it started on').toBe(0);
    expect(result.open, 'the card the drag started on must not have opened').toBe(false);
    expect(result.expanded).toBe('false');
  });
});
