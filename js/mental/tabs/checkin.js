// ============================================================
// MENTAL · CHECK-IN — a short but honesty-oriented daily check-in. Every scale
// is anchored (each value has a word, so numbers carry meaning), sleep is a
// 1–100 score (Apple Health / watch), and a one-line nudge pushes for behaviour-
// based answers over self-image. Data-safe: the existing 1–5 fields are kept;
// `sleepScore` (1–100) is added and `sleep` (1–5) is DERIVED from it so all
// existing stats keep working unchanged.
// ============================================================

import { formatDate, today } from '../../utils/date.js';
import { DAY_FULL, MONTH_NAMES } from '../../constants.js';
import { getCheckin, saveCheckin } from '../store.js';
import { showToast } from '../../ui/toast.js';

const MOODS = ['😞', '🙁', '😐', '🙂', '😄'];
const MOOD_WORDS = ['rough', 'low', 'okay', 'good', 'great'];

// Anchored scales — each value (1–5) has a word so a number means something.
const SCALES = [
  { key: 'energy',  label: 'Energy',  anchors: ['drained', 'low', 'functional', 'good', 'strong'] },
  { key: 'stress',  label: 'Stress',  anchors: ['calm', 'mild', 'pressure', 'strained', 'overloaded'] },
  { key: 'anxiety', label: 'Tension', anchors: ['loose', 'settled', 'tight', 'on edge', 'wired'] },
  { key: 'social',  label: 'Social',  anchors: ['isolated', 'distant', 'neutral', 'connected', 'close'] },
];
const TENSION_TYPES = [['body', 'mostly body'], ['mind', 'mostly mind'], ['both', 'both']];
const TAGS = ['work', 'school', 'tired', 'lonely', 'anxious', 'productive', 'social', 'exercise', 'poor sleep', 'overwhelmed', 'calm', 'rested'];
const HONESTY = [['rushed', 'rushed it'], ['ok', 'mostly honest'], ['full', 'fully honest']];

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function sleepBand(score) {
  if (score == null) return '';
  if (score >= 85) return 'great'; if (score >= 70) return 'good'; if (score >= 50) return 'fair'; return 'poor';
}

let editing = false;
let working = null;

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

  if (!working) {
    working = existing ? { ...existing } : { mood: null, energy: null, stress: null, anxiety: null, social: null, sleepScore: null, tags: [], note: '', tensionType: null, honesty: null };
    if (working.sleepScore == null && typeof working.sleep === 'number') working.sleepScore = clamp(Math.round(working.sleep * 20), 1, 100);
    if (!Array.isArray(working.tags)) working.tags = [];
  }
  panel.innerHTML = header + form();
  wireForm(panel, dateStr);
}

function summary(c) {
  const rows = SCALES.map(s => {
    const v = c[s.key];
    const word = (typeof v === 'number') ? s.anchors[v - 1] : '–';
    return `<div class="mh-sum-row"><span>${s.label}</span><span class="mh-sum-val">${word}<span class="mh-sum-max">${typeof v === 'number' ? ` · ${v}/5` : ''}</span></span></div>`;
  }).join('');
  const sleep = (typeof c.sleepScore === 'number')
    ? `<div class="mh-sum-row"><span>Sleep</span><span class="mh-sum-val">${c.sleepScore}<span class="mh-sum-max">/100 · ${sleepBand(c.sleepScore)}</span></span></div>`
    : '';
  const tags = (c.tags && c.tags.length) ? `<div class="mh-tag-row">${c.tags.map(t => `<span class="mh-tag selected">${esc(t)}</span>`).join('')}</div>` : '';
  const note = c.note ? `<div class="mh-sum-note">${esc(c.note)}</div>` : '';
  return `
    <div class="card mh-card">
      <div class="mh-mood-big">${MOODS[(c.mood || 3) - 1] || '😐'}<span class="mh-mood-score">${c.mood ? MOOD_WORDS[c.mood - 1] : '–'}</span></div>
      <div class="mh-sum-grid">${rows}${sleep}</div>
      ${tags}${note}
      <button class="btn btn-ghost" id="mh-edit" style="width:100%;margin-top:14px;">Edit check-in</button>
    </div>`;
}

