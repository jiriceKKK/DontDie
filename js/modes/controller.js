// ============================================================
// MODE CONTROLLER — orchestrates the active mode: builds the nav
// buttons + tab panels, themes the app, registers the mode's tab
// renderers, and positions the slider. The rest of the app stays
// mode-agnostic (navigation reads state.modeTabs).
// ============================================================

import { state } from '../state.js';
import { MODES, getMode } from './registry.js';
import { registerRenders, switchTab } from '../navigation.js';
import { openModal, closeModal } from '../ui/modal.js';
import { goTo } from './go.js';
import { showToast } from '../ui/toast.js';

// Visible fallback so a single broken page never blanks the whole app.
function errorCard(label, err) {
  const msg = String((err && err.message) || err || 'Unknown error').replace(/</g, '&lt;');
  return `<div style="margin:16px;padding:16px;border:1px solid #f87171;border-radius:12px;background:#1a1a1e;">
    <div style="color:#f87171;font-weight:600;margin-bottom:6px;">⚠ ${label} failed to render</div>
    <div style="font-size:12px;color:#8888a0;font-family:monospace;white-space:pre-wrap;">${msg}</div>
  </div>`;
}

export function initModes() {
  // The redundant header mode pill (#mode-switcher) was removed in Phase 2.
  // #mode-fab — the translucent control above the bottom dock — is now the
  // single mode picker and Home shortcut. Nothing looks for the header pill,
  // so its absence is not an error and leaves no dead listener behind.
  ensureModeFab();

  // Delegated tab clicks. The nav containers persist across mode rebuilds, so
  // attaching here once (rather than per generated button) never stacks.
  ['nav-top', 'nav-bottom'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', (e) => {
      const btn = e.target.closest('.nav-item[data-tab]');
      if (btn) switchTab(btn.dataset.tab);
    });
  });

  // Cross-mode jumps from Home pages (and anywhere) without an import cycle.
  document.addEventListener('app:navigate', (e) => {
    const { mode, tab } = (e && e.detail) || {};
    if (mode && mode !== state.activeModeId) setMode(mode);
    if (tab) switchTab(tab);
  });

  // The reconciler adopted a newer cloud copy: redraw what is on screen.
  document.addEventListener('app:store-adopted', () => {
    if (state.activeTab) switchTab(state.activeTab, false);
  });

  setMode(state.activeModeId || 'home');
}

/** Render one panel in isolation; a failing page shows a card, not a blank mode. */
function renderPanel(mode, tab) {
  if (!tab) return;
  try {
    tab.render();
  } catch (err) {
    console.error(`[modes] render failed for "${mode.id}/${tab.id}":`, err);
    const panel = document.getElementById(`tab-${tab.id}`);
    if (panel) panel.innerHTML = errorCard(tab.label, err);
  }
}

// Build the remaining panels one animation frame apart, and abandon the work
// if the mode changed underneath us.
let _prerenderHandle = 0;
function schedulePrerender(mode, skipTabId) {
  if (_prerenderHandle) { cancelAnimationFrame(_prerenderHandle); _prerenderHandle = 0; }
  const queue = mode.tabs.filter(t => t.id !== skipTabId);
  const step = () => {
    _prerenderHandle = 0;
    if (state.activeModeId !== mode.id) return;
    const tab = queue.shift();
    if (!tab) return;
    // Never re-render the tab the user is actually on. It was already drawn by
    // switchTab, and rebuilding it here would throw away whatever they have
    // since opened, typed or scrolled to.
    if (tab.id !== state.activeTab) renderPanel(mode, tab);
    if (queue.length) _prerenderHandle = requestAnimationFrame(step);
  };
  _prerenderHandle = requestAnimationFrame(step);
}

export function setMode(modeId) {
  // Remember where we were in the mode we're leaving.
  if (state.activeTab) state.modeLastTab[state.activeModeId] = state.activeTab;

  // getMode() already falls back to the first mode (Physical) for an unknown id.
  const mode = getMode(modeId);
  if (!mode || !Array.isArray(mode.tabs) || mode.tabs.length === 0) {
    console.error('[modes] mode has no tabs, cannot activate:', modeId);
    return;
  }
  state.activeModeId = mode.id;
  state.modeTabs = mode.tabs.map(t => t.id);

  document.body.dataset.mode = mode.id;            // drives the accent theme
  const fabLabel = document.getElementById('mode-fab-label');
  if (fabLabel) fabLabel.textContent = mode.label;
  const fab = document.getElementById('mode-fab');
  if (fab) fab.setAttribute('aria-label', `Section: ${mode.label}. Switch section, or hold for Home`);

  buildNav(mode);
  buildPanels(mode);

  // Register this mode's renderers so switchTab/swipe know what to draw.
  registerRenders(Object.fromEntries(mode.tabs.map(t => [t.id, t.render])));

  // Land on the remembered tab for this mode (or its first tab). No animation
  // on a mode change — it's a context switch, not a swipe.
  const remembered = state.modeLastTab[mode.id];
  const target = mode.tabs.some(t => t.id === remembered) ? remembered : mode.tabs[0].id;

  // Only the landing tab is rendered synchronously. Its swipe neighbours are
  // still pre-rendered — so a swipe never arrives at an empty panel — but off
  // the critical path, which is what kept a mode change costing ~30 ms.
  renderPanel(mode, mode.tabs.find(t => t.id === target));
  switchTab(target, false);
  schedulePrerender(mode, target);

  // Subtle fade so a mode switch reads as a context change, not a hard reload.
  // (No sideways swipe — that's reserved for moving between pages in a mode.)
  const main = document.getElementById('main-content');
  if (main) { main.style.animation = 'none'; void main.offsetWidth; main.style.animation = 'mode-fade 0.2s ease'; }
}

