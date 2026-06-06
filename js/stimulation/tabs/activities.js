import { openModal, closeModal } from '../../ui/modal.js';
import { showToast } from '../../ui/toast.js';
import { CATEGORIES, categoryLabel, categoryColor, CATEGORY_IDS } from '../defaultActivities.js';
import {
  getActivities, findActivity, addActivity, updateActivity, deleteActivity,
  parseActivities, importActivities,
} from '../store.js';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const sign = n => (n > 0 ? `+${n}` : `${n}`);

export function renderStimActivities() {
  const panel = document.getElementById('tab-activities');
  if (!panel) return;
  const all = getActivities(true);

  panel.innerHTML = `
    <div class="mh-header">
      <div class="mh-title">Activities</div>
      <div class="mh-subtitle">Your stimulation activity library</div>
    </div>

    <div class="stim-act-actions">
      <button class="btn btn-primary" id="act-add" style="flex:1;">+ Add activity</button>
      <button class="btn btn-ghost" id="act-import" style="flex:1;">Import from text</button>
    </div>

    ${CATEGORIES.map(cat => {
      const items = all.filter(a => a.category === cat.id);
      if (!items.length) return '';
      return `
        <div class="section-title" style="color:${cat.color}">${cat.label}</div>
        <div class="stim-act-list">
          ${items.map(a => `
            <button class="stim-act-row ${a.active === false ? 'inactive' : ''}" data-edit="${a.id}">
              <span class="stim-act-name">${esc(a.name)}${a.active === false ? ' · off' : ''}</span>
              <span class="stim-act-meta">${sign(a.stimulationScore)} · ${a.defaultDurationMinutes}m</span>
            </button>`).join('')}
        </div>`;
    }).join('')}
  `;

  panel.querySelector('#act-add').addEventListener('click', () => openActivityModal(null));
  panel.querySelector('#act-import').addEventListener('click', openImportModal);
  panel.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openActivityModal(b.dataset.edit)));
}

function catOptions(sel) {
  return CATEGORIES.map(c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${c.label}</option>`).join('');
}

function openActivityModal(id) {
  const editing = !!id;
  const a = editing ? findActivity(id) : null;
  if (editing && !a) return;
  const v = a || { name: '', category: 'high_stim', stimulationScore: 4, defaultDurationMinutes: 15, tags: [], active: true };

  openModal(`
    <form id="act-form" class="settings-form" style="margin-bottom:0;">
      <div class="form-group"><label class="form-label">Name</label>
        <input class="form-input" id="af-name" type="text" maxlength="40" value="${esc(v.name)}" placeholder="e.g. Instagram"></div>
      <div class="form-group"><label class="form-label">Category</label>
        <select class="form-input" id="af-cat">${catOptions(v.category)}</select></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Stim score</label>
          <input class="form-input" id="af-score" type="number" inputmode="numeric" value="${v.stimulationScore}" placeholder="-3 to 6"></div>
        <div class="form-group"><label class="form-label">Default min</label>
          <input class="form-input" id="af-dur" type="number" inputmode="numeric" min="1" value="${v.defaultDurationMinutes}"></div>
      </div>
      <div class="form-group"><label class="form-label">Tags</label>
        <input class="form-input" id="af-tags" type="text" value="${esc((v.tags || []).join(', '))}" placeholder="comma,separated"></div>
      <label class="edit-check"><input type="checkbox" id="af-active" ${v.active !== false ? 'checked' : ''}> Active (show when logging)</label>
      <div class="modal-actions">
        ${editing ? `<button type="button" class="btn btn-danger" id="af-del">Delete</button>` : ''}
        <button type="submit" class="btn btn-primary">${editing ? 'Save' : 'Add'}</button>
      </div>
    </form>`, editing ? 'Edit activity' : 'Add activity');

  document.getElementById('act-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('af-name').value.trim();
    if (!name) { showToast('Enter a name', 'warning'); return; }
    const patch = {
      name,
      category: document.getElementById('af-cat').value,
      stimulationScore: parseFloat(document.getElementById('af-score').value),
      defaultDurationMinutes: parseInt(document.getElementById('af-dur').value),
      tags: document.getElementById('af-tags').value.split(',').map(s => s.trim()).filter(Boolean),
      active: document.getElementById('af-active').checked,
    };
    if (editing) updateActivity(id, patch); else addActivity(patch);
    closeModal(); renderStimActivities();
  });
  const del = document.getElementById('af-del');
  if (del) del.addEventListener('click', () => { deleteActivity(id); closeModal(); renderStimActivities(); });
}

function openImportModal() {
  openModal(`
    <div class="mh-stat-line" style="margin-bottom:10px;">Paste one activity per line:<br>
      <code style="font-size:11px;">name | category | score | minutes | tags</code></div>
    <div class="mh-stat-line" style="font-size:12px;color:var(--text-muted);margin-bottom:10px;">categories: ${CATEGORY_IDS.join(' · ')}</div>
    <textarea class="form-input mh-area" id="imp-text" rows="6" placeholder="Instagram | high_stim | 5 | 15 | scrolling,social
Reading | recovery | -2 | 30 | calm"></textarea>
    <div id="imp-preview"></div>
    <div class="modal-actions">
      <button type="button" class="btn btn-ghost" id="imp-preview-btn">Preview</button>
      <button type="button" class="btn btn-primary" id="imp-do" disabled>Import</button>
    </div>`, 'Import activities');

  let parsed = { valid: [], errors: [] };
  const previewEl = document.getElementById('imp-preview');
  const doBtn = document.getElementById('imp-do');

  document.getElementById('imp-preview-btn').addEventListener('click', () => {
    parsed = parseActivities(document.getElementById('imp-text').value);
    const ok = parsed.valid.length;
    previewEl.innerHTML = `
      <div class="stim-import-summary">${ok} valid${parsed.errors.length ? ` · ${parsed.errors.length} error(s)` : ''}</div>
      ${parsed.valid.slice(0, 8).map(v => `<div class="stim-import-ok">✓ ${esc(v.name)} · ${categoryLabel(v.category)} · ${sign(v.stimulationScore)} · ${v.defaultDurationMinutes}m</div>`).join('')}
      ${parsed.errors.map(e => `<div class="stim-import-err">✗ line ${e.line}: ${esc(e.reason)}</div>`).join('')}`;
    doBtn.disabled = ok === 0;
  });

  doBtn.addEventListener('click', () => {
    if (!parsed.valid.length) return;
    const { added, skipped } = importActivities(parsed.valid);
    closeModal();
    showToast(`Imported ${added}${skipped ? ` · skipped ${skipped} duplicate(s)` : ''}`, 'success');
    renderStimActivities();
  });
}