function form() {
  const moodBtns = MOODS.map((e, i) => `
    <button type="button" class="mh-mood-btn ${working.mood === i + 1 ? 'active' : ''}" data-mood="${i + 1}">${e}</button>`).join('');
  const moodCaption = working.mood ? MOOD_WORDS[working.mood - 1] : 'tap a face';

  const scales = SCALES.map(s => {
    const sel = working[s.key];
    const caption = (typeof sel === 'number') ? s.anchors[sel - 1] : `${s.anchors[0]} → ${s.anchors[4]}`;
    return `
    <div class="mh-scale">
      <div class="mh-scale-head"><span class="mh-scale-label">${s.label}</span><span class="mh-scale-caption" data-caption="${s.key}">${caption}</span></div>
      <div class="mh-scale-btns" data-metric="${s.key}">
        ${[1, 2, 3, 4, 5].map(n => `<button type="button" class="mh-scale-btn ${sel === n ? 'active' : ''}" data-val="${n}" title="${s.anchors[n - 1]}">${n}</button>`).join('')}
      </div>
    </div>${s.key === 'anxiety' ? tensionTypeRow() : ''}`;
  }).join('');

  const sleepBandTxt = working.sleepScore != null ? `${working.sleepScore}/100 · ${sleepBand(working.sleepScore)}` : 'from Apple Health / watch';
  const sleepQuick = [['Poor', 40], ['Fair', 60], ['Good', 78], ['Great', 92]]
    .map(([l, v]) => `<button type="button" class="mh-sleep-quick ${working.sleepScore === v ? 'active' : ''}" data-sleep="${v}">${l}</button>`).join('');

  const tags = TAGS.map(t => `
    <button type="button" class="mh-tag ${working.tags.includes(t) ? 'selected' : ''}" data-tag="${t}">${t}</button>`).join('');

  const honesty = HONESTY.map(([v, l]) => `<button type="button" class="mh-honesty-btn ${working.honesty === v ? 'active' : ''}" data-honesty="${v}">${l}</button>`).join('');

  return `
    <div class="card mh-card">
      <div class="mh-nudge">Answer from what you actually did today, not how you wish you felt. If you're unsure, pick the lower one.</div>

      <div class="mh-field-label">Overall mood <span class="mh-caption" data-caption="mood">${moodCaption}</span></div>
      <div class="mh-mood-row">${moodBtns}</div>

      ${scales}

      <div class="mh-scale" style="margin-top:4px;">
        <div class="mh-scale-head"><span class="mh-scale-label">Sleep score</span><span class="mh-scale-caption sleep-${sleepBand(working.sleepScore) || 'none'}" id="mh-sleep-band">${sleepBandTxt}</span></div>
        <div class="mh-sleep-row">
          <input class="form-input mh-sleep-input" id="mh-sleep" type="number" inputmode="numeric" min="1" max="100" placeholder="1–100" value="${working.sleepScore != null ? working.sleepScore : ''}">
          <div class="mh-sleep-quicks">${sleepQuick}</div>
        </div>
      </div>

      <div class="mh-field-label" style="margin-top:8px;">Tags</div>
      <div class="mh-tag-row">${tags}</div>

      <div class="mh-field-label" style="margin-top:14px;">Note</div>
      <input class="form-input" id="mh-note" type="text" maxlength="120" value="${esc(working.note || '')}" placeholder="optional, one line — what drove today?">

      <div class="mh-field-label" style="margin-top:14px;">How honest was this check-in?</div>
      <div class="mh-honesty-row">${honesty}</div>

      <button class="btn btn-primary" id="mh-save" style="width:100%;margin-top:16px;">${getCheckin(formatDate(today())) ? 'Update check-in' : 'Save check-in'}</button>
    </div>`;
}

function tensionTypeRow() {
  return `<div class="mh-ttype-row" data-ttype>${TENSION_TYPES.map(([v, l]) => `<button type="button" class="mh-ttype ${working.tensionType === v ? 'active' : ''}" data-ttype-val="${v}">${l}</button>`).join('')}</div>`;
}

