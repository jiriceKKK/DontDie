// ============================================================
// SCREEN TIME IMPORT — modal flow (paste -> fast classify -> preview -> confirm).
//
// Steps:
//   1. Paste     — pick the day, paste/dictate the Screen Time text, Scan.
//   2. Duplicate — if this exact snapshot was already imported, warn + choose.
//   3. Classify  — ambiguous/unknown apps, ONE tap each, auto-advance (no
//                  per-app confirm). Back revises the previous choice.
//   4. Preview   — per-app: Screen Time / manual / imported-before / missing /
//                  action. One Confirm Import for the whole snapshot.
// All reconciliation lives in screenTime.js; this file is presentation only.
// ============================================================

import { openModal, closeModal } from '../../ui/modal.js';
import { showToast } from '../../ui/toast.js';
import { formatDate, today, addDays } from '../../utils/date.js';
import { categoryLabel, categoryColor } from '../defaultActivities.js';
import { dayBlocks, blockIndexForMinutes, currentBlockIndex } from '../store.js';
import {
  parseScreenTime, snapshotStatus, resolveMapping, buildPlan, commitImport,
  timeToMinutes, CLASS_OPTIONS,
} from '../screenTime.js';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let S = null; // session state for the open flow

export function openScreenTimeImport(opts = {}) {
  const d = opts.date || formatDate(today());
  S = { date: d, text: '', parsed: null, classified: {}, queue: [], qi: 0, capturedAt: null, onDone: opts.onDone || null };
  renderPaste();
}

// ---- step 1: paste --------------------------------------------------------
function renderPaste(errMsg) {
  const todayStr = formatDate(today());
  const yestStr = formatDate(addDays(today(), -1));
  openModal(`
    <div class="sti-intro">Paste your iPhone <b>Screen Time</b> list for a day. It's a running total, so importing again later only adds the new minutes — never double-counts.</div>
    <div class="pill-nav sti-daypick">
      <button class="pill-btn ${S.date === todayStr ? 'active' : ''}" data-date="${todayStr}">Today</button>
      <button class="pill-btn ${S.date === yestStr ? 'active' : ''}" data-date="${yestStr}">Yesterday</button>
    </div>
    <textarea class="form-input sti-textarea" id="sti-text" rows="8" placeholder="Brawl Stars: 49 min&#10;Instagram 1h 12m&#10;Safari 18m&#10;YouTube 35m">${esc(S.text)}</textarea>
    ${errMsg ? `<div class="sti-err">${esc(errMsg)}</div>` : ''}
    <div class="sti-hint">One app per line, e.g. <code>Brawl Stars: 49 min</code> or <code>Instagram 1h 12m</code>. A line like <code>At 12:45</code> sets the snapshot time.</div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="sti-cancel">Cancel</button>
      <button class="btn btn-primary" id="sti-scan">Scan</button>
    </div>
  `, 'Import Screen Time');

  const $ = id => document.getElementById(id);
  $('sti-text').addEventListener('input', e => { S.text = e.target.value; });
  document.querySelectorAll('.sti-daypick .pill-btn').forEach(b => b.addEventListener('click', () => { S.date = b.dataset.date; renderPaste(); }));
  $('sti-cancel').addEventListener('click', closeModal);
  $('sti-scan').addEventListener('click', onScan);
}

function onScan() {
  const parsed = parseScreenTime(S.text);
  if (!parsed.items.length) {
    renderPaste('No apps found. Use lines like "Brawl Stars: 49 min".');
    return;
  }
  S.parsed = parsed;
  S.capturedAt = parsed.capturedAt;
  // Reset session classifications for a fresh scan.
  S.classified = {};

  const status = snapshotStatus(S.date, parsed.items);
  if (status.kind === 'duplicate') { renderDuplicate(); return; }
  startClassifyOrPreview();
}

