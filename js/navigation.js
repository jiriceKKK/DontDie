import { state } from './state.js';

// The ordered tab ids of the ACTIVE mode. The mode controller sets state.modeTabs
// whenever the mode changes; navigation stays mode-agnostic and just reads it.
// (Kept as a helper so a missing/empty value degrades safely to [].)
function tabOrder() { return state.modeTabs || []; }

// Tab render functions registered by the mode controller — navigation never imports
// tabs directly, which prevents circular dependencies (tabs can safely import switchTab).
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
  const newIndex = tabOrder().indexOf(tabName);
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
      slider.style.transform = `translate3d(${-newIndex * getPanelWidth()}px, 0, 0)`;
    }
  } else {
    document.querySelectorAll('.tab-panel').forEach(panel => {
      panel.classList.toggle('active', panel.id === `tab-${tabName}`);
    });
  }

  if (_renders[tabName]) {
    try { _renders[tabName](); }
    catch (err) { console.error(`[nav] render failed for tab "${tabName}":`, err); }
  }
}

export function initSwipe() {
  const slider = document.getElementById('tab-slider');
  if (!slider) return;

  let startX = 0, startY = 0, deltaX = 0;
  let axisLocked = null; // 'h' | 'v' | null
  let startTime = 0, dragging = false, tracking = false;
  // Cache the panel width per-gesture so we never read offsetWidth (a forced
  // synchronous layout) inside touchmove — reading it every frame is the main
  // cause of jittery drags. Refreshed on touchstart and resize only.
  let panelWidth = getPanelWidth();

  // touchstart on slider — passive is fine, we only record state
  slider.addEventListener('touchstart', (e) => {
    if (window.innerWidth >= 768) return;
    if (e.touches.length !== 1) return;
    startX     = e.touches[0].clientX;
    startY     = e.touches[0].clientY;
    deltaX     = 0;
    axisLocked = null;
    dragging   = false;
    tracking   = true;
    startTime  = Date.now();
    panelWidth = getPanelWidth();
    slider.style.transition = 'none';
  }, { passive: true });

  // touchmove on document, NON-passive — this is the iOS fix:
  // once we recognise a horizontal swipe, preventDefault claims the gesture
  // from Safari's scroll engine. Otherwise iOS may hand the gesture to the
  // page's vertical scroller and our touchend never sees the full delta,
  // making the second swipe (and every subsequent one) silently drop.
  document.addEventListener('touchmove', (e) => {
    if (!tracking || window.innerWidth >= 768) return;
    if (e.touches.length !== 1) return;

    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;

    if (axisLocked === null) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        axisLocked = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
      }
      return;
    }
    if (axisLocked !== 'h') return;

    e.preventDefault();   // claim the horizontal gesture from native scroll
    dragging = true;
    deltaX   = dx;

    const idx = state.activeTabIndex;
    let effective = deltaX;
    if ((idx === 0 && deltaX > 0) || (idx === tabOrder().length - 1 && deltaX < 0)) {
      effective = deltaX * 0.25; // rubber-band at edges
    }
    const base = -state.activeTabIndex * panelWidth;
    slider.style.transform = `translate3d(${base + effective}px, 0, 0)`;
  }, { passive: false });

  // touchend / touchcancel on window — covers the case where the finger
  // lifts outside the slider's bounding box (which happens once the slider
  // is translated off-screen).
  function finish() {
    if (!tracking) return;
    tracking = false;
    if (window.innerWidth >= 768) return;
    if (!dragging || axisLocked !== 'h') return;

    const elapsed  = Math.max(1, Date.now() - startTime);
    const velocity = Math.abs(deltaX) / elapsed;
    const shouldAdvance = Math.abs(deltaX) > 60 || velocity > 0.3;
    let newIndex = state.activeTabIndex;
    if (shouldAdvance) {
      if (deltaX < 0 && newIndex < tabOrder().length - 1) newIndex++;
      else if (deltaX > 0 && newIndex > 0)                newIndex--;
    }
    dragging = false;
    deltaX   = 0;

    if (newIndex !== state.activeTabIndex) {
      switchTab(tabOrder()[newIndex]);
    } else {
      slider.style.transition = 'transform 280ms cubic-bezier(0.25, 0.46, 0.45, 0.94)';
      slider.style.transform  = `translate3d(${-state.activeTabIndex * panelWidth}px, 0, 0)`;
    }
  }
  window.addEventListener('touchend',    finish, { passive: true });
  window.addEventListener('touchcancel', finish, { passive: true });

  // Re-align current tab after resize / orientation change so panels don't drift.
  window.addEventListener('resize', () => {
    if (window.innerWidth < 768) {
      panelWidth = getPanelWidth();
      slider.style.transition = 'none';
      slider.style.transform  = `translate3d(${-state.activeTabIndex * panelWidth}px, 0, 0)`;
    }
  });
}
