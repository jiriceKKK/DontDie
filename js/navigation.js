/* eslint-env browser */
// ============================================================
// TAB NAVIGATION AND THE HORIZONTAL SWIPE GESTURE.
//
// The gesture is deliberately boring in the frames that matter:
//
//   * it is scoped to #tab-slider and uses Pointer Events with pointer
//     capture, instead of a document-wide non-passive touchmove;
//   * `touch-action: pan-y` (see style.css) lets the browser keep vertical
//     scrolling native while handing us the horizontal axis, so no
//     preventDefault is needed in the hot path;
//   * pointermove does arithmetic only. It reads no layout, renders nothing,
//     touches no database and rebuilds no DOM. Geometry is measured once at
//     gesture start;
//   * transform writes are coalesced to at most ONE per animation frame and
//     use translate3d so the compositor owns the movement;
//   * the destination panel is already built, and its refresh render is
//     deferred out of the gesture's settle frame.
//
// Everything else — edge resistance, velocity/distance thresholds, vertical
// cancellation, orientation changes, mouse and keyboard tab navigation — is
// preserved.
// ============================================================

import { state } from './state.js';

const DESKTOP_MIN_WIDTH = 768;
const AXIS_LOCK_PX = 8;
const ADVANCE_DISTANCE_PX = 60;
const ADVANCE_VELOCITY = 0.3;
const EDGE_RESISTANCE = 0.25;
const SLIDE_MS = 280;
const SLIDE_EASING = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';

// The ordered tab ids of the ACTIVE mode. The mode controller sets state.modeTabs
// whenever the mode changes; navigation stays mode-agnostic and just reads it.
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

function isMobileLayout() {
  return window.innerWidth < DESKTOP_MIN_WIDTH;
}

/** Run a tab's renderer, isolated so one broken page cannot break navigation. */
function renderTab(tabName) {
  const render = _renders[tabName];
  if (!render) return;
  try { render(); }
  catch (err) { console.error(`[nav] render failed for tab "${tabName}":`, err); }
}

/**
 * Activate a tab.
 * @param {string} tabName
 * @param {boolean} [animate]
 * @param {{ deferRender?: boolean }} [options]
 *   `deferRender` moves the destination's refresh render out of the current
 *   frame, so finishing a swipe never lands a synchronous render on the frame
 *   that is still animating.
 */
