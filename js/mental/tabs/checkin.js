import { formatDate, today } from '../../utils/date.js';
import { DAY_FULL, MONTH_NAMES } from '../../constants.js';
import { getCheckin, saveCheckin } from '../store.js';
import { showToast } from '../../ui/toast.js';

const MOODS = ['😞', '🙁', '😐', '🙂', '😄'];
const SCALES = [
  { key: 'stress',  label: 'Stress',  low: 'calm',      high: 'high' },
  { key: 'anxiety', label: 'Tension', low: 'relaxed',   high: 'tense' },
  { key: 'energy',  label: 'Energy',  low: 'drained',   high: 'high' },
  { key: 'sleep',   label: 'Sleep',   low: 'poor',      high: 'great' },
  { key: 'social',  label: 'Social',  low: 'isolated',  high: 'connected' },
];
const TAGS = ['work', 'school', 'tired', 'lonely', 'anxious', 'productive', 'social', 'exercise', 'poor sleep', 'overwhelmed', 'calm', 'rested'];

let editing = false;
let working = null;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function renderCheckin() {
  const panel = document.getElementById('tab-checkin');
  if (!panel) return;
  const dateStr = formatDate(today());
  const existing = getCheckin(dateStr);
  const d = today();
  const header = `
    <div class="mh-header">
      <div class="mh-title">Check-in</div>
      <div class="mh-subtitle">${DAY_FULL[d.getDay()]}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}</div>
    </div>`;

  if (existing && !editing) { panel.innerHTML = header + summary(existing); wireSummary(panel); return; }

  if (!working) working = existing ? { ...existing } : { mood: null, stress: null, anxiety: null, energy: null, sleep: null, social: null, tags: [], note: '' };
  panel.innerHTML = header + form();
  wireForm(panel, dateStr);
}

function summary(c) {
  const rows = SCALES.map(s => `
    <div class="mh-sum-row"><span>${s.label}</span><span class="mh-sum-val">${c[s.key] ?? '–'}<span class="mh-sum-max">/5</span></span></div>`).join('');
  const tags = (c.tags && c.tags.length) ? `<div class="mh-tag-row">${c.tags.map(t => `<span class="mh-tag selected">${esc(t)}</span>`).join('')}</div>` : '';
  const note = c.note ? `<div class="mh-sum-note">${esc(c.note)}</div>` : '';
  return `
    <div class="card mh-card">
      <div class="mh-mood-big">${MOODS[(c.mood || 1) - 1] || '😐'}<span class="mh-mood-score">${c.mood ?? '–'}/5</span></div>
      <div class="mh-sum-grid">${rows}</div>
      ${tags}${note}
      <button class="btn btn-ghost" id="mh-edit" style="width:100%;margin-top:14px;">Edit check-in</button>
    </div>`;
}

function form() {
  const moodBtns = MOODS.map((e, i) => `
    <button type="button" class="mh-mood-btn ${working.mood === i + 1 ? 'active' : ''}" data-mood="${i + 1}">${e}</button>`).join('');

  const scales = SCALES.map(s => `
    <div class="mh-scale">
      <div class="mh-scale-label">${s.label}</div>
      <div class="mh-scale-btns" data-metric="${s.key}">
        ${[1, 2, 3, 4, 5].map(n => `<button type="button" class="mh-scale-btn ${working[s.key] === n ? 'active' : ''}" data-val="${n}">${n}</button>`).join('')}
      </div>
      <div class="mh-scale-ends"><span>${s.low}</span><span>${s.high}</span></div>
    </div>`).join('');

  const tags = TAGS.map(t => `
    <button type="button" class="mh-tag ${working.tags.includes(t) ? 'selected' : ''}" data-tag="${t}">${t}</button>`).join('');

  return `
    <div class="card mh-card">
      <div class="mh-field-label">Overall mood</div>
      <div class="mh-mood-row">${moodBtns}</div>
      ${scales}
      <div class="mh-field-label" style="margin-top:6px;">Tags</div>
      <div class="mh-tag-row">${tags}</div>
      <div class="mh-field-label" style="margin-top:14px;">Note</div>
      <input class="form-input" id="mh-note" type="text" maxlength="120" value="${esc(working.note || '')}" placeholder="optional, one line">
      <button class="btn btn-primary" id="mh-save" style="width:100%;margin-top:16px;">${getCheckin(formatDate(today())) ? 'Update check-in' : 'Save check-in'}</button>
    </div>`;
}

function wireSummary(panel) {
  panel.querySelector('#mh-edit').addEventListener('click', () => { editing = true; working = null; renderCheckin(); });
}

function wireForm(panel, dateStr) {
  panel.querySelectorAll('.mh-mood-btn').forEach(b => b.addEventListener('click', () => {
    working.mood = parseInt(b.dataset.mood);
    panel.querySelectorAll('.mh-mood-btn').forEach(x => x.classList.toggle('active', x === b));
  }));

  panel.querySelectorAll('.mh-scale-btns').forEach(row => {
    const metric = row.dataset.metric;
    row.querySelectorAll('.mh-scale-btn').forEach(b => b.addEventListener('click', () => {
      working[metric] = parseInt(b.dataset.val);
      row.querySelectorAll('.mh-scale-btn').forEach(x => x.classList.toggle('active', x === b));
    }));
  });

  panel.querySelectorAll('.mh-tag').forEach(b => b.addEventListener('click', () => {
    const tag = b.dataset.tag;
    if (working.tags.includes(tag)) working.tags = working.tags.filter(t => t !== tag);
    else working.tags.push(tag);
    b.classList.toggle('selected');
  }));

  panel.querySelector('#mh-save').addEventListener('click', () => {
    if (working.mood == null) { showToast('Pick a mood', 'warning'); return; }
    working.note = (panel.querySelector('#mh-note').value || '').trim();
    saveCheckin(dateStr, working);
    editing = false; working = null;
    showToast('Check-in saved', 'success');
    renderCheckin();
  });
}
