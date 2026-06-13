// ============================================================
// MENTAL · CHECK-IN — a short, behavior-first self-observation. Instead of
// rating 1–5 sliders (easy to fill in on autopilot), you pick a specific mood
// WORD and choose between a few clearly-worded, behavior-anchored options. A
// "deeper" section adds a body/mind split and a one-line evidence prompt.
//
// Data-safe: everything still maps to the existing numeric dimensions —
//   mood/stress/anxiety/energy/social are 1–5, sleep is derived 1–5 from the
//   1–100 sleepScore — so all existing stats keep working. New optional fields
//   (moodWord, tensionType, evidence) are additive.
// ============================================================

import { formatDate, today } from '../../utils/date.js';
import { DAY_FULL, MONTH_NAMES } from '../../constants.js';
import { getCheckin, saveCheckin } from '../store.js';
import { showToast } from '../../ui/toast.js';

// Mood words give granularity; each maps to a 1–5 value for the existing charts.
const MOOD_WORDS = [
  { w: 'low', v: 1 }, { w: 'drained', v: 1 },
  { w: 'tired', v: 2 }, { w: 'flat', v: 2 }, { w: 'stressed', v: 2 }, { w: 'irritated', v: 2 }, { w: 'anxious', v: 2 },
  { w: 'okay', v: 3 }, { w: 'restless', v: 3 },
  { w: 'calm', v: 4 }, { w: 'focused', v: 4 }, { w: 'content', v: 4 },
  { w: 'good', v: 5 }, { w: 'motivated', v: 5 },
];
const MOOD_EMOJI = ['😞', '🙁', '😐', '🙂', '😄'];

// Behavior-anchored 3-level choices mapping to 1 / 3 / 5.
const CHOICES = [
  { key: 'energy',  label: 'Energy',  prompt: 'how your body actually moved today', opts: [['drained', 1], ['functional', 3], ['strong', 5]] },
  { key: 'stress',  label: 'Stress',  prompt: 'pressure you felt, not pressure you expected', opts: [['calm', 1], ['pressured', 3], ['overloaded', 5]] },
  { key: 'anxiety', label: 'Tension', prompt: 'restlessness in body or mind', opts: [['relaxed', 1], ['tense', 3], ['restless', 5]] },
  { key: 'social',  label: 'Social',  prompt: 'real contact with people today', opts: [['isolated', 1], ['neutral', 3], ['connected', 5]] },
];
const TENSION_TYPES = [['body', 'mostly body'], ['mind', 'mostly mind'], ['both', 'both']];
const TAGS = ['work', 'school', 'tired', 'lonely', 'anxious', 'productive', 'social', 'exercise', 'poor sleep', 'overwhelmed', 'calm', 'rested'];

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function sleepBand(score) { if (score == null) return ''; if (score >= 85) return 'great'; if (score >= 70) return 'good'; if (score >= 50) return 'fair'; return 'poor'; }
const wordOfChoice = (key, val) => { const c = CHOICES.find(x => x.key === key); const o = c && c.opts.find(o => o[1] === val); return o ? o[0] : (val != null ? String(val) : '–'); };

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
    working = existing ? { ...existing } : { mood: null, moodWord: null, energy: null, stress: null, anxiety: null, social: null, sleepScore: null, tensionType: null, evidence: '', tags: [], note: '' };
    if (working.sleepScore == null && typeof working.sleep === 'number') working.sleepScore = clamp(Math.round(working.sleep * 20), 1, 100);
    if (!Array.isArray(working.tags)) working.tags = [];
  }
  panel.innerHTML = header + form();
  wireForm(panel, dateStr);
}

