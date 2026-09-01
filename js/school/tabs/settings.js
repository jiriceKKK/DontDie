import { openModal, closeModal } from '../../ui/modal.js';
import { showToast } from '../../ui/toast.js';
import { esc } from '../util.js';
import { safeColor } from '../../ui/dom.js';
import {
  getSettings, updateSettings, resetSchool,
  getSubjects, findSubject, addSubject, updateSubject, deleteSubject,
  getTests,
} from '../store.js';

export function renderSchoolSettings() {
  const panel = document.getElementById('tab-settings');
  if (!panel) return;
  const s = getSettings();
  const subjects = getSubjects(true);

  panel.innerHTML = `
    <div class="mh-header"><div class="mh-title">Settings</div><div class="mh-subtitle">Planner & subjects</div></div>

    <div class="card">
      <form id="school-set-form" class="settings-form" style="margin-bottom:0;">
        <div class="form-row">
          <div class="form-group"><label class="form-label">Default session (min)</label>
            <input class="form-input" id="ss-len" type="number" inputmode="numeric" min="5" max="120" step="5" value="${s.defaultSessionMinutes}"></div>
          <div class="form-group"><label class="form-label">Max study / day (min)</label>
            <input class="form-input" id="ss-max" type="number" inputmode="numeric" min="10" max="600" step="10" value="${s.maxStudyMinutesPerDay}"></div>
        </div>
        <div class="form-group"><label class="form-label">Default worst acceptable grade</label>
          <select class="form-input" id="ss-worst">
            ${[1, 2, 3, 4, 5].map(g => `<option value="${g}" ${g === s.defaultWorstAcceptableGrade ? 'selected' : ''}>${g}</option>`).join('')}
          </select></div>
        <label class="edit-check"><input type="checkbox" id="ss-weekends" ${s.useWeekends ? 'checked' : ''}> Schedule sessions on weekends</label>
        <label class="edit-check"><input type="checkbox" id="ss-auto" ${s.autoRescheduleAfterResult ? 'checked' : ''}> Auto-adjust plan after a pasted result</label>
        <button type="submit" class="btn btn-primary" style="width:100%;">Save settings</button>
      </form>
    </div>

    <div class="section-title">Subjects</div>
    <button class="btn btn-primary" id="subj-add" style="width:100%;margin-bottom:10px;">+ Add subject</button>
    ${subjects.length ? `<div class="school-subj-list">
      ${subjects.map(su => `
        <button class="school-subj-row ${su.archived ? 'archived' : ''}" data-subj="${su.id}">
          <span class="school-subj-dot" style="background:${safeColor(su.color)}"></span>
          <span class="school-subj-name">${esc(su.name)}${su.archived ? ' · archived' : ''}</span>
          <span class="school-subj-meta">diff ${su.defaultDifficulty}/5</span>
        </button>`).join('')}
    </div>` : `<div class="mh-empty" style="text-align:left;">No subjects yet. Add one to start creating tests.</div>`}

    <div class="section-title">Data</div>
    <div class="card data-actions">
      <button class="btn btn-danger" id="school-reset" style="width:100%;justify-content:flex-start;">Reset school data</button>
    </div>

    <div class="mh-empty" style="text-align:left;font-size:12px;">
      The app never calls an AI. It builds copy-paste prompts for Claude and parses the APP_RESULT you paste back.
    </div>
  `;

  panel.querySelector('#school-set-form').addEventListener('submit', (e) => {
    e.preventDefault();
    updateSettings({
      defaultSessionMinutes: parseInt(panel.querySelector('#ss-len').value),
      maxStudyMinutesPerDay: parseInt(panel.querySelector('#ss-max').value),
      defaultWorstAcceptableGrade: parseInt(panel.querySelector('#ss-worst').value),
      useWeekends: panel.querySelector('#ss-weekends').checked,
      autoRescheduleAfterResult: panel.querySelector('#ss-auto').checked,
    });
    showToast('Settings saved', 'success');
  });

  panel.querySelector('#subj-add').addEventListener('click', () => openSubjectModal(null));
  panel.querySelectorAll('[data-subj]').forEach(b => b.addEventListener('click', () => openSubjectModal(b.dataset.subj)));

  panel.querySelector('#school-reset').addEventListener('click', () => {
    openModal(`
      <p style="color:var(--text-secondary);font-size:14px;margin-bottom:20px;">
        This permanently deletes all subjects, tests, sessions and results. This cannot be undone.
      </p>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="sr-cancel">Cancel</button>
        <button class="btn btn-danger" id="sr-confirm">Reset all</button>
      </div>`, 'Reset school data?');
    document.getElementById('sr-cancel').addEventListener('click', closeModal);
    document.getElementById('sr-confirm').addEventListener('click', () => {
      resetSchool(); closeModal(); showToast('School data reset'); renderSchoolSettings();
    });
  });
}

