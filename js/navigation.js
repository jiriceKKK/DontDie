import { state } from './state.js';
import { TAB_ORDER } from './constants.js';

// Tab render functions registered by main.js — navigation never imports tabs directly,
// which prevents circular dependencies (tabs can safely import switchTab from here).
let _renders = {};

export function registerRenders(renders) {
  _renders = renders;
}

// Returns the rendered width of a single tab panel.
// Using the actual DOM element instead of window.innerWidth ensures JS and CSS
// (which sizes panels with 100vw) always agree, even on devices where
// window.innerWidth includes a scrollbar width.
export function getPanelWidth() {
  const slider = document.getElementById('tab-slider');
  if (slider && slider.children[0]) return slider.children[0].offsetWidth;
  return window.innerWidth;
}

export function switchTab(tabName, animate = true) {
  const newIndex = TAB_ORDER.indexOf(tabName);
  if (newIndex === -1) return;

  state.activeTab      = tabName;
  state.activeTabIndex = newIndex;

  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });

  if (window.innerWidth < 768) {
    const slider = document.getElementById('tab-slider');
    if (slider) {
      slider.style.transition = animate
        ? 'transform 280ms cubic-bezier(0.25, 0.46, 0.45, 0.94)'
        : 'none';
      slider.style.transform = `translateX(${-newIndex * getPanelWidth()}px)`;
    }
  } else {
    document.querySelectorAll('.tab-panel').forEach(panel => {
      panel.classList.toggle('active', panel.id === `tab-${tabName}`);
    });
  }

  if (_renders[tabName]) _renders[tabName]();
}

export function initSwipe() {
  const slider = document.getElementById('tab-slider');
  if (!slider) return;

  let startX = 0, startY = 0, deltaX = 0;
  let axisLocked = null; // 'h' | 'v' | null
  let startTime = 0, dragging = false;

  slider.addEventListener('touchstart', (e) => {
    if (window.innerWidth >= 768) return;
    startX    = e.touches[0].clientX;
    startY    = e.touches[0].clientY;
    deltaX    = 0;
    axisLocked = null;
    dragging  = false;
    startTime = Date.now();
    slider.style.transition = 'none';
  }, { passive: true });

  slider.addEventListener('touchmove', (e) => {
    if (window.innerWidth >= 768) return;

    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;

    if (axisLocked === null) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        axisLocked = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
      }
      return;
    }
    if (axisLocked !== 'h') return;

    dragging = true;
    deltaX   = dx;

    const idx = state.activeTabIndex;
    let effective = deltaX;
    if ((idx === 0 && deltaX > 0) || (idx === TAB_ORDER.length - 1 && deltaX < 0)) {
      effective = deltaX * 0.25; // rubber-band at edges
    }

    const base = -state.activeTabIndex * getPanelWidth();
    slider.style.transform = `translateX(${base + effective}px)`;
  }, { passive: true });

  slider.addEventListener('touchend', () => {
    if (window.innerWidth >= 768) return;
    if (!dragging || axisLocked !== 'h') return;

    const elapsed  = Math.max(1, Date.now() - startTime);
    const velocity = Math.abs(deltaX) / elapsed; // px/ms

    const shouldAdvance = Math.abs(deltaX) > 60 || velocity > 0.3;
    let newIndex        = state.activeTabIndex;
    if (shouldAdvance) {
      if (deltaX < 0 && newIndex < TAB_ORDER.length - 1) newIndex++;
      else if (deltaX > 0 && newIndex > 0)               newIndex--;
    }

    dragging = false;
    deltaX   = 0;

    if (newIndex !== state.activeTabIndex) {
      switchTab(TAB_ORDER[newIndex]);
    } else {
      slider.style.transition = 'transform 280ms cubic-bezier(0.25, 0.46, 0.45, 0.94)';
      slider.style.transform  = `translateX(${-state.activeTabIndex * getPanelWidth()}px)`;
    }
  }, { passive: true });

  // Re-align current tab after resize / orientation change so panels don't drift.
  window.addEventListener('resize', () => {
    if (window.innerWidth < 768) {
      slider.style.transition = 'none';
      slider.style.transform  = `translateX(${-state.activeTabIndex * getPanelWidth()}px)`;
    }
  });
}
