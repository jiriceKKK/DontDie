// ============================================================
// MIND · TEXTS HIGHLIGHTS — renders text into tappable word tokens, wires the
// tap-word / hold-sentence interaction, and hosts the Highlights reel viewer.
//
// Rendering is done with DOM APIs + textContent (never innerHTML for imported
// bodies), so imported content can never inject markup. Highlight state is
// stored as stable {paragraph, sentence, word} coordinates in the store; this
// module only reflects that state onto the rendered spans.
// ============================================================

import { MONTH_NAMES } from '../../constants.js';
import {
  toggleWordHighlight, toggleSentenceHighlight, allHighlightsFlat,
} from './store.js';
import { tokenizeText, flattenSentences } from './parser.js';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function shortDate(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || isNaN(d)) return '';
  return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
}

// ---- reader body rendering ------------------------------------------------
// Builds <p> → word <span> structure with stable data-p/data-s/data-w coords.

export function buildReaderBody(container, text) {
  container.textContent = '';
  const toks = tokenizeText(text.paragraphs);
  const frag = document.createDocumentFragment();
  toks.forEach((para, p) => {
    const pEl = document.createElement('p');
    pEl.className = 'rd-para';
    pEl.dataset.p = String(p);
    para.sentences.forEach((sent, s) => {
      sent.words.forEach((word, w) => {
        const wEl = document.createElement('span');
        wEl.className = 'rd-w';
        wEl.dataset.p = String(p);
        wEl.dataset.s = String(s);
        wEl.dataset.w = String(w);
        wEl.textContent = word;
        pEl.appendChild(wEl);
        pEl.appendChild(document.createTextNode(' '));
      });
    });
    frag.appendChild(pEl);
  });
  container.appendChild(frag);
  applyHighlightClasses(container, text);
}

// Diff stored highlights onto the rendered spans (add/remove .hl only where it
// actually changed, so unchanged highlights don't flash and only new ones pop).
export function applyHighlightClasses(container, text) {
  const want = new Set();
  for (const h of (text.highlights || [])) {
    for (let w = h.word_start; w <= h.word_end; w++) want.add(`${h.paragraph_index}:${h.sentence_index}:${w}`);
  }
  container.querySelectorAll('.rd-w').forEach(el => {
    const key = `${el.dataset.p}:${el.dataset.s}:${el.dataset.w}`;
    const on = want.has(key);
    const has = el.classList.contains('hl');
    if (on && !has) {
      el.classList.add('hl');
      if (!reduceMotion()) { el.classList.add('hl-pop'); setTimeout(() => el.classList.remove('hl-pop'), 320); }
    } else if (!on && has) {
      el.classList.remove('hl');
    }
  });
}

// ---- interaction ----------------------------------------------------------
// Tap a word → toggle word. Hold (~460ms) or double-click → toggle sentence.
// Movement beyond a small threshold cancels the action so scrolling never
// leaves an accidental highlight. Returns a teardown function.

export function attachHighlightInteraction(container, text, onChange) {
  let press = null;
  let clickTimer = null;

  const spansFor = (p, s) => [...container.querySelectorAll(`.rd-w[data-p="${p}"][data-s="${s}"]`)];

  function doWord(p, s, w) {
    const el = container.querySelector(`.rd-w[data-p="${p}"][data-s="${s}"][data-w="${w}"]`);
    toggleWordHighlight(text.id, p, s, w, el ? el.textContent : '');
    applyHighlightClasses(container, text);
    if (onChange) onChange();
  }
  function doSentence(p, s) {
    const spans = spansFor(p, s);
    if (!spans.length) return;
    const quote = spans.map(x => x.textContent).join(' ');
    toggleSentenceHighlight(text.id, p, s, quote, spans.length - 1);
    applyHighlightClasses(container, text);
    if (onChange) onChange();
  }

  function onDown(e) {
    const wEl = e.target.closest('.rd-w');
    if (!wEl) return;
    press = {
      p: +wEl.dataset.p, s: +wEl.dataset.s, w: +wEl.dataset.w,
      x: e.clientX, y: e.clientY, moved: false, longFired: false,
      type: e.pointerType || 'touch',
    };
    press.timer = setTimeout(() => {
      if (!press || press.moved) return;
      press.longFired = true;
      doSentence(press.p, press.s);
      if (navigator.vibrate) { try { navigator.vibrate(12); } catch {} }
    }, 460);
  }
  function onMove(e) {
    if (!press) return;
    if (Math.abs(e.clientX - press.x) > 10 || Math.abs(e.clientY - press.y) > 10) {
      press.moved = true;
      clearTimeout(press.timer);
    }
  }
  function onUp() {
    if (!press) return;
    clearTimeout(press.timer);
    const pr = press; press = null;
    if (pr.moved || pr.longFired) return;
    if (pr.type === 'mouse') {
      // disambiguate single vs double click on desktop
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => doWord(pr.p, pr.s, pr.w), 210);
    } else {
      doWord(pr.p, pr.s, pr.w);
    }
  }
  function onCancel() { if (press) { clearTimeout(press.timer); press = null; } }
  function onDbl(e) {
    const wEl = e.target.closest('.rd-w');
    if (!wEl) return;
    e.preventDefault();
    clearTimeout(clickTimer);
    doSentence(+wEl.dataset.p, +wEl.dataset.s);
  }

  container.addEventListener('pointerdown', onDown);
  container.addEventListener('pointermove', onMove);
  container.addEventListener('pointerup', onUp);
  container.addEventListener('pointercancel', onCancel);
  container.addEventListener('pointerleave', onCancel);
  container.addEventListener('dblclick', onDbl);

  return function teardown() {
    clearTimeout(clickTimer);
    if (press) clearTimeout(press.timer);
    container.removeEventListener('pointerdown', onDown);
    container.removeEventListener('pointermove', onMove);
    container.removeEventListener('pointerup', onUp);
    container.removeEventListener('pointercancel', onCancel);
    container.removeEventListener('pointerleave', onCancel);
    container.removeEventListener('dblclick', onDbl);
  };
}

