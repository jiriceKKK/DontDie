import { state } from '../../state.js';
import { formatDate, today, addDays } from '../../utils/date.js';
import { CATEGORIES, categoryColor } from '../defaultActivities.js';
import {
  dayBlocks, blockEntries, addEntry, setEntryDuration, removeEntry,
  filledBlockCount, getActivities, findActivity,
} from '../store.js';

const DURATIONS = [5, 15, 30, 60];

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

  panel.innerHTML = `
    <div class="mh-header">
      <div class="mh-title">Log</div>
      <div class="mh-subtitle">Tap what happened in each time block</div>
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

    ${groups.map(g => `
      <div class="stim-cat-block">
        <div class="stim-cat-label" style="color:${g.cat.color}">${g.cat.label}</div>
        <div class="stim-chip-row">
          ${g.items.map(a => `<button class="stim-chip" data-add="${a.id}" style="border-color:${g.cat.color}33">${esc(a.name)}</button>`).join('')}
        </div>
      </div>`).join('')}
  `;

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
  return `
    <div class="stim-entry">
      <div class="stim-entry-top">
        <span class="stim-entry-name">${esc(ex ? ex.name : '(removed)')}</span>
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