function summary(c) {
  const moodWord = c.moodWord || (c.mood ? ['low', 'tired', 'okay', 'calm', 'good'][c.mood - 1] : '–');
  const rows = CHOICES.map(s => `<div class="mh-sum-row"><span>${s.label}</span><span class="mh-sum-val">${esc(wordOfChoice(s.key, c[s.key]))}</span></div>`).join('');
  const sleep = (typeof c.sleepScore === 'number')
    ? `<div class="mh-sum-row"><span>Sleep</span><span class="mh-sum-val">${c.sleepScore}<span class="mh-sum-max">/100 · ${sleepBand(c.sleepScore)}</span></span></div>` : '';
  const tags = (c.tags && c.tags.length) ? `<div class="mh-tag-row">${c.tags.map(t => `<span class="mh-tag selected">${esc(t)}</span>`).join('')}</div>` : '';
  const ev = c.evidence ? `<div class="mh-sum-note"><span class="mh-sum-evlabel">Evidence:</span> ${esc(c.evidence)}</div>` : '';
  const note = c.note ? `<div class="mh-sum-note">${esc(c.note)}</div>` : '';
  return `
    <div class="card mh-card">
      <div class="mh-mood-big">${MOOD_EMOJI[(c.mood || 3) - 1] || '😐'}<span class="mh-mood-score">${esc(moodWord)}</span></div>
      <div class="mh-sum-grid">${rows}${sleep}</div>
      ${tags}${ev}${note}
      <button class="btn btn-ghost" id="mh-edit" style="width:100%;margin-top:14px;">Edit check-in</button>
    </div>`;
}

function form() {
  const moodGrid = MOOD_WORDS.map(m => `<button type="button" class="mh-moodword ${working.moodWord === m.w ? 'active' : ''}" data-word="${m.w}" data-v="${m.v}">${m.w}</button>`).join('');

  const choices = CHOICES.map(s => `
    <div class="mh-choice">
      <div class="mh-choice-head"><span class="mh-choice-label">${s.label}</span><span class="mh-choice-prompt">${s.prompt}</span></div>
      <div class="mh-choice-opts" data-choice="${s.key}">
        ${s.opts.map(([w, v]) => `<button type="button" class="mh-choice-btn ${working[s.key] === v ? 'active' : ''}" data-val="${v}">${w}</button>`).join('')}
      </div>
    </div>`).join('');

  const sleepBandTxt = working.sleepScore != null ? `${working.sleepScore}/100 · ${sleepBand(working.sleepScore)}` : 'manual, from Apple Health / Watch';
  const sleepQuick = [['Poor', 40], ['Fair', 60], ['Good', 78], ['Great', 92]]
    .map(([l, v]) => `<button type="button" class="mh-sleep-quick ${working.sleepScore === v ? 'active' : ''}" data-sleep="${v}">${l}</button>`).join('');

  const ttypes = TENSION_TYPES.map(([v, l]) => `<button type="button" class="mh-ttype ${working.tensionType === v ? 'active' : ''}" data-ttype-val="${v}">${l}</button>`).join('');
  const tags = TAGS.map(t => `<button type="button" class="mh-tag ${working.tags.includes(t) ? 'selected' : ''}" data-tag="${t}">${t}</button>`).join('');
  const deepOpen = !!(working.evidence || working.tensionType || (working.tags && working.tags.length) || working.note);

  return `
    <div class="card mh-card">
      <div class="mh-nudge">Pick from what you actually did today, not how you wish you felt. If a camera recorded your day, would it agree? When unsure, choose the lower one.</div>

      <div class="mh-step">Step 1 · State</div>
      <div class="mh-field-label">Closest word for today <span class="mh-caption" id="mh-mood-cap">${working.moodWord ? esc(working.moodWord) : 'pick one'}</span></div>
      <div class="mh-moodword-grid">${moodGrid}</div>

      <div class="mh-step">Step 2 · Body &amp; mind</div>
      ${choices}

      <div class="mh-step">Step 3 · Sleep</div>
      <div class="mh-choice">
        <div class="mh-choice-head"><span class="mh-choice-label">Sleep score</span><span class="mh-choice-prompt sleep-${sleepBand(working.sleepScore) || 'none'}" id="mh-sleep-band">${sleepBandTxt}</span></div>
        <div class="mh-sleep-row">
          <input class="form-input mh-sleep-input" id="mh-sleep" type="number" inputmode="numeric" min="1" max="100" placeholder="1–100" value="${working.sleepScore != null ? working.sleepScore : ''}">
          <div class="mh-sleep-quicks">${sleepQuick}</div>
        </div>
      </div>

      <details class="mh-deeper" ${deepOpen ? 'open' : ''}>
        <summary>Deeper check-in (optional)</summary>

        <div class="mh-field-label" style="margin-top:10px;">Tension is…</div>
        <div class="mh-ttype-row" data-ttype>${ttypes}</div>

        <div class="mh-field-label" style="margin-top:14px;">One behavior that proves this check-in</div>
        <input class="form-input" id="mh-evidence" type="text" maxlength="120" value="${esc(working.evidence || '')}" placeholder="e.g. skipped the gym and scrolled for an hour">

        <div class="mh-field-label" style="margin-top:14px;">Tags</div>
        <div class="mh-tag-row">${tags}</div>

        <div class="mh-field-label" style="margin-top:14px;">Note</div>
        <input class="form-input" id="mh-note" type="text" maxlength="120" value="${esc(working.note || '')}" placeholder="optional, one line">
      </details>

      <button class="btn btn-primary" id="mh-save" style="width:100%;margin-top:16px;">${getCheckin(formatDate(today())) ? 'Update check-in' : 'Save check-in'}</button>
    </div>`;
}

