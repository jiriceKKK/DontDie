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

// Visible fallback so a single broken page never blanks the whole app.
function errorCard(label, err) {
  const msg = String((err && err.message) || err || 'Unknown error').replace(/</g, '&lt;');
  return `<div style="margin:16px;padding:16px;border:1px solid #f87171;border-radius:12px;background:#1a1a1e;">
    <div style="color:#f87171;font-weight:600;margin-bottom:6px;">⚠ ${label} failed to render</div>
    <div style="font-size:12px;color:#8888a0;font-family:monospace;white-space:pre-wrap;">${msg}</div>
  </div>`;
}

export function initModes() {
  // Mode switcher button.
  const switcher = document.getElementById('mode-switcher');
  if (switcher) switcher.addEventListener('click', openModeMenu);
  else console.error('[modes] #mode-switcher not found — mode switching disabled');

  // Delegated tab clicks. The nav containers persist across mode rebuilds, so
  // attaching here once (rather than per generated button) never stacks.
  ['nav-top', 'nav-bottom'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', (e) => {
      const btn = e.target.closest('.nav-item[data-tab]');
      if (btn) switchTab(btn.dataset.tab);
    });
  });

  setMode(state.activeModeId || 'physical');
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
  const label = document.getElementById('mode-switcher-label');
  if (label) label.textContent = mode.label;

  buildNav(mode);
  buildPanels(mode);

  // Register this mode's renderers so switchTab/swipe know what to draw.
  registerRenders(Object.fromEntries(mode.tabs.map(t => [t.id, t.render])));

  // Pre-render every panel so swipe neighbours already have content. Each render
  // is isolated: a failing page shows an error card instead of aborting the mode.
  for (const t of mode.tabs) {
    try {
      t.render();
    } catch (err) {
      console.error(`[modes] render failed for "${mode.id}/${t.id}":`, err);
      const panel = document.getElementById(`tab-${t.id}`);
      if (panel) panel.innerHTML = errorCard(t.label, err);
    }
  }

  // Land on the remembered tab for this mode (or its first tab). No animation
  // on a mode change — it's a context switch, not a swipe.
  const remembered = state.modeLastTab[mode.id];
  const target = mode.tabs.some(t => t.id === remembered) ? remembered : mode.tabs[0].id;
  switchTab(target, false);
}

function navButton(tab, position) {
  const icon = `<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${tab.icon}</svg>`;
  return position === 'bottom'
    ? `<button class="nav-item" data-tab="${tab.id}">${icon}<span>${tab.label}</span></button>`
    : `<button class="nav-item" data-tab="${tab.id}">${icon}${tab.label}</button>`;
}

function buildNav(mode) {
  const top = document.getElementById('nav-top');
  const bottom = document.getElementById('nav-bottom');
  if (top) top.innerHTML = mode.tabs.map(t => navButton(t, 'top')).join('');
  else console.error('[modes] #nav-top not found');
  if (bottom) bottom.innerHTML = mode.tabs.map(t => navButton(t, 'bottom')).join('');
  else console.error('[modes] #nav-bottom not found');
}

function buildPanels(mode) {
  const slider = document.getElementById('tab-slider');
  if (!slider) { console.error('[modes] #tab-slider not found — cannot build panels'); return; }
  slider.innerHTML = mode.tabs.map(t =>
    `<div class="tab-panel" id="tab-${t.id}" data-tab="${t.id}"></div>`).join('');
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
  document.querySelectorAll('.mode-menu-item').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.mode;
    closeModal();
    if (id !== state.activeModeId) setMode(id);
  }));
}
