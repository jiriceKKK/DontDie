// ============================================================
// QUICK LOG — a fast stimulation logger as a bottom sheet, reachable from the
// Today command center. It only calls the existing stimulation store (dayBlocks
// / addEntry / removeEntry / setEntryDuration / getActivities). No calculation,
// data-model, or persistence change — it's a faster front door to the same Log.
// ============================================================

import { state } from '../state.js';
import { formatDate, today, addDays } from '../utils/date.js';
import { openModal, closeModal } from '../ui/modal.js';
import { CATEGORIES } from '../stimulation/defaultActivities.js';
import {
  dayBlocks, blockEntries, addEntry, setEntryDuration, removeEntry,
  getActivities, findActivity,
} from '../stimulation/store.js';
import { currentBlockIndex } from './data.js';

const DURATIONS = [5, 15, 30, 60];
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Most-used activities over the last 7 days (id → count), top N. Read-only.
function recentActivityIds(n = 6) {
  const counts = {};
  const logs = (state.stimulation && state.stimulation.logs) || {};
  for (let i = 0; i < 7; i++) {
    const date = formatDate(addDays(today(), -i));
    const day = logs[date];
    if (!day || !day.blocks) continue;
    for (const idx of Object.keys(day.blocks)) {
      for (const e of (day.blocks[idx] || [])) counts[e.activityId] = (counts[e.activityId] || 0) + 1;
    }
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([id]) => id)
    .filter(id => findActivity(id)).slice(0, n);
}

// Open the quick-log sheet for the current time block. onChange() (optional) is
// called after every edit so the caller can refresh its own summary.
export function openQuickLog(onChange) {
  const dateStr = formatDate(today());
  let blockIdx = currentBlockIndex();
  let search = '';

  openModal('<div id="ql-body"></div>', 'Log stimulation');

  function draw() {
    const blocks = dayBlocks();
    if (blockIdx < 0 || blockIdx >= blocks.length) blockIdx = 0;
    const block = blocks[blockIdx];
    const entries = blockEntries(dateStr, block.index);
    const activities = getActivities();

    const q = search.trim().toLowerCase();
    let picker;
    if (q) {
      const matches = activities.filter(a => a.name.toLowerCase().includes(q)).slice(0, 24);
      picker = matches.length
        ? `<div class="ql-chip-row">${matches.map(chip).join('')}</div>`
        : `<div class="mh-empty" style="text-align:left;padding:6px 0;">No activities match “${esc(search)}”.</div>`;
    } else {
      const recent = recentActivityIds();
      const recentRow = recent.length
        ? `<div class="ql-section-label">Recent</div><div class="ql-chip-row">${recent.map(id => chip(findActivity(id))).join('')}</div>`
        : '';
      const groups = CATEGORIES.map(cat => ({ cat, items: activities.filter(a => a.category === cat.id) })).filter(g => g.items.length);
      picker = recentRow + groups.map(g => `
        <div class="ql-section-label" style="color:${g.cat.color}">${g.cat.label}</div>
        <div class="ql-chip-row">${g.items.map(chip).join('')}</div>`).join('');
    }

    const body = document.getElementById('ql-body');
    if (!body) return;
    body.innerHTML = `
      <div class="ql-stepper">
        <button class="stim-step-btn" id="ql-prev" ${blockIdx === 0 ? 'disabled' : ''} aria-label="Earlier block">‹</button>
        <div class="ql-stepper-mid">
          <div class="ql-block">${block.label}</div>
          <div class="ql-block-sub">Block ${blockIdx + 1} / ${blocks.length}${blockIdx === currentBlockIndex() ? ' · now' : ''}</div>
        </div>
        <button class="stim-step-btn" id="ql-next" ${blockIdx === blocks.length - 1 ? 'disabled' : ''} aria-label="Later block">›</button>
      </div>

      <div class="ql-entries">
        ${entries.length === 0
          ? `<div class="mh-empty" style="text-align:left;padding:4px 0;">Nothing logged here yet.</div>`
          : entries.map((e, i) => entryRow(e, i)).join('')}
      </div>

      <input class="form-input ql-search" id="ql-search" type="text" placeholder="Search activities…" value="${esc(search)}" autocomplete="off">
      <div class="ql-picker">${picker}</div>

      <div class="modal-actions" style="margin-top:14px;">
        <button type="button" class="btn btn-primary" id="ql-done" style="width:100%;">Done</button>
      </div>`;

    // wiring
    const prev = body.querySelector('#ql-prev'); if (prev) prev.addEventListener('click', () => { if (blockIdx > 0) { blockIdx--; draw(); } });
    const next = body.querySelector('#ql-next'); if (next) next.addEventListener('click', () => { if (blockIdx < blocks.length - 1) { blockIdx++; draw(); } });
    const s = body.querySelector('#ql-search');
    if (s) s.addEventListener('input', () => { search = s.value; const at = s.selectionStart; draw(); const ns = document.getElementById('ql-search'); if (ns) { ns.focus(); try { ns.setSelectionRange(at, at); } catch {} } });
    body.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => {
      const ex = findActivity(b.dataset.add);
      addEntry(dateStr, block.index, b.dataset.add, ex ? ex.defaultDurationMinutes : 15);
      search = ''; draw(); onChange && onChange();
    }));
    body.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => {
      removeEntry(dateStr, block.index, parseInt(b.dataset.rm)); draw(); onChange && onChange();
    }));
    body.querySelectorAll('[data-dur]').forEach(b => b.addEventListener('click', () => {
      setEntryDuration(dateStr, block.index, parseInt(b.dataset.ei), parseInt(b.dataset.dur)); draw(); onChange && onChange();
    }));
    const done = body.querySelector('#ql-done'); if (done) done.addEventListener('click', closeModal);
  }

  function chip(a) {
    if (!a) return '';
    const cat = CATEGORIES.find(c => c.id === a.category);
    const color = cat ? cat.color : 'var(--accent)';
    return `<button class="ql-chip" data-add="${a.id}" style="border-color:${color}33">${esc(a.name)}</button>`;
  }
  function entryRow(e, i) {
    const ex = findActivity(e.activityId);
    return `
      <div class="ql-entry">
        <span class="ql-entry-name">${esc(ex ? ex.name : '(removed)')}</span>
        <div class="ql-dur-row">
          ${DURATIONS.map(d => `<button class="stim-dur ${num(e.durationMinutes) === d ? 'active' : ''}" data-ei="${i}" data-dur="${d}">${d}m</button>`).join('')}
        </div>
        <button class="stim-entry-rm" data-rm="${i}" aria-label="Remove">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`;
  }

  draw();
}