// ---- Highlights viewer (vertical reel) ------------------------------------

let _viewer = null;

export function openHighlightsViewer() {
  closeHighlightsViewer();
  const items = allHighlightsFlat();

  const overlay = document.createElement('div');
  overlay.id = 'mind-hlv';
  overlay.className = 'hlv-overlay';

  const header = `
    <div class="hlv-header">
      <div class="hlv-title">Highlights${items.length ? ` · ${items.length}` : ''}</div>
      <button class="hlv-close" id="hlv-close" aria-label="Close highlights">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`;

  const body = items.length
    ? `<div class="hlv-scroll">${items.map(cardHtml).join('')}<div class="hlv-end">You've reached the end · scroll up for more</div></div>`
    : `<div class="hlv-empty">
         <div class="hlv-empty-mark">“ ”</div>
         <div class="hlv-empty-title">No highlights yet</div>
         <div class="hlv-empty-sub">While reading, tap a word or press-and-hold a sentence to save it here.</div>
       </div>`;

  overlay.innerHTML = header + body;
  document.body.appendChild(overlay);
  _viewer = overlay;
  document.getElementById('hlv-close').addEventListener('click', closeHighlightsViewer);
  requestAnimationFrame(() => overlay.classList.add('open'));
}

export function closeHighlightsViewer() {
  if (_viewer && _viewer.parentNode) _viewer.parentNode.removeChild(_viewer);
  _viewer = null;
}

// One reel card: 2–3 sentences of context above, the highlight centred, 2–3
// below, with the surrounding text fading toward the top and bottom.
function cardHtml({ highlight: h, text }) {
  const flat = flattenSentences(text.paragraphs);
  let idx = flat.findIndex(f => f.p === h.paragraph_index && f.s === h.sentence_index);
  if (idx === -1) idx = 0;
  const before = flat.slice(Math.max(0, idx - 3), idx).map(f => f.text);
  const center = flat[idx] || { text: h.quote, words: [] };
  const after = flat.slice(idx + 1, idx + 4).map(f => f.text);

  let centerHtml;
  if (h.type === 'sentence') {
    centerHtml = `<mark class="hlv-mark">${esc(center.text)}</mark>`;
  } else {
    const words = center.words && center.words.length ? center.words : String(center.text).split(/\s+/);
    centerHtml = words.map((w, i) => (i >= h.word_start && i <= h.word_end)
      ? `<mark class="hlv-mark">${esc(w)}</mark>` : esc(w)).join(' ');
  }

  const status = text.status === 'completed'
    ? (shortDate(text.completedAt) || 'completed')
    : 'in progress';
  const meta = [esc(text.topic), status, esc(text.title)].filter(Boolean).join(' · ');

  return `
    <section class="hlv-card">
      <div class="hlv-quote">
        ${before.length ? `<div class="hlv-before">${esc(before.join(' '))}</div>` : ''}
        <div class="hlv-center">${centerHtml}</div>
        ${after.length ? `<div class="hlv-after">${esc(after.join(' '))}</div>` : ''}
      </div>
      <div class="hlv-meta">${meta}</div>
    </section>`;
}