// ---- step 2: duplicate warning --------------------------------------------
function renderDuplicate() {
  openModal(`
    <div class="sti-dup">
      <div class="sti-dup-icon">!</div>
      <div>This Screen Time snapshot looks <b>already imported</b> — the same apps and totals are on record for ${esc(dayLabel(S.date))}.</div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="sti-dup-back">Back</button>
      <button class="btn btn-primary" id="sti-dup-go">Review anyway</button>
    </div>
  `, 'Already imported?');
  document.getElementById('sti-dup-back').addEventListener('click', renderPaste);
  document.getElementById('sti-dup-go').addEventListener('click', startClassifyOrPreview);
}

function startClassifyOrPreview() {
  // Queue = apps with no confident mapping yet (need one tap each).
  S.queue = S.parsed.items.filter(it => resolveMapping(it.key).status === 'ambiguous').map(it => it.key);
  S.qi = 0;
  if (S.queue.length) renderClassify();
  else renderPreview();
}

// ---- step 3: fast classify (one tap per app) ------------------------------
function renderClassify() {
  const key = S.queue[S.qi];
  const item = S.parsed.items.find(it => it.key === key);
  const n = S.queue.length;
  const chosen = S.classified[key];
  openModal(`
    <div class="sti-cl-progress">App ${S.qi + 1} of ${n} to sort</div>
    <div class="sti-cl-app">
      <div class="sti-cl-name">${esc(item.app)}</div>
      <div class="sti-cl-time">${fmtMin(item.totalMin)} today</div>
    </div>
    <div class="sti-cl-q">How should this count?</div>
    <div class="sti-cl-opts">
      ${CLASS_OPTIONS.map(o => `
        <button class="sti-cl-opt ${chosen === o.id ? 'active' : ''} ${o.id === 'ignored' ? 'is-ignore' : ''}" data-cat="${o.id}">
          <span class="sti-cl-opt-label">${esc(o.label)}</span>
          <span class="sti-cl-opt-hint">${esc(o.hint)}</span>
        </button>`).join('')}
    </div>
    <div class="modal-actions sti-cl-actions">
      <button class="btn btn-ghost" id="sti-cl-back">${S.qi > 0 ? 'Back' : 'Cancel'}</button>
      <div class="sti-cl-spacer"></div>
    </div>
  `, 'Sort apps');

  document.querySelectorAll('.sti-cl-opt').forEach(b => b.addEventListener('click', () => {
    S.classified[key] = b.dataset.cat;      // save immediately
    if (S.qi < S.queue.length - 1) { S.qi++; renderClassify(); }   // auto-advance
    else renderPreview();                                          // last app -> preview
  }));
  document.getElementById('sti-cl-back').addEventListener('click', () => {
    if (S.qi > 0) { S.qi--; renderClassify(); } else renderPaste();
  });
}

// Jump back into the classifier for ONE app (the preview "change" link), then
// return straight to the preview.
function reclassifyOne(key) {
  S.queue = [key];
  S.qi = 0;
  renderClassify();
}

// ---- step 4: preview + confirm --------------------------------------------
function renderPreview() {
  const plan = buildPlan(S.date, S.parsed.items, S.classified);
  const unresolved = plan.filter(r => r.status === 'ambiguous');
  const toImport = plan.filter(r => r.action === 'import' && r.missing > 0);
  const importMin = toImport.reduce((s, r) => s + r.missing, 0);
  const status = snapshotStatus(S.date, S.parsed.items);

  const blockIdx = S.capturedAt != null ? blockIndexForMinutes(timeToMinutes(S.capturedAt) || 0) : currentBlockIndex();
  const blockLabel = (dayBlocks()[blockIdx] || {}).label || '';

  openModal(`
    ${status.kind === 'update' ? `<div class="sti-note">Updating the snapshot for ${esc(dayLabel(S.date))} — only new minutes since your last import will be added.</div>` : ''}
    <div class="sti-prev-head">
      <span>${esc(dayLabel(S.date))}</span>
      <span class="sti-prev-place">${S.capturedAt ? `snapshot ${esc(S.capturedAt)} · ` : ''}lands in ${esc(blockLabel)}</span>
    </div>
    <div class="sti-prev-list">
      ${plan.map(previewRow).join('')}
    </div>
    ${unresolved.length ? `<div class="sti-err">${unresolved.length} app${unresolved.length > 1 ? 's' : ''} still need sorting.</div>` : ''}
    <div class="sti-prev-total">${importMin > 0 ? `Will import <b>+${fmtMin(importMin)}</b> across ${toImport.length} app${toImport.length > 1 ? 's' : ''}` : 'Nothing new to import'}</div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="sti-prev-back">Back</button>
      <button class="btn btn-primary" id="sti-prev-confirm" ${unresolved.length || importMin <= 0 ? 'disabled' : ''}>Confirm import</button>
    </div>
  `, 'Review import');

  document.querySelectorAll('[data-change]').forEach(b => b.addEventListener('click', () => reclassifyOne(b.dataset.change)));
  document.getElementById('sti-prev-back').addEventListener('click', () => {
    if (S.parsed.items.some(it => resolveMapping(it.key).status === 'ambiguous')) startClassifyOrPreview();
    else renderPaste();
  });
  const conf = document.getElementById('sti-prev-confirm');
  if (conf) conf.addEventListener('click', onConfirm);
}