const PALETTE = ['#38bdf8', '#34d399', '#f59e0b', '#f472b6', '#a78bfa', '#fb923c', '#22d3ee', '#facc15'];

function openSubjectModal(id) {
  const editing = !!id;
  const su = editing ? findSubject(id) : null;
  if (editing && !su) return;
  const v = su || { name: '', color: PALETTE[getSubjects(true).length % PALETTE.length], defaultDifficulty: 3, archived: false };

  openModal(`
    <form id="subj-form" class="settings-form" style="margin-bottom:0;">
      <div class="form-group"><label class="form-label">Name</label>
        <input class="form-input" id="su-name" type="text" maxlength="40" value="${esc(v.name)}" placeholder="e.g. History, Math, Biology"></div>
      <div class="form-group"><label class="form-label">Colour</label>
        <div class="school-swatches" id="su-swatches">
          ${PALETTE.map(c => `<button type="button" class="school-swatch ${c === v.color ? 'active' : ''}" data-color="${c}" style="background:${c}"></button>`).join('')}
        </div></div>
      <div class="form-group"><label class="form-label">Default difficulty (1–5)</label>
        <input class="form-input" id="su-diff" type="number" inputmode="numeric" min="1" max="5" value="${v.defaultDifficulty}"></div>
      ${editing ? `<label class="edit-check"><input type="checkbox" id="su-arch" ${v.archived ? 'checked' : ''}> Archived (hidden from new tests)</label>` : ''}
      <div class="modal-actions">
        ${editing ? `<button type="button" class="btn btn-danger" id="su-del">Delete</button>` : ''}
        <button type="submit" class="btn btn-primary">${editing ? 'Save' : 'Add'}</button>
      </div>
    </form>`, editing ? 'Edit subject' : 'Add subject');

  let chosen = v.color;
  document.querySelectorAll('#su-swatches .school-swatch').forEach(b => b.addEventListener('click', () => {
    chosen = b.dataset.color;
    document.querySelectorAll('#su-swatches .school-swatch').forEach(x => x.classList.toggle('active', x === b));
  }));

  document.getElementById('subj-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('su-name').value.trim();
    if (!name) { showToast('Enter a name', 'warning'); return; }
    const patch = {
      name, color: chosen,
      defaultDifficulty: parseInt(document.getElementById('su-diff').value),
    };
    if (editing) {
      const archEl = document.getElementById('su-arch');
      if (archEl) patch.archived = archEl.checked;
      updateSubject(id, patch);
    } else addSubject(patch);
    closeModal(); renderSchoolSettings();
  });

  const del = document.getElementById('su-del');
  if (del) del.addEventListener('click', () => {
    const used = getTests('all').some(t => t.subjectId === id);
    if (used) { showToast('Subject is used by a test — archive it instead', 'warning'); return; }
    deleteSubject(id); closeModal(); showToast('Subject deleted'); renderSchoolSettings();
  });
}