export function switchTab(tabName, animate = true, options = {}) {
  const newIndex = tabOrder().indexOf(tabName);
  if (newIndex === -1) return;

  state.activeTab = tabName;
  state.activeTabIndex = newIndex;

  document.querySelectorAll('.nav-item').forEach(btn => {
    const active = btn.dataset.tab === tabName;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  if (isMobileLayout()) {
    const slider = document.getElementById('tab-slider');
    if (slider) {
      slider.style.transition = animate ? `transform ${SLIDE_MS}ms ${SLIDE_EASING}` : 'none';
      slider.style.transform = `translate3d(${-newIndex * getPanelWidth()}px, 0, 0)`;
    }
  } else {
    document.querySelectorAll('.tab-panel').forEach(panel => {
      panel.classList.toggle('active', panel.id === `tab-${tabName}`);
    });
  }

  if (options.deferRender) {
    // Two frames out: the settle transition owns the next one.
    requestAnimationFrame(() => requestAnimationFrame(() => renderTab(tabName)));
    return;
  }
  renderTab(tabName);
}

// ---- swipe ----------------------------------------------------------------

let _swipeWired = false;

export function initSwipe() {
  const slider = document.getElementById('tab-slider');
  if (!slider) return;
  // The slider element survives mode changes (only its children are rebuilt),
  // so wiring must happen exactly once no matter how often modes switch.
  if (_swipeWired) return;
  _swipeWired = true;

  // Gesture state. Everything needed inside pointermove is captured here at
  // pointerdown, so no frame during the drag has to ask the DOM anything.
  let pointerId = null;
  let startX = 0, startY = 0, deltaX = 0;
  let axis = null;              // 'h' | 'v' | null
  let startTime = 0;
  let dragging = false;
  let panelWidth = 0;
  let baseOffset = 0;
  let lastIndex = 0;
  let suppressClick = false;
  let frame = 0;                // pending rAF id — the write coalescer
  let pendingOffset = 0;

  function writeFrame() {
    frame = 0;
    slider.style.transform = `translate3d(${pendingOffset}px, 0, 0)`;
  }

  /** At most one transform write per animation frame. */
  function scheduleWrite(offset) {
    pendingOffset = offset;
    if (frame) return;
    frame = requestAnimationFrame(writeFrame);
  }

  function cancelFrame() {
    if (!frame) return;
    cancelAnimationFrame(frame);
    frame = 0;
  }

  function releasePointer() {
    if (pointerId === null) return;
    try { slider.releasePointerCapture(pointerId); } catch { /* already released */ }
    pointerId = null;
  }

  function settle(targetIndex) {
    slider.style.transition = `transform ${SLIDE_MS}ms ${SLIDE_EASING}`;
    slider.style.transform = `translate3d(${-targetIndex * panelWidth}px, 0, 0)`;
  }

  /** Temporary compositor hint only — left in place it costs memory forever. */
  function clearWillChange() {
    slider.style.willChange = '';
  }

  function onPointerDown(event) {
    if (!isMobileLayout()) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (pointerId !== null) return;              // ignore a second finger
    if (event.isPrimary === false) return;

    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    deltaX = 0;
    axis = null;
    dragging = false;
    startTime = event.timeStamp || performance.now();

    // The ONLY layout read of the whole gesture.
    panelWidth = getPanelWidth();
    lastIndex = tabOrder().length - 1;
    baseOffset = -state.activeTabIndex * panelWidth;

    slider.style.transition = 'none';
    slider.style.willChange = 'transform';
  }

  function onPointerMove(event) {
    if (pointerId !== event.pointerId) return;

    const dx = event.clientX - startX;
    const dy = event.clientY - startY;

    if (axis === null) {
      if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
      axis = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
      if (axis === 'v') {
        // Vertical: hand the gesture back to the page immediately.
        finish(event, true);
        return;
      }
      // Capture so the rest of the drag reaches us even once the slider has
      // travelled out from under the finger.
      try { slider.setPointerCapture(pointerId); } catch { /* not capturable */ }
      dragging = true;
    }
    if (axis !== 'h') return;

    deltaX = dx;
    const index = state.activeTabIndex;
    const atStart = index === 0 && dx > 0;
    const atEnd = index === lastIndex && dx < 0;
    const effective = (atStart || atEnd) ? dx * EDGE_RESISTANCE : dx;
    scheduleWrite(baseOffset + effective);
  }

  function finish(event, cancelled = false) {
    if (pointerId === null) return;
    if (event && event.pointerId !== undefined && event.pointerId !== pointerId) return;

    cancelFrame();
    releasePointer();

    const wasDragging = dragging;
    const travelled = deltaX;
    dragging = false;
    axis = null;
    deltaX = 0;

    if (!wasDragging) { clearWillChange(); return; }
    if (!isMobileLayout()) { clearWillChange(); return; }

    // A real drag happened: swallow the click it would otherwise produce.
    if (Math.abs(travelled) > AXIS_LOCK_PX) suppressClick = true;

    const elapsed = Math.max(1, (event && event.timeStamp ? event.timeStamp : performance.now()) - startTime);
    const velocity = Math.abs(travelled) / elapsed;
    const shouldAdvance = !cancelled && (Math.abs(travelled) > ADVANCE_DISTANCE_PX || velocity > ADVANCE_VELOCITY);

    let targetIndex = state.activeTabIndex;
    if (shouldAdvance) {
      if (travelled < 0 && targetIndex < lastIndex) targetIndex++;
      else if (travelled > 0 && targetIndex > 0) targetIndex--;
    }

    if (targetIndex !== state.activeTabIndex) {
      // The destination panel already exists and holds content, so the visual
      // move happens now and its refresh render is deferred past the animation.
      switchTab(tabOrder()[targetIndex], true, { deferRender: true });
    } else {
      settle(state.activeTabIndex);
    }

    setTimeout(clearWillChange, SLIDE_MS + 40);
  }

  slider.addEventListener('pointerdown', onPointerDown, { passive: true });
  slider.addEventListener('pointermove', onPointerMove, { passive: true });
  slider.addEventListener('pointerup', finish, { passive: true });
  slider.addEventListener('pointercancel', event => finish(event, true), { passive: true });

  // A drag that ends on a button must not also activate it.
  slider.addEventListener('click', event => {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
  }, true);

  // Re-align after resize / orientation change so panels don't drift.
  let resizeFrame = 0;
  window.addEventListener('resize', () => {
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      if (!isMobileLayout()) return;
      panelWidth = getPanelWidth();
      slider.style.transition = 'none';
      slider.style.transform = `translate3d(${-state.activeTabIndex * panelWidth}px, 0, 0)`;
    });
  });
}
