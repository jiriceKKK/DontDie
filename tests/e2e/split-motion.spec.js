// Training Split accordion — the owner-reported "needs a double tap" defect.
//
// PRE-FIX EVIDENCE (recorded before the change, mobile 390x844):
//   before-click       h=0    inline=""      open=false
//   sync-after-click   h=115  inline=115px   open=true      <-- already open
//   +2 frames / +60 / +140ms                 h=115 throughout
//   +440ms             h=115  inline=""
// The class was toggled BEFORE the start height was measured, so with the open
// resting style of `height:auto` the measurement returned the fully-open
// layout. Start and end were identical, no transition ran, `transitionend`
// never fired, and the 360 ms fallback merely stripped the inline height. A
// second activation inside that window still found the stale inline pixel
// height, which is the only reason the accordion ever appeared to animate —
// hence "it needs a double tap".
//
// Every test below activates a collapsed day EXACTLY ONCE.
import { test, expect } from '@playwright/test';
import { bootSignedIn, populatedRows, goTo, watchPage } from './fixtures/seed.js';

const MOBILE = 390;

async function openSplit(page) {
  await goTo(page, 'physical', 'split');
  await expect(page.locator('#split-content .split-day-card').first()).toBeVisible();
}

/** Sample the body height across a single activation. */
async function sampleActivation(page, index, { viaKeyboard = false } = {}) {
  return page.evaluate(async ({ i, keyboard }) => {
    const cards = [...document.querySelectorAll('#split-content .split-day-card')];
    const collapsed = cards.filter(c => !c.classList.contains('open'));
    const card = collapsed[i];
    if (!card) return { error: 'no collapsed card at index ' + i, collapsed: collapsed.length };
    const body = card.querySelector('.split-day-body');
    const header = card.querySelector('.split-day-header');
    const h = () => body.getBoundingClientRect().height;

    const samples = [];
    samples.push({ at: 'before', h: h() });

    if (keyboard) { header.focus(); header.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); header.click(); }
    else header.click();

    // Sample through the transition rather than only at its ends.
    for (const delay of [16, 40, 80, 140, 240]) {
      await new Promise(r => setTimeout(r, delay === 16 ? 16 : delay - samples[samples.length - 1].delayTotal || delay));
      samples.push({ at: 't' + delay, h: h(), delayTotal: delay });
    }
    await new Promise(r => setTimeout(r, 400));
    const final = {
      h: h(),
      inline: body.style.height,
      open: card.classList.contains('open'),
      expanded: header.getAttribute('aria-expanded'),
      controls: header.getAttribute('aria-controls'),
      bodyId: body.id,
      tag: header.tagName,
      overflow: body.style.overflow,
      willChange: body.style.willChange,
    };
    return { samples, final };
  }, { i: index, keyboard: viaKeyboard });
}

