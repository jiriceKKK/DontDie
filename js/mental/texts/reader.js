// ============================================================
// MIND · TEXTS READER — the focused, one-text-at-a-time reading view and the
// reflection step that completes a text. Full-screen overlay above everything
// so nothing else competes for attention while reading.
//
// Reading time: simple elapsed time via performance.now(), accumulated in
// cumulative seconds per text. It runs ONLY while the reader is open, on the
// reading step, and the document is visible; it stops for good the moment the
// reflection begins. A 5s checkpoint bounds how much a crash could lose.
// Progress: paragraph index + scroll ratio, so reopening lands in the right
// place across desktop/mobile layout changes.
// ============================================================

import { showToast } from '../../ui/toast.js';
import {
  getTextById, addReadingSeconds, setProgress, enterReflection,
  saveReflectionDraft, completeText, saveMindTexts,
} from './store.js';
import { buildReaderBody, attachHighlightInteraction } from './highlights.js';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const LENGTH_LABEL = { short: 'short read', medium: 'medium read', long: 'long read' };
const SCALE_ANCHORS = { 1: 'not at all', 5: 'moderate', 10: 'extremely' };
const DIFFICULTY = [['too_easy', 'Too easy'], ['right', 'Right'], ['too_difficult', 'Too difficult']];
const LENGTH_FIT = [['too_short', 'Too short'], ['right', 'Right'], ['too_long', 'Too long']];
const MORE = [['yes', 'Yes'], ['maybe', 'Maybe'], ['no', 'No']];

let R = null;           // { textId, step, teardown, scrollEl, bodyEl, onClose }
let onCloseCb = null;
const timer = { running: false, lastCp: 0, interval: null };

// ---- timer ----------------------------------------------------------------

function startTimer() {
  if (timer.running || !R || R.step !== 'reading') return;
  if (document.hidden) return;
  timer.running = true;
  timer.lastCp = performance.now();
  timer.interval = setInterval(checkpoint, 5000);
}
function checkpoint() {
  if (!timer.running || !R) return;
  const now = performance.now();
  const delta = (now - timer.lastCp) / 1000;
  timer.lastCp = now;
  if (delta > 0 && delta < 3600) addReadingSeconds(R.textId, delta);
  updateTimeLabel();
}
function pauseTimer() {
  if (!timer.running) return;
  checkpoint();                 // flush the partial interval
  timer.running = false;
  if (timer.interval) { clearInterval(timer.interval); timer.interval = null; }
}

function updateTimeLabel() {
  if (!R) return;
  const el = document.getElementById('reader-time');
  const t = getTextById(R.textId);
  if (el && t) el.textContent = fmtDuration(t.readingSeconds);
}

