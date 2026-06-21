import { state } from '../../state.js';
import { formatDate, today, addDays } from '../../utils/date.js';
import { CATEGORIES, categoryColor } from '../defaultActivities.js';
import {
  dayBlocks, blockEntries, addEntry, setEntryDuration, removeEntry,
  filledBlockCount, getActivities, findActivity, entrySourceBadge,
} from '../store.js';
import { openScreenTimeImport } from './importScreen.js';

const DURATIONS = [5, 15, 30, 60];
let _search = ''; // activity search filter (per Log session)

// Most-used activity ids over the last 7 days (read-only), top N.
function recentIds(n = 8) {
  const counts = {};
  const logs = (state.stimulation && state.stimulation.logs) || {};
  for (let i = 0; i < 7; i++) {
    const date = formatDate(addDays(today(), -i));
    const day = logs[date];
    if (!day || !day.blocks) continue;
    for (const idx of Object.keys(day.blocks)) for (const e of (day.blocks[idx] || [])) counts[e.activityId] = (counts[e.activityId] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([id]) => id).filter(id => findActivity(id)).slice(0, n);
}
const chipHtml = a => a ? `<button class="stim-chip" data-add="${a.id}" style="border-color:${categoryColor(a.category)}33">${esc(a.name)}</button>` : '';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Index of the time block that contains the current clock time. Clamps to the
// first/last block when "now" falls before the day window starts or after it ends.
function currentBlockIndex(blocks) {
  if (!blocks.length) return 0;
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const idx = blocks.findIndex(b => cur >= b.startMin && cur < b.endMin);
  if (idx !== -1) return idx;
  return cur < blocks[0].startMin ? 0 : blocks.length - 1;
}

// Entry point (called when the Log tab is opened / navigated to). Each open,
// jump to the block for the current time on Today; in-tab actions use draw()
// instead so they keep your place.
export function renderStimLog() {
  const panel = document.getElementById('tab-log');
  if (!panel) return;

  const todayStr = formatDate(today());
  const yestStr = formatDate(addDays(today(), -1));
  if (!state.stimDate || (state.stimDate !== todayStr && state.stimDate !== yestStr)) state.stimDate = todayStr;

  if (state.stimDate === todayStr) state.stimBlock = currentBlockIndex(dayBlocks());
  _search = '';
  draw();
}

function draw() {
  const panel = document.getElementById('tab-log');
  if (!panel) return;

  const todayStr = formatDate(today());
  const yestStr = formatDate(addDays(today(), -1));

  const blocks = dayBlocks();
  if (!Number.isInteger(state.stimBlock) || state.stimBlock < 0 || state.stimBlock >= blocks.length) state.stimBlock = 0;
  const date = state.stimDate;
  const block = blocks[state.stimBlock];
  const entries = blockEntries(date, block.index);
  const filled = filledBlockCount(date);

  const activities = getActivities();
  const groups = CATEGORIES.map(cat => ({
    cat,
    items: activities.filter(a => a.category === cat.id),
  })).filter(g => g.items.length);

  const q = _search.trim().toLowerCase();
  let pickerHtml;
  if (q) {
    const matches = activities.filter(a => a.name.toLowerCase().includes(q)).slice(0, 30);
    pickerHtml = matches.length
      ? `<div class="stim-cat-block"><div class="stim-chip-row">${matches.map(chipHtml).join('')}</div></div>`
      : `<div class="mh-empty" style="text-align:left;padding:6px 0;">No activities match “${esc(_search)}”.</div>`;
  } else {
    const recent = recentIds();
    const recentRow = recent.length
      ? `<div class="stim-cat-block"><div class="stim-cat-label">Recent</div><div class="stim-chip-row">${recent.map(id => chipHtml(findActivity(id))).join('')}</div></div>`
      : '';
    pickerHtml = recentRow + groups.map(g => `
      <div class="stim-cat-block">
        <div class="stim-cat-label" style="color:${g.cat.color}">${g.cat.label}</div>
        <div class="stim-chip-row">${g.items.map(chipHtml).join('')}</div>
      </div>`).join('');
  }

  panel.innerHTML = `
    <div class="mh-header sti-loghead">
      <div>
        <div class="mh-title">Log</div>
        <div class="mh-subtitle">Tap what happened in each time block</div>
      </div>
      <button class="btn btn-ghost sti-import-btn" id="stim-import" aria-label="Import Screen Time">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>
        Import
      </button>
    </div>

    <div class="pill-nav">
      <button class="pill-btn ${date === todayStr ? 'active' : ''}" data-date="${todayStr}">Today</button>
      <button class="pill-btn ${date === yestStr ? 'active' : ''}" data-date="${yestStr}">Yesterday</button>
    </div>

    <div class="stim-stepper">
      <button class="stim-step-btn" id="stim-prev" ${state.stimBlock === 0 ? 'disabled' : ''} aria-label="Previous block">‹</button>
      <div class="stim-step-mid">
        <div class="stim-step-block">${block.label}</div>
        <div class="stim-step-count">Block ${state.stimBlock + 1} / ${blocks.length} · ${filled} filled</div>
      </div>
      <button class="stim-step-btn" id="stim-next" ${state.stimBlock === blocks.length - 1 ? 'disabled' : ''} aria-label="Next block">›</button>
    </div>

    <div class="card stim-block-entries">
      <div class="mh-field-label">This block</div>
      ${entries.length === 0 ? `<div class="mh-empty" style="text-align:left;padding:6px 0;">Nothing logged. Tap an activity below.</div>` : `
        <div class="stim-entry-list">
          ${entries.map((e, i) => entryRow(e, i)).join('')}
        </div>`}
    </div>

    <input class="form-input stim-search" id="stim-search" type="text" placeholder="Search activities…" value="${esc(_search)}" autocomplete="off">
    ${pickerHtml}
  `;

  // search (preserve focus + caret across the redraw)
  const si = panel.querySelector('#stim-search');
  if (si) si.addEventListener('input', () => {
    _search = si.value; const at = si.selectionStart; draw();
    const ns = document.getElementById('stim-search');
    if (ns) { ns.focus(); try { ns.setSelectionRange(at, at); } catch {} }
  });

  // Screen Time import (reconciles snapshots; refreshes this tab when done)
  const imp = panel.querySelector('#stim-import');
  if (imp) imp.addEventListener('click', () => openScreenTimeImport({ date: state.stimDate, onDone: draw }));

  // date toggle (in-tab action → draw, so it doesn't snap back to "now")
  panel.querySelectorAll('.pill-btn[data-date]').forEach(b => b.addEventListener('click', () => {
    state.stimDate = b.dataset.date; draw();
  }));
  // stepper
  const prev = panel.querySelector('#stim-prev');
  const next = panel.querySelector('#stim-next');
  if (prev) prev.addEventListener('click', () => { if (state.stimBlock > 0) { state.stimBlock--; draw(); } });
  if (next) next.addEventListener('click', () => { if (state.stimBlock < blocks.length - 1) { state.stimBlock++; draw(); } });
  // add activity to this block
  panel.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => {
    const ex = findActivity(b.dataset.add);
    addEntry(date, block.index, b.dataset.add, ex ? ex.defaultDurationMinutes : 15);
    draw();
  }));
  // entry duration chips + remove
  panel.querySelectorAll('[data-dur]').forEach(b => b.addEventListener('click', () => {
    setEntryDuration(date, block.index, parseInt(b.dataset.ei), parseInt(b.dataset.dur));
    draw();
  }));
  panel.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => {
    removeEntry(date, block.index, parseInt(b.dataset.rm));
    draw();
  }));
}

function entryRow(e, i) {
  const ex = findActivity(e.activityId);
  const badge = entrySourceBadge(e);
  return `
    <div class="stim-entry">
      <div class="stim-entry-top">
        <span class="stim-entry-name">${esc(ex ? ex.name : '(removed)')}${badge ? ` <span class="stim-src ${badge.cls}">${esc(badge.text)}</span>` : ''}</span>
        <span class="stim-entry-dur">${e.durationMinutes} min</span>
        <button class="stim-entry-rm" data-rm="${i}" aria-label="Remove">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="stim-dur-row">
        ${DURATIONS.map(d => `<button class="stim-dur ${e.durationMinutes === d ? 'active' : ''}" data-ei="${i}" data-dur="${d}">${d}m</button>`).join('')}
      </div>
    </div>`;
}