test.describe('Training Split accordion', () => {
  test.skip(({ viewport }) => viewport.width !== MOBILE, 'the reported defect is the mobile one');

  test('every collapsed day opens on ONE activation, with a visible transition', async ({ page }) => {
    const watcher = watchPage(page);
    await bootSignedIn(page, { rows: populatedRows() });
    await openSplit(page);

    const collapsedCount = await page.locator('#split-content .split-day-card:not(.open)').count();
    expect(collapsedCount, 'the fixture must actually have collapsed days').toBeGreaterThan(0);

    for (let i = 0; i < collapsedCount; i++) {
      // Always index 0: each opened card leaves the list, so this walks them all.
      const report = await sampleActivation(page, 0);
      expect(report.error, `day ${i}`).toBeUndefined();

      const heights = report.samples.map(s => s.h);
      expect(heights[0], `day ${i} must start collapsed`).toBeLessThan(1);
      expect(report.final.h, `day ${i} must end open`).toBeGreaterThan(20);
      expect(report.final.open, `day ${i} must carry .open`).toBe(true);
      expect(report.final.expanded, `day ${i} aria-expanded`).toBe('true');

      // The point of the fix: at least one intermediate sample is strictly
      // between the collapsed and open heights. Pre-fix this was impossible,
      // because every sample equalled the final height.
      const mid = heights.slice(1, -1);
      expect(mid.some(h => h > 0.5 && h < report.final.h - 0.5),
        `day ${i} showed no intermediate height — it snapped open instead of animating. Samples: ${JSON.stringify(heights)}`).toBe(true);

      // And it hands control back to CSS so later content growth is not clipped.
      expect(report.final.inline, `day ${i} must not keep an inline height`).toBe('');
      expect(report.final.overflow).toBe('');
      expect(report.final.willChange).toBe('');
    }

    expect(watcher.consoleErrors, 'no console errors during the interaction').toEqual([]);
  });

  test('the header is a real button wired to its body', async ({ page }) => {
    await bootSignedIn(page, { rows: populatedRows() });
    await openSplit(page);
    const report = await sampleActivation(page, 0);
    expect(report.final.tag).toBe('BUTTON');
    expect(report.final.controls).toBe(report.final.bodyId);
    expect(report.final.bodyId).toBeTruthy();
  });

  test('one activation closes it again — a double tap is never required', async ({ page }) => {
    await bootSignedIn(page, { rows: populatedRows() });
    await openSplit(page);

    const result = await page.evaluate(async () => {
      const card = [...document.querySelectorAll('#split-content .split-day-card')].find(c => !c.classList.contains('open'));
      const body = card.querySelector('.split-day-body');
      const header = card.querySelector('.split-day-header');
      const h = () => body.getBoundingClientRect().height;

      header.click();
      await new Promise(r => setTimeout(r, 600));
      const openedHeight = h();

      header.click();                                   // one tap to close
      const during = [];
      for (let i = 0; i < 5; i++) { await new Promise(r => setTimeout(r, 40)); during.push(h()); }
      await new Promise(r => setTimeout(r, 400));

      return {
        openedHeight,
        during,
        closedHeight: h(),
        open: card.classList.contains('open'),
        expanded: header.getAttribute('aria-expanded'),
      };
    });

    expect(result.openedHeight).toBeGreaterThan(20);
    expect(result.closedHeight).toBeLessThan(1);
    expect(result.open).toBe(false);
    expect(result.expanded).toBe('false');
    // Closing animates from the open height too, not just from a stale inline one.
    expect(result.during.some(h => h > 0.5 && h < result.openedHeight - 0.5),
      `closing snapped instead of animating: ${JSON.stringify(result.during)}`).toBe(true);
  });

  test('a double click produces exactly two state changes and lands closed', async ({ page }) => {
    await bootSignedIn(page, { rows: populatedRows() });
    await openSplit(page);

    const result = await page.evaluate(async () => {
      const card = [...document.querySelectorAll('#split-content .split-day-card')].find(c => !c.classList.contains('open'));
      const header = card.querySelector('.split-day-header');
      // Sampled synchronously after each click: a MutationObserver batches
      // both class writes into one record and would hide the second toggle.
      const states = [];
      header.click(); states.push(card.classList.contains('open'));
      header.click(); states.push(card.classList.contains('open'));
      await new Promise(r => setTimeout(r, 700));
      states.push(card.classList.contains('open'));
      return { states, open: card.classList.contains('open'), expanded: header.getAttribute('aria-expanded') };
    });

    expect(result.states, 'two clicks are two state changes: open then closed, and it stays closed').toEqual([true, false, false]);
    expect(result.open).toBe(false);
    expect(result.expanded).toBe('false');
  });

  test('rapid open → close → open reverses cleanly and no stale timer wins', async ({ page }) => {
    await bootSignedIn(page, { rows: populatedRows() });
    await openSplit(page);

    const result = await page.evaluate(async () => {
      const card = [...document.querySelectorAll('#split-content .split-day-card')].find(c => !c.classList.contains('open'));
      const body = card.querySelector('.split-day-body');
      const header = card.querySelector('.split-day-header');
      const h = () => body.getBoundingClientRect().height;

      /** Wait until `predicate(height)` holds, or give up and report what we saw. */
      const until = async (predicate, limitMs = 1000) => {
        const deadline = performance.now() + limitMs;
        let value = h();
        while (!predicate(value) && performance.now() < deadline) {
          await new Promise(r => requestAnimationFrame(r));
          value = h();
        }
        return value;
      };

      header.click();                                  // open
      const midOpen = await until(v => v > 0);         // it has started moving
      header.click();                                  // reverse mid-flight
      const midClose = await until(v => v <= midOpen); // it is coming back down
      header.click();                                  // reverse again
      const final = await until(v => v > 20, 1500);
      await new Promise(r => setTimeout(r, 600));      // let the run settle fully

      return {
        midOpen, midClose, final: h(),
        settledFinal: final,
        inline: body.style.height,
        open: card.classList.contains('open'),
        expanded: header.getAttribute('aria-expanded'),
      };
    });

    expect(result.midOpen, 'the first activation must start moving').toBeGreaterThan(0);
    expect(result.midClose, 'the reversal must come back down from where it was').toBeLessThanOrEqual(result.midOpen + 1);
    expect(result.open).toBe(true);
    expect(result.expanded).toBe('true');
    expect(result.final).toBeGreaterThan(20);
    expect(result.inline, 'a stale run must not leave an inline height behind').toBe('');
  });

  test('content that grows after opening is not clipped', async ({ page }) => {
    await bootSignedIn(page, { rows: populatedRows() });
    await openSplit(page);

    const result = await page.evaluate(async () => {
      const card = [...document.querySelectorAll('#split-content .split-day-card')].find(c => !c.classList.contains('open'));
      const body = card.querySelector('.split-day-body');
      card.querySelector('.split-day-header').click();
      await new Promise(r => setTimeout(r, 700));
      const before = body.getBoundingClientRect().height;

      const inner = body.querySelector('.split-day-body-inner');
      const extra = document.createElement('div');
      extra.style.height = '120px';
      inner.appendChild(extra);
      await new Promise(r => setTimeout(r, 60));

      return { before, after: body.getBoundingClientRect().height, inline: body.style.height };
    });

    expect(result.inline).toBe('');
    expect(result.after).toBeGreaterThan(result.before + 100);
  });

  test('keyboard activation behaves identically to a tap', async ({ page }) => {
    await bootSignedIn(page, { rows: populatedRows() });
    await openSplit(page);

    const result = await page.evaluate(async () => {
      const card = [...document.querySelectorAll('#split-content .split-day-card')].find(c => !c.classList.contains('open'));
      const body = card.querySelector('.split-day-body');
      const header = card.querySelector('.split-day-header');
      header.focus();
      const focused = document.activeElement === header;
      return { focused, tag: header.tagName, startH: body.getBoundingClientRect().height };
    });
    expect(result.focused, 'the header must be focusable').toBe(true);
    expect(result.tag).toBe('BUTTON');
    expect(result.startH).toBeLessThan(1);

    // Enter on a focused <button> is a real activation, not a synthesised click.
    await page.keyboard.press('Enter');
    await page.waitForTimeout(700);

    const after = await page.evaluate(() => {
      const card = document.querySelector('#split-content .split-day-card.open');
      const header = card.querySelector('.split-day-header');
      return {
        h: card.querySelector('.split-day-body').getBoundingClientRect().height,
        expanded: header.getAttribute('aria-expanded'),
      };
    });
    expect(after.h).toBeGreaterThan(20);
    expect(after.expanded).toBe('true');
  });

  test('reduced motion opens immediately and leaves no inline styles', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await bootSignedIn(page, { rows: populatedRows() });
    await openSplit(page);

    const result = await page.evaluate(async () => {
      const card = [...document.querySelectorAll('#split-content .split-day-card')].find(c => !c.classList.contains('open'));
      const body = card.querySelector('.split-day-body');
      const header = card.querySelector('.split-day-header');
      header.click();
      await new Promise(r => requestAnimationFrame(r));
      return {
        immediateHeight: body.getBoundingClientRect().height,
        inline: body.style.height,
        open: card.classList.contains('open'),
        expanded: header.getAttribute('aria-expanded'),
      };
    });

    expect(result.open).toBe(true);
    expect(result.expanded).toBe('true');
    expect(result.immediateHeight, 'reduced motion must be instant, not animated').toBeGreaterThan(20);
    expect(result.inline).toBe('');
    await context.close();
  });

  test('today / edit mode keep their default-open behaviour', async ({ page }) => {
    await bootSignedIn(page, { rows: populatedRows() });
    await openSplit(page);

    const before = await page.evaluate(() => ({
      today: !!document.querySelector('#split-content .split-day-card.today-card.open'),
      todayExists: !!document.querySelector('#split-content .split-day-card.today-card'),
    }));
    if (before.todayExists) expect(before.today, "today's card opens by default").toBe(true);

    // Edit mode opens every card and keeps aria truthful.
    const edited = await page.evaluate(async () => {
      const { state } = await import('/js/state.js');
      const { renderSplit } = await import('/js/tabs/split.js');
      state.splitEdit = true;
      renderSplit();
      await new Promise(r => setTimeout(r, 100));
      const cards = [...document.querySelectorAll('#split-content .split-day-card')];
      return {
        total: cards.length,
        open: cards.filter(c => c.classList.contains('open')).length,
        ariaTrue: [...document.querySelectorAll('#split-content .split-day-header')]
          .filter(h => h.getAttribute('aria-expanded') === 'true').length,
      };
    });
    expect(edited.open).toBe(edited.total);
    expect(edited.ariaTrue).toBe(edited.total);
  });
});