function fmtDuration(sec) {
  sec = Math.round(sec || 0);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

// ---- lifecycle listeners --------------------------------------------------

function onVisibility() {
  if (!R) return;
  if (document.hidden) pauseTimer();
  else if (R.step === 'reading') startTimer();
}
function onPageHide() { pauseTimer(); if (R) { saveProgress(); saveMindTexts(); } }
function onNavigate() { if (R) closeReader(); }

function bindGlobal() {
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
  document.addEventListener('app:navigate', onNavigate);
}
function unbindGlobal() {
  document.removeEventListener('visibilitychange', onVisibility);
  window.removeEventListener('pagehide', onPageHide);
  document.removeEventListener('app:navigate', onNavigate);
}

// ---- progress -------------------------------------------------------------

let _lastProgSave = 0;
function currentProgress() {
  const el = R && R.scrollEl;
  if (!el) return { paragraphIndex: 0, scrollRatio: 0 };
  const cTop = el.getBoundingClientRect().top;
  let idx = 0;
  el.querySelectorAll('.rd-para').forEach((p, i) => { if (p.getBoundingClientRect().top - cTop <= 8) idx = i; });
  const denom = Math.max(1, el.scrollHeight - el.clientHeight);
  return { paragraphIndex: idx, scrollRatio: Math.min(1, Math.max(0, el.scrollTop / denom)) };
}
function saveProgress() {
  if (!R) return;
  const pr = currentProgress();
  setProgress(R.textId, pr.paragraphIndex, pr.scrollRatio);
}
function onScroll() {
  if (!R || !R.scrollEl) return;
  const el = R.scrollEl;
  const denom = Math.max(1, el.scrollHeight - el.clientHeight);
  const bar = document.getElementById('reader-bar');
  if (bar) bar.style.width = `${Math.min(100, Math.max(0, (el.scrollTop / denom) * 100))}%`;
  const now = Date.now();
  if (now - _lastProgSave > 500) { _lastProgSave = now; saveProgress(); }
}

// ---- open / render --------------------------------------------------------

export function openReader(text, onClose) {
  if (!text) return;
  onCloseCb = onClose || null;
  // Tear down any previous instance cleanly.
  if (R) dismiss();

  const overlay = document.createElement('div');
  overlay.id = 'mind-reader';
  overlay.className = 'reader-overlay';
  document.body.appendChild(overlay);
  R = { textId: text.id, step: null, teardown: null, scrollEl: null, bodyEl: null, overlay };

  bindGlobal();
  if (text.status === 'reflection') renderReflection();
  else renderReading();

  requestAnimationFrame(() => overlay.classList.add('open'));
}

function renderReading() {
  const t = getTextById(R.textId);
  if (!t) { dismiss(); return; }
  R.step = 'reading';
  if (R.teardown) { R.teardown(); R.teardown = null; }

  R.overlay.innerHTML = `
    <div class="reader-top">
      <button class="reader-close" id="reader-close" aria-label="Close reader">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      <div class="reader-progress"><div class="reader-bar" id="reader-bar"></div></div>
      <div class="reader-time" id="reader-time">${fmtDuration(t.readingSeconds)}</div>
    </div>
    <div class="reader-scroll" id="reader-scroll">
      <article class="reader-article">
        <div class="reader-kicker">${esc(t.topic)} · ${LENGTH_LABEL[t.lengthClass] || 'read'} · ${t.wordCount} words</div>
        <h1 class="reader-title">${esc(t.title)}</h1>
        <div class="reader-body" id="reader-body"></div>
        <div class="reader-hlhint">Tap a word to highlight it · press &amp; hold a sentence for the whole line</div>
      </article>
    </div>
    <div class="reader-foot">
      <button class="btn btn-primary reader-reflect" id="reader-reflect">Reflect &amp; complete</button>
    </div>`;

  R.scrollEl = document.getElementById('reader-scroll');
  R.bodyEl = document.getElementById('reader-body');
  buildReaderBody(R.bodyEl, t);
  R.teardown = attachHighlightInteraction(R.bodyEl, t, () => {});

  document.getElementById('reader-close').addEventListener('click', closeReader);
  document.getElementById('reader-reflect').addEventListener('click', beginReflection);
  R.scrollEl.addEventListener('scroll', onScroll, { passive: true });

  // Restore reading position after layout settles.
  requestAnimationFrame(() => {
    const paras = R.bodyEl.querySelectorAll('.rd-para');
    const pi = t.progress.paragraphIndex;
    if (pi > 0 && paras[pi]) {
      R.scrollEl.scrollTop += paras[pi].getBoundingClientRect().top - R.scrollEl.getBoundingClientRect().top;
    } else if (t.progress.scrollRatio > 0) {
      R.scrollEl.scrollTop = t.progress.scrollRatio * Math.max(1, R.scrollEl.scrollHeight - R.scrollEl.clientHeight);
    }
    onScroll();
  });

  startTimer();
}

function beginReflection() {
  pauseTimer();          // reading time stops permanently for this session
  saveProgress();
  enterReflection(R.textId);
  if (reduceMotion()) { renderReflection(); return; }
  // brief cross-fade
  R.overlay.classList.add('to-reflection');
  setTimeout(() => { R.overlay.classList.remove('to-reflection'); renderReflection(); }, 180);
}

function renderReflection() {
  const t = getTextById(R.textId);
  if (!t) { dismiss(); return; }
  R.step = 'reflection';
  if (R.teardown) { R.teardown(); R.teardown = null; }
  R.scrollEl = null;

  const d = t.reflectionDraft || (t.reflection ? { ...t.reflection } : {});

  const scale = (key, label) => `
    <div class="rf-block">
      <div class="rf-q">${label}</div>
      <div class="rf-scale" data-scale="${key}">
        ${Array.from({ length: 10 }, (_, i) => i + 1).map(n =>
          `<button type="button" class="rf-dot ${d[key] === n ? 'active' : ''}" data-val="${n}">${n}</button>`).join('')}
      </div>
      <div class="rf-anchors"><span>1 — ${SCALE_ANCHORS[1]}</span><span>5 — ${SCALE_ANCHORS[5]}</span><span>10 — ${SCALE_ANCHORS[10]}</span></div>
    </div>`;

  const choice = (key, label, opts) => `
    <div class="rf-block">
      <div class="rf-q">${label}</div>
      <div class="rf-choice" data-choice="${key}">
        ${opts.map(([v, l]) => `<button type="button" class="rf-opt ${d[key] === v ? 'active' : ''}" data-val="${v}">${l}</button>`).join('')}
      </div>
    </div>`;

  R.overlay.innerHTML = `
    <div class="reader-top reader-top--reflect">
      <button class="reader-close" id="reader-close" aria-label="Close reflection">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      <div class="reader-reflect-title">Reflection</div>
      <div style="width:22px"></div>
    </div>
    <div class="reader-scroll rf-scroll" id="reader-scroll">
      <div class="rf-intro">
        <div class="rf-intro-title">${esc(t.title)}</div>
        <div class="rf-intro-sub">${esc(t.topic)} · ${t.wordCount} words · ${fmtDuration(t.readingSeconds)} reading</div>
      </div>
      ${scale('engagement', 'How engaging was this text?')}
      ${scale('learning', 'How much did you learn?')}
      ${scale('relevance', 'How useful or relevant was it to you?')}
      ${choice('difficulty', 'How was the difficulty?', DIFFICULTY)}
      ${choice('length_fit', 'How did the length feel?', LENGTH_FIT)}
      ${choice('more_like_this', 'Would you like more texts like this?', MORE)}
      <div class="rf-block">
        <div class="rf-q">Anything worth noting? <span class="rf-optional">optional</span></div>
        <input class="form-input" id="rf-note" type="text" maxlength="280" placeholder="one line, optional" value="${esc(d.note || '')}">
      </div>
      <div class="rf-err" id="rf-err" hidden></div>
      <button class="btn btn-primary rf-submit" id="rf-submit">Submit &amp; complete</button>
      <div class="rf-footnote">Submitting marks this text complete and counts its words toward your total.</div>
    </div>`;

  R.scrollEl = document.getElementById('reader-scroll');

  const draft = { ...d };
  const persist = () => saveReflectionDraft(R.textId, draft);

  R.overlay.querySelectorAll('.rf-scale').forEach(row => {
    const key = row.dataset.scale;
    row.querySelectorAll('.rf-dot').forEach(b => b.addEventListener('click', () => {
      draft[key] = Number(b.dataset.val);
      row.querySelectorAll('.rf-dot').forEach(x => x.classList.toggle('active', x === b));
      persist();
    }));
  });
  R.overlay.querySelectorAll('.rf-choice').forEach(row => {
    const key = row.dataset.choice;
    row.querySelectorAll('.rf-opt').forEach(b => b.addEventListener('click', () => {
      draft[key] = b.dataset.val;
      row.querySelectorAll('.rf-opt').forEach(x => x.classList.toggle('active', x === b));
      persist();
    }));
  });
  const noteEl = document.getElementById('rf-note');
  noteEl.addEventListener('input', () => { draft.note = noteEl.value; persist(); });

  document.getElementById('reader-close').addEventListener('click', closeReader);
  document.getElementById('rf-submit').addEventListener('click', () => submitReflection(draft));
}

function submitReflection(draft) {
  const missing = [];
  if (!(draft.engagement >= 1 && draft.engagement <= 10)) missing.push('engagement');
  if (!(draft.learning >= 1 && draft.learning <= 10)) missing.push('learning');
  if (!(draft.relevance >= 1 && draft.relevance <= 10)) missing.push('relevance');
  if (!draft.difficulty) missing.push('difficulty');
  if (!draft.length_fit) missing.push('length');
  if (!draft.more_like_this) missing.push('more-like-this');
  if (missing.length) {
    const err = document.getElementById('rf-err');
    if (err) { err.hidden = false; err.textContent = `Please answer: ${missing.join(', ')}.`; }
    let firstUnanswered = null;
    try { firstUnanswered = R.overlay.querySelector('.rf-scale:not(:has(.active)), .rf-choice:not(:has(.active))'); } catch {}
    if (firstUnanswered && firstUnanswered.scrollIntoView) firstUnanswered.scrollIntoView({ block: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' });
    return;
  }
  const reflection = {
    engagement: draft.engagement, learning: draft.learning, relevance: draft.relevance,
    difficulty: draft.difficulty, length_fit: draft.length_fit, more_like_this: draft.more_like_this,
    note: (draft.note || '').trim(),
  };
  pauseTimer();
  completeText(R.textId, reflection);
  const cb = onCloseCb;               // capture before dismiss() clears it
  const el = R.overlay;
  if (!reduceMotion()) el.classList.add('completing');
  showToast('Text completed · nicely done', 'success');
  const done = () => { dismiss(); if (cb) cb(); };
  if (reduceMotion()) done();
  else setTimeout(done, 260);
}

// ---- close / dismiss ------------------------------------------------------

export function closeReader() {
  if (!R) return;
  pauseTimer();
  if (R.step === 'reading') saveProgress();
  saveMindTexts();       // flush progress / draft / time to cloud
  const cb = onCloseCb;
  dismiss();
  if (cb) cb();
}

// Remove the overlay + all listeners WITHOUT changing any status (used after a
// completion, and internally before re-opening).
function dismiss() {
  pauseTimer();
  unbindGlobal();
  if (R) {
    if (R.teardown) { try { R.teardown(); } catch {} }
    if (R.scrollEl) R.scrollEl.removeEventListener('scroll', onScroll);
    if (R.overlay && R.overlay.parentNode) R.overlay.parentNode.removeChild(R.overlay);
  }
  R = null;
  onCloseCb = null;
}

export function isReaderOpen() { return !!R; }