function wireSummary(panel) {
  panel.querySelector('#mh-edit').addEventListener('click', () => { editing = true; working = null; renderCheckin(); });
}

function wireForm(panel, dateStr) {
  panel.querySelectorAll('.mh-moodword').forEach(b => b.addEventListener('click', () => {
    working.moodWord = b.dataset.word; working.mood = parseInt(b.dataset.v);
    panel.querySelectorAll('.mh-moodword').forEach(x => x.classList.toggle('active', x === b));
    const cap = panel.querySelector('#mh-mood-cap'); if (cap) cap.textContent = working.moodWord;
  }));

  panel.querySelectorAll('.mh-choice-opts').forEach(row => {
    const key = row.dataset.choice;
    row.querySelectorAll('.mh-choice-btn').forEach(b => b.addEventListener('click', () => {
      working[key] = parseInt(b.dataset.val);
      row.querySelectorAll('.mh-choice-btn').forEach(x => x.classList.toggle('active', x === b));
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
    working.sleepScore = raw === '' ? null : clamp(Math.round(Number(raw) || 0), 1, 100);
    if (band) { band.textContent = working.sleepScore != null ? `${working.sleepScore}/100 · ${sleepBand(working.sleepScore)}` : 'manual, from Apple Health / Watch'; band.className = `mh-choice-prompt sleep-${sleepBand(working.sleepScore) || 'none'}`; }
    panel.querySelectorAll('.mh-sleep-quick').forEach(x => x.classList.toggle('active', parseInt(x.dataset.sleep) === working.sleepScore));
  };
  if (sleepInput) sleepInput.addEventListener('input', syncSleep);
  panel.querySelectorAll('.mh-sleep-quick').forEach(b => b.addEventListener('click', () => {
    working.sleepScore = parseInt(b.dataset.sleep); if (sleepInput) sleepInput.value = working.sleepScore; syncSleep();
  }));

  panel.querySelectorAll('.mh-tag').forEach(b => b.addEventListener('click', () => {
    const tag = b.dataset.tag;
    if (working.tags.includes(tag)) working.tags = working.tags.filter(t => t !== tag);
    else working.tags.push(tag);
    b.classList.toggle('selected');
  }));

  panel.querySelector('#mh-save').addEventListener('click', () => {
    if (working.mood == null) { showToast('Pick a word for today', 'warning'); return; }
    working.evidence = (panel.querySelector('#mh-evidence') ? panel.querySelector('#mh-evidence').value : '').trim();
    working.note = (panel.querySelector('#mh-note') ? panel.querySelector('#mh-note').value : '').trim();
    if (working.sleepScore != null) working.sleep = clamp(Math.round(working.sleepScore / 20), 1, 5);
    saveCheckin(dateStr, working);
    editing = false; working = null;
    showToast('Check-in saved', 'success');
    renderCheckin();
  });
}