function navButton(tab, position) {
  const icon = `<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${tab.icon}</svg>`;
  const shared = `class="nav-item" type="button" role="tab" data-tab="${tab.id}" aria-controls="tab-${tab.id}" aria-selected="false"`;
  return position === 'bottom'
    ? `<button ${shared}>${icon}<span>${tab.label}</span></button>`
    : `<button ${shared}>${icon}${tab.label}</button>`;
}

function buildNav(mode) {
  const top = document.getElementById('nav-top');
  const bottom = document.getElementById('nav-bottom');
  if (top) { top.setAttribute('role', 'tablist'); top.innerHTML = mode.tabs.map(t => navButton(t, 'top')).join(''); }
  else console.error('[modes] #nav-top not found');
  if (bottom) { bottom.setAttribute('role', 'tablist'); bottom.innerHTML = mode.tabs.map(t => navButton(t, 'bottom')).join(''); }
  else console.error('[modes] #nav-bottom not found');
}

function buildPanels(mode) {
  const slider = document.getElementById('tab-slider');
  if (!slider) { console.error('[modes] #tab-slider not found — cannot build panels'); return; }
  slider.innerHTML = mode.tabs.map(t =>
    `<div class="tab-panel" id="tab-${t.id}" data-tab="${t.id}" role="tabpanel" tabindex="0"></div>`).join('');
}

// ---- mode switcher tap/hold ------------------------------------------------
// Tap → open the picker. Hold (~520ms) or double-click → jump to Home/Today.
// The hold is cancelled by movement/scroll, and the click that follows a hold
// is suppressed so it never also opens the picker.
let _holdTimer = null, _suppressClick = false, _startX = 0, _startY = 0;

function goHomeFromSwitcher() {
  _holdTimer = null;
  _suppressClick = true;
  if (state.activeModeId === 'home' && state.activeTab === 'today') { showToast('Home', 'default'); return; }
  goTo('home', 'today');
  showToast('Home', 'default');
}

function wireSwitcher(el) {
  const cancel = () => { if (_holdTimer) { clearTimeout(_holdTimer); _holdTimer = null; } };
  el.addEventListener('pointerdown', (e) => {
    _startX = e.clientX; _startY = e.clientY;
    cancel();
    _holdTimer = setTimeout(goHomeFromSwitcher, 520);
  });
  el.addEventListener('pointermove', (e) => {
    if (_holdTimer && (Math.abs(e.clientX - _startX) > 10 || Math.abs(e.clientY - _startY) > 10)) cancel();
  });
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointerleave', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('click', (e) => {
    if (_suppressClick) { _suppressClick = false; e.preventDefault(); e.stopPropagation(); return; }
    openModeMenu();
  });
  // Keyboard parity with tap/hold: Enter or Space opens the picker, and
  // Shift+Enter is the accessible equivalent of holding for Home.
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); goTo('home', 'today'); return; }
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); openModeMenu(); }
  });
  el.addEventListener('dblclick', (e) => { e.preventDefault(); _suppressClick = true; goTo('home', 'today'); });
}

function ensureModeFab() {
  if (document.getElementById('mode-fab')) return;
  const fab = document.createElement('button');
  fab.id = 'mode-fab';
  fab.className = 'mode-fab';
  fab.type = 'button';
  fab.setAttribute('aria-haspopup', 'menu');
  fab.setAttribute('aria-expanded', 'false');
  fab.setAttribute('aria-label', `Section: ${getMode(state.activeModeId).label}. Switch section, or hold for Home`);
  fab.innerHTML = `<span class="mode-fab-dot" aria-hidden="true"></span><span class="mode-fab-label" id="mode-fab-label">${getMode(state.activeModeId).label}</span>`;
  document.body.appendChild(fab);
  wireSwitcher(fab);
  if (!localStorage.getItem('seen_fab_hint')) {
    try { localStorage.setItem('seen_fab_hint', '1'); } catch {}
    setTimeout(() => showToast('Tip: hold the section pill to jump Home', 'default'), 1800);
  }
}

function openModeMenu() {
  const html = `
    <div class="mode-menu">
      ${MODES.map(m => `
        <button class="mode-menu-item ${m.id === state.activeModeId ? 'active' : ''}" data-mode="${m.id}">
          <span class="mode-dot" data-mode-dot="${m.id}"></span>
          <span class="mode-menu-label">${m.label}</span>
          ${m.id === state.activeModeId ? '<span class="mode-menu-check">✓</span>' : ''}
        </button>`).join('')}
    </div>`;
  openModal(html, 'Switch mode');
  const fab = document.getElementById('mode-fab');
  if (fab) fab.setAttribute('aria-expanded', 'true');
  const collapse = () => { if (fab) fab.setAttribute('aria-expanded', 'false'); };
  const overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.addEventListener('click', collapse, { once: true });
  const closeBtn = document.getElementById('modal-close-btn');
  if (closeBtn) closeBtn.addEventListener('click', collapse, { once: true });
  document.querySelectorAll('.mode-menu-item').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.mode;
    collapse();
    closeModal();
    if (id !== state.activeModeId) setMode(id);
  }));
}