function wireSummary(panel) {
  panel.querySelector('#mh-edit').addEventListener('click', () => { editing = true; working = null; renderCheckin(); });
}

function wireForm(panel, dateStr) {
  panel.querySelectorAll('.mh-mood-btn').forEach(b => b.addEventListener('click', () => {
    working.mood = parseInt(b.dataset.mood);
    panel.querySelectorAll('.mh-mood-btn').forEach(x => x.classList.toggle('active', x === b));
    const cap = panel.querySelector('[data-caption="mood"]'); if (cap) cap.textContent = MOOD_WORDS[working.mood - 1];
  }));

  panel.querySelectorAll('.mh-scale-btns').forEach(row => {
    const metric = row.dataset.metric;
    const anchors = (SCALES.find(s => s.key === metric) || {}).anchors || [];
    row.querySelectorAll('.mh-scale-btn').forEach(b => b.addEventListener('click', () => {
      working[metric] = parseInt(b.dataset.val);
      row.querySelectorAll('.mh-scale-btn').forEach(x => x.classList.toggle('active', x === b));
      const cap = panel.querySelector(`[data-caption="${metric}"]`); if (cap) cap.textContent = anchors[working[metric] - 1] || '';
    }));
  });

  const ttypeRow = panel.querySelector('[data-ttype]');
  if (ttypeRow) ttypeRow.querySelectorAll('.mh-ttype').forEach(b => b.addEventListener('click', () => {
    working.tensionType = working.tensionType === b.dataset.ttypeVal ? null : b.dataset.ttypeVal;
    ttypeRow.querySelectorAll('.mh-ttype').forEach(x => x.classList.toggle('active', x.dataset.ttypeVal === working.tensionType));
  }));

  const sleepInput = panel.querySelector('#mh-sleep');
  const band = panel.querySelector('#mh-sleep-band');
  const syncSleep = () => {
    const raw = sleepInput.value.trim();
    if (raw === '') { working.sleepScore = null; }
    else working.sleepScore = clamp(Math.round(Number(raw) || 0), 1, 100);
    if (band) {
      band.textContent = working.sleepScore != null ? `${working.sleepScore}/100 · ${sleepBand(working.sleepScore)}` : 'from Apple Health / watch';
      band.className = `mh-scale-caption sleep-${sleepBand(working.sleepScore) || 'none'}`;
    }
    panel.querySelectorAll('.mh-sleep-quick').forEach(x => x.classList.toggle('active', parseInt(x.dataset.sleep) === working.sleepScore));
  };
  if (sleepInput) sleepInput.addEventListener('input', syncSleep);
  panel.querySelectorAll('.mh-sleep-quick').forEach(b => b.addEventListener('click', () => {
    working.sleepScore = parseInt(b.dataset.sleep);
    if (sleepInput) sleepInput.value = working.sleepScore;
    syncSleep();
  }));

  panel.querySelectorAll('.mh-tag').forEach(b => b.addEventListener('click', () => {
    const tag = b.dataset.tag;
    if (working.tags.includes(tag)) working.tags = working.tags.filter(t => t !== tag);
    else working.tags.push(tag);
    b.classList.toggle('selected');
  }));

  panel.querySelectorAll('.mh-honesty-btn').forEach(b => b.addEventListener('click', () => {
    working.honesty = working.honesty === b.dataset.honesty ? null : b.dataset.honesty;
    panel.querySelectorAll('.mh-honesty-btn').forEach(x => x.classList.toggle('active', x.dataset.honesty === working.honesty));
  }));

  panel.querySelector('#mh-save').addEventListener('click', () => {
    if (working.mood == null) { showToast('Pick a mood', 'warning'); return; }
    working.note = (panel.querySelector('#mh-note').value || '').trim();
    // Derive the legacy 1–5 sleep field from the 1–100 score so existing stats
    // (sleepVsMood, patternSummary) keep working with the same meaning.
    if (working.sleepScore != null) working.sleep = clamp(Math.round(working.sleepScore / 20), 1, 5);
    saveCheckin(dateStr, working);
    editing = false; working = null;
    showToast('Check-in saved', 'success');
    renderCheckin();
  });
}
