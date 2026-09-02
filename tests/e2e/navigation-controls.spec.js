// The redundant header mode pill is gone; the translucent lower control is the
// single mode picker. What must be proven is that nothing was LOST with it —
// no capability, no keyboard path, no accessible name — and that the control
// that remains never sits on top of the last thing the user needs to reach.
import { test, expect } from '@playwright/test';
import { bootSignedIn, populatedRows, watchPage, goTo } from './fixtures/seed.js';

const MODES = ['home', 'physical', 'mental', 'stimulation', 'school'];

test.describe('mode controls', () => {
  test('the header pill is gone from the markup, the controller and the stylesheet', async ({ page }) => {
    const watcher = watchPage(page);
    await bootSignedIn(page, { rows: populatedRows() });

    await expect(page.locator('#mode-switcher')).toHaveCount(0);
    await expect(page.locator('#mode-switcher-label')).toHaveCount(0);
    await expect(page.locator('.mode-switcher')).toHaveCount(0);

    // No missing-element error, and no dead listener left looking for it.
    expect(watcher.consoleErrors.filter(e => /mode-switcher/i.test(e)),
      'the controller must not complain about an element it no longer wants').toEqual([]);

    const sources = await page.evaluate(async () => {
      const [html, controller, css] = await Promise.all([
        fetch('/index.html').then(r => r.text()),
        fetch('/js/modes/controller.js').then(r => r.text()),
        fetch('/style.css').then(r => r.text()),
      ]);
      return {
        htmlHasId: /id="mode-switcher"/.test(html),
        controllerLooksUp: /getElementById\(['"]mode-switcher/.test(controller),
        cssHasRule: /^\.mode-switcher[\s,{:]/m.test(css),
      };
    });
    expect(sources.htmlHasId).toBe(false);
    expect(sources.controllerLooksUp).toBe(false);
    expect(sources.cssHasRule, 'the dead rules must go with the element').toBe(false);
  });

  test('the lower control is the mode picker, with a truthful accessible name', async ({ page }) => {
    await bootSignedIn(page, { rows: populatedRows() });
    const fab = page.locator('#mode-fab');

    await expect(fab).toBeVisible();
    await expect(fab).toHaveAttribute('aria-haspopup', 'menu');
    await expect(fab).toHaveAttribute('aria-expanded', 'false');
    await expect(fab).toHaveAttribute('aria-label', /Section: .+Switch section/);
    await expect(page.locator('#mode-fab-label')).not.toBeEmpty();

    await fab.click();
    await expect(page.locator('#modal-wrapper')).toBeVisible();
    await expect(fab).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.mode-menu-item')).toHaveCount(MODES.length);

    await page.locator('.mode-menu-item[data-mode="school"]').click();
    await expect(page.locator('#modal-wrapper')).toBeHidden();
    await expect(fab).toHaveAttribute('aria-expanded', 'false');

    const mode = await page.evaluate(async () => (await import('/js/state.js')).state.activeModeId);
    expect(mode).toBe('school');
    await expect(page.locator('#mode-fab-label')).toContainText('School');
    await expect(fab).toHaveAttribute('aria-label', /Section: School/);
  });

  test('the current-mode label tracks every mode', async ({ page }) => {
    await bootSignedIn(page, { rows: populatedRows() });
    for (const mode of MODES) {
      await goTo(page, mode);
      const shown = await page.evaluate(async () => {
        const { getMode } = await import('/js/modes/registry.js');
        const { state } = await import('/js/state.js');
        return {
          label: document.getElementById('mode-fab-label').textContent.trim(),
          expected: getMode(state.activeModeId).label,
        };
      });
      expect(shown.label, `label for ${mode}`).toBe(shown.expected);
    }
  });

  test('the lower control is reachable and operable by keyboard', async ({ page }) => {
    await bootSignedIn(page, { rows: populatedRows() });
    const fab = page.locator('#mode-fab');

    await fab.focus();
    expect(await page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('mode-fab');

    await page.keyboard.press('Enter');
    await expect(page.locator('#modal-wrapper')).toBeVisible();
    await expect(fab).toHaveAttribute('aria-expanded', 'true');
    await page.locator('#modal-close-btn').click();
    await expect(fab).toHaveAttribute('aria-expanded', 'false');

    // Shift+Enter is the keyboard equivalent of holding for Home.
    await goTo(page, 'school');
    await fab.focus();
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(200);
    const home = await page.evaluate(async () => {
      const { state } = await import('/js/state.js');
      return { mode: state.activeModeId, tab: state.activeTab };
    });
    expect(home).toEqual({ mode: 'home', tab: 'today' });
  });

  test('desktop tab navigation remains available', async ({ page, viewport }) => {
    test.skip(viewport.width < 768, 'desktop only');
    await bootSignedIn(page, { rows: populatedRows() });

    await expect(page.locator('#nav-top')).toBeVisible();
    const tabs = page.locator('#nav-top .nav-item');
    await expect(tabs.first()).toBeVisible();
    const count = await tabs.count();
    expect(count).toBeGreaterThan(1);

    await tabs.nth(1).click();
    const active = await page.evaluate(async () => (await import('/js/state.js')).state.activeTabIndex);
    expect(active).toBe(1);
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#nav-top')).toHaveAttribute('role', 'tablist');
  });

  test.describe('it never covers content', () => {
    for (const size of [
      { width: 320, height: 700, name: 'small portrait' },
      { width: 390, height: 844, name: 'reference portrait' },
      { width: 844, height: 390, name: 'landscape' },
    ]) {
      test(`at ${size.width}x${size.height} (${size.name})`, async ({ browser }) => {
        const context = await browser.newContext({ viewport: { width: size.width, height: size.height } });
        const page = await context.newPage();
        await bootSignedIn(page, { rows: populatedRows() });
        await goTo(page, 'physical', 'settings');
        await page.waitForTimeout(200);

        const report = await page.evaluate(() => {
          const fab = document.getElementById('mode-fab');
          const fabBox = fab.getBoundingClientRect();
          const panel = [...document.querySelectorAll('.tab-panel')]
            .find(el => el.offsetParent !== null && el.getBoundingClientRect().height > 0);
          if (!panel) return { error: 'no visible panel' };

          // Scroll to the very bottom: that is where an overlay hurts.
          panel.scrollTop = panel.scrollHeight;

          const overlaps = el => {
            const box = el.getBoundingClientRect();
            if (box.width === 0 || box.height === 0) return false;
            return !(box.right < fabBox.left || box.left > fabBox.right
              || box.bottom < fabBox.top || box.top > fabBox.bottom);
          };

          const actionable = [...panel.querySelectorAll('button, a[href], input, select, textarea, [role="button"]')]
            .filter(el => el.offsetParent !== null);
          const covered = actionable.filter(overlaps).map(el => el.id || el.className || el.tagName);

          // Above 768px the bottom dock is hidden and the pill moves to the
          // viewport corner, so the dock relationship only applies when it is shown.
          const dock = document.querySelector('.nav-bottom');
          const dockVisible = !!(dock && dock.offsetParent !== null && dock.getBoundingClientRect().height > 0);
          const dockBox = dockVisible ? dock.getBoundingClientRect() : null;

          return {
            fab: { top: fabBox.top, bottom: fabBox.bottom, left: fabBox.left, right: fabBox.right },
            dockTop: dockBox ? dockBox.top : null,
            dockVisible,
            covered,
            actionableCount: actionable.length,
            viewportHeight: window.innerHeight,
            docScrollWidth: document.documentElement.scrollWidth,
            docClientWidth: document.documentElement.clientWidth,
          };
        });

        expect(report.error).toBeUndefined();
        expect(report.actionableCount, 'the page must actually have controls to cover').toBeGreaterThan(0);
        expect(report.covered, `the lower control covered: ${report.covered.join(', ')}`).toEqual([]);
        if (report.dockVisible) {
          expect(report.fab.bottom, 'it must sit above the bottom dock, not on it')
            .toBeLessThanOrEqual(report.dockTop + 1);
        }
        expect(report.fab.bottom).toBeLessThanOrEqual(report.viewportHeight);
        expect(report.docScrollWidth, 'no horizontal overflow').toBeLessThanOrEqual(report.docClientWidth);
        await context.close();
      });
    }
  });

  test('it stays clear of a field brought up by the virtual keyboard', async ({ page, viewport }) => {
    test.skip(viewport.width >= 768, 'mobile only');
    await bootSignedIn(page, { rows: populatedRows() });
    await goTo(page, 'mental', 'tasks');
    await page.waitForTimeout(200);

    // Emulate the keyboard by shrinking the visual viewport, which is what the
    // layout has to survive.
    await page.setViewportSize({ width: 390, height: 420 });
    await page.waitForTimeout(200);

    const report = await page.evaluate(() => {
      const input = document.querySelector('#tab-tasks input, #tab-tasks textarea');
      if (input) input.focus();
      const fab = document.getElementById('mode-fab').getBoundingClientRect();
      const field = input ? input.getBoundingClientRect() : null;
      return {
        fabTop: fab.top,
        fabBottom: fab.bottom,
        height: window.innerHeight,
        overlapsField: field ? !(field.right < fab.left || field.left > fab.right || field.bottom < fab.top || field.top > fab.bottom) : false,
        hasField: !!input,
      };
    });

    expect(report.fabBottom).toBeLessThanOrEqual(report.height);
    if (report.hasField) expect(report.overlapsField, 'the control must not cover the focused field').toBe(false);
  });

  test('the safe-area inset is part of the layout, not an afterthought', async ({ page, viewport }) => {
    test.skip(viewport.width >= 768, 'the dock and pill are the mobile layout');
    await bootSignedIn(page, { rows: populatedRows() });

    // A real home-indicator inset cannot be emulated here: Chromium exposes no
    // knob for env(safe-area-inset-*), and injecting a stylesheet is refused by
    // the page's own CSP (correctly). So this asserts the rule that produces the
    // behaviour, plus the geometry that holds with a zero inset.
    const css = await page.evaluate(() => fetch('/style.css').then(r => r.text()));
    const fabRule = /\.mode-fab\s*\{[^}]*\}/.exec(css);
    expect(fabRule, 'the lower control must have a rule').not.toBeNull();
    expect(fabRule[0], 'its offset must include the safe-area inset and the dock height')
      .toMatch(/env\(safe-area-inset-bottom[^)]*\)/);
    expect(fabRule[0]).toMatch(/--nav-bottom-height/);

    const panelRule = /\.tab-panel\s*\{[^}]*\}/.exec(css);
    expect(panelRule[0], 'panel padding must reserve the dock and the pill above it')
      .toMatch(/padding-bottom:\s*calc\([^)]*--nav-bottom-height[\s\S]*?safe-area-inset-bottom/);

    const geometry = await page.evaluate(() => {
      const fab = document.getElementById('mode-fab').getBoundingClientRect();
      const dock = document.querySelector('.nav-bottom').getBoundingClientRect();
      return { fabTop: fab.top, fabBottom: fab.bottom, dockTop: dock.top, dockBottom: dock.bottom, height: window.innerHeight };
    });
    expect(geometry.fabBottom).toBeLessThanOrEqual(geometry.dockTop + 1);
    expect(geometry.dockBottom).toBeLessThanOrEqual(geometry.height);
    expect(geometry.fabTop).toBeGreaterThan(0);
  });
});