function previewRow(r) {
  if (r.status === 'ambiguous') {
    return `<div class="sti-row is-ambiguous">
      <div class="sti-row-main"><span class="sti-row-app">${esc(r.app)}</span><span class="sti-row-sub">${fmtMin(r.totalMin)} · needs sorting</span></div>
      <button class="sti-row-act sti-change" data-change="${esc(r.key)}">Sort</button>
    </div>`;
  }
  if (r.status === 'ignored') {
    return `<div class="sti-row is-ignored">
      <div class="sti-row-main"><span class="sti-row-app">${esc(r.app)}</span><span class="sti-row-sub">${fmtMin(r.totalMin)} · ignored</span></div>
      <button class="sti-row-act sti-change" data-change="${esc(r.key)}">Change</button>
    </div>`;
  }
  const cat = r.category;
  const detail = [];
  if (r.alreadyManual > 0) detail.push(`logged ${fmtMin(r.alreadyManual)}`);
  if (r.alreadyImported > 0) detail.push(`imported ${fmtMin(r.alreadyImported)}`);
  let actText, actCls;
  if (r.action === 'import') { actText = `+${fmtMin(r.missing)}`; actCls = 'act-import'; }
  else if (r.action === 'exceeds') { actText = 'over'; actCls = 'act-skip'; }
  else { actText = 'covered'; actCls = 'act-skip'; }
  const changeable = r.recheck || r.source === 'session' || r.source === 'user';
  return `<div class="sti-row">
    <div class="sti-row-main">
      <span class="sti-row-app">${esc(r.app)}</span>
      <span class="sti-row-sub">
        <span class="sti-cat-dot" style="background:${categoryColor(cat)}"></span>${esc(categoryLabel(cat))}
        · ${fmtMin(r.totalMin)} total${detail.length ? ' · ' + detail.join(' · ') : ''}
        ${changeable ? `<button class="sti-change sti-change-inline" data-change="${esc(r.key)}">change</button>` : ''}
      </span>
    </div>
    <span class="sti-row-act ${actCls}">${actText}</span>
  </div>`;
}

function onConfirm() {
  const plan = buildPlan(S.date, S.parsed.items, S.classified);
  const res = commitImport(S.date, plan, S.capturedAt, S.classified);
  closeModal();
  if (res.importedApps > 0) showToast(`Imported ${fmtMin(res.importedMin)} across ${res.importedApps} app${res.importedApps > 1 ? 's' : ''}`, 'success');
  else showToast('Nothing new to import', 'default');
  if (typeof S.onDone === 'function') S.onDone();
}

// ---- helpers --------------------------------------------------------------
function fmtMin(m) {
  m = Math.round(Number(m) || 0);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}
function dayLabel(ds) {
  if (ds === formatDate(today())) return 'Today';
  if (ds === formatDate(addDays(today(), -1))) return 'Yesterday';
  return ds;
}
