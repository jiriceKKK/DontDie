import { JOURNAL_TEMPLATES, getTemplate } from '../journalTemplates.js';
import { addJournal, listJournal, getJournal, deleteJournal } from '../store.js';
import { openModal, closeModal } from '../../ui/modal.js';
import { showToast } from '../../ui/toast.js';
import { MONTH_NAMES } from '../../constants.js';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function prettyDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
}

export function renderJournal() {
  const panel = document.getElementById('tab-journal');
  if (!panel) return;
  const entries = listJournal();

  panel.innerHTML = `
    <div class="mh-header">
      <div class="mh-title">Journal</div>
      <div class="mh-subtitle">Guided templates</div>
    </div>

    <div class="mh-template-grid">
      ${JOURNAL_TEMPLATES.map(t => `
        <button class="mh-template" data-tpl="${t.id}">
          <div class="mh-template-name">${esc(t.name)}</div>
          <div class="mh-template-blurb">${esc(t.blurb)}</div>
        </button>`).join('')}
    </div>

    <div class="section-title" style="margin-top:24px;">Entries</div>
    ${entries.length === 0 ? `<div class="mh-empty">No entries yet. Pick a template above.</div>` : `
      <div class="mh-entry-list">
        ${entries.map(entryRow).join('')}
      </div>`}
  `;

  panel.querySelectorAll('.mh-template').forEach(b => b.addEventListener('click', () => openEntryModal(b.dataset.tpl)));
  panel.querySelectorAll('.mh-entry').forEach(el => el.addEventListener('click', () => openViewModal(el.dataset.id)));
}

function entryRow(j) {
  const tpl = getTemplate(j.type);
  const firstField = tpl && tpl.fields[0];
  const preview = firstField && j.fields[firstField.key] ? j.fields[firstField.key] : '';
  return `
    <div class="mh-entry" data-id="${j.id}">
      <div class="mh-entry-main">
        <div class="mh-entry-type">${esc(tpl ? tpl.name : j.type)}</div>
        ${preview ? `<div class="mh-entry-preview">${esc(preview)}</div>` : ''}
      </div>
      <div class="mh-entry-date">${prettyDate(j.date)}</div>
    </div>`;
}

function fieldInput(f, value = '') {
  if (f.type === 'area') {
    return `<textarea class="form-input mh-area" id="jf-${f.key}" rows="3" placeholder="${esc(f.placeholder || '')}">${esc(value)}</textarea>`;
  }
  return `<input class="form-input" id="jf-${f.key}" type="text" value="${esc(value)}" placeholder="${esc(f.placeholder || '')}">`;
}

function openEntryModal(tplId) {
  const tpl = getTemplate(tplId);
  if (!tpl) return;
  const html = `
    <form id="journal-form" class="settings-form" style="margin-bottom:0;">
      ${tpl.fields.map(f => `
        <div class="form-group">
          <label class="form-label">${esc(f.label)}</label>
          ${fieldInput(f)}
        </div>`).join('')}
      <button type="submit" class="btn btn-primary" style="width:100%;">Save entry</button>
    </form>`;
  openModal(html, tpl.name);

  document.getElementById('journal-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fields = {};
    let any = false;
    for (const f of tpl.fields) {
      const el = document.getElementById('jf-' + f.key);
      const v = (el.value || '').trim();
      fields[f.key] = v;
      if (v) any = true;
    }
    if (!any) { showToast('Write something first', 'warning'); return; }
    addJournal(tpl.id, fields);
    closeModal();
    showToast('Entry saved', 'success');
    renderJournal();
  });
}

function openViewModal(id) {
  const j = getJournal(id);
  if (!j) return;
  const tpl = getTemplate(j.type);
  const rows = (tpl ? tpl.fields : Object.keys(j.fields).map(k => ({ key: k, label: k }))).map(f => {
    const v = j.fields[f.key];
    if (!v) return '';
    return `<div class="mh-view-field"><div class="mh-view-label">${esc(f.label)}</div><div class="mh-view-val">${esc(v)}</div></div>`;
  }).join('');

  openModal(`
    <div class="mh-view-date">${prettyDate(j.date)}</div>
    ${rows || '<div class="mh-empty">Empty entry.</div>'}
    <button class="btn btn-danger" id="journal-del" style="width:100%;margin-top:16px;">Delete entry</button>
  `, tpl ? tpl.name : j.type);

  document.getElementById('journal-del').addEventListener('click', () => {
    deleteJournal(id);
    closeModal();
    renderJournal();
  });
}
