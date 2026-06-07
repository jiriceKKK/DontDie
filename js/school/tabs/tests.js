import { state } from '../../state.js';
import { formatDate, today, addDays } from '../../utils/date.js';
import { openModal, closeModal } from '../../ui/modal.js';
import { showToast } from '../../ui/toast.js';
import { switchTab } from '../../navigation.js';
import { esc, parseTopics } from '../util.js';
import {
  getTests, findTest, addTest, updateTest, deleteTest, setTestStatus,
  decorateTest, getSubjects, subjectName, subjectColor, sessionsForTest,
} from '../store.js';
import { RISK_LABEL } from './_shared.js';

const GRADE_HELP = {
  1: 'Need an excellent result — high pressure, more sessions.',
  2: 'Need a good result — fairly high priority.',
  3: 'Normal priority.',
  4: 'Low pressure — lighter plan.',
  5: 'Very low pressure — just pass.',
};

export function renderSchoolTests() {
  const panel = document.getElementById('tab-tests');
  if (!panel) return;

  const filter = state.schoolTestFilter || 'active';
  const subjects = getSubjects();
  const tests = getTests(filter === 'all' ? 'all' : filter).map(decorateTest)
    .sort((a, b) => (a._daysUntil ?? 9999) - (b._daysUntil ?? 9999));

  const header = `<div class="mh-header"><div class="mh-title">Tests</div><div class="mh-subtitle">Add and manage upcoming tests</div></div>`;
  const pills = `<div class="pill-nav school-filter">
      ${['active', 'completed', 'archived'].map(f =>
        `<button class="pill-btn ${filter === f ? 'active' : ''}" data-filter="${f}">${f[0].toUpperCase() + f.slice(1)}</button>`).join('')}
    </div>`;
  const addBtn = `<button class="btn btn-primary" id="test-add" style="width:100%;margin-bottom:14px;">+ Add test</button>`;

  let listHtml;
  if (tests.length === 0) {
    listHtml = subjects.length === 0
      ? `<div class="mh-empty">Add a subject first (Settings → Subjects), then create a test.</div>`
      : `<div class="mh-empty">No ${filter} tests.</div>`;
  } else {
    listHtml = tests.map(t => {
      const du = t._daysUntil;
      const when = du == null ? 'no date' : du < 0 ? 'past' : du === 0 ? 'today' : `in ${du}d`;
      const weak = t.weakTopics && t.weakTopics.length ? `<div class="school-test-weak">Weak: ${esc(t.weakTopics.slice(0, 4).join(', '))}</div>` : '';
      return `
        <button class="school-test-card" data-edit="${t.id}" style="--subject-color:${subjectColor(t.subjectId)}">
          <div class="school-test-card-top">
            <div class="school-test-card-title">${esc(t.title)}</div>
            <span class="school-pill risk-${t._risk}">${RISK_LABEL[t._risk]}</span>
          </div>
          <div class="school-test-card-sub">${esc(subjectName(t.subjectId))} · ${esc(t.testDate || 'no date')} · ${when}</div>
          <div class="school-readiness"><div class="school-readiness-fill risk-${t._risk}" style="width:${t._readiness}%"></div></div>
          <div class="school-test-card-foot">
            <span>readiness ${t._readiness}%</span>
            <span>worst grade: ${t.worstAcceptableGrade}${t.lastScore != null ? ` · last ${t.lastScore}%` : ''}</span>
          </div>
          ${weak}
        </button>`;
    }).join('');
  }

  panel.innerHTML = header + pills + addBtn + listHtml;

  panel.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => {
    state.schoolTestFilter = b.dataset.filter;
    renderSchoolTests();
  }));
  const add = panel.querySelector('#test-add');
  if (add) add.addEventListener('click', () => openTestModal(null));
  panel.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openTestModal(b.dataset.edit)));
}

function subjectOptions(sel) {
  return getSubjects().map(s => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
}
function gradeOptions(sel) {
  return [1, 2, 3, 4, 5].map(g => `<option value="${g}" ${g === sel ? 'selected' : ''}>${g} — ${GRADE_HELP[g]}</option>`).join('');
}

function openTestModal(id) {
  const editing = !!id;
  const t = editing ? findTest(id) : null;
  if (editing && !t) return;
  if (getSubjects().length === 0) { showToast('Add a subject first (Settings)', 'warning'); return; }

  const def = {
    subjectId: getSubjects()[0].id, title: '', topics: [],
    testDate: formatDate(addDays(today(), 14)),
    worstAcceptableGrade: state.school.settings.defaultWorstAcceptableGrade,
    targetGrade: 1, importance: 3, notes: '',
  };
  const v = t || def;
  const dec = t ? decorateTest(t) : null;

  openModal(`
    <form id="test-form" class="settings-form" style="margin-bottom:0;">
      <div class="form-group"><label class="form-label">Subject</label>
        <select class="form-input" id="t-subject">${subjectOptions(v.subjectId)}</select></div>
      <div class="form-group"><label class="form-label">Title</label>
        <input class="form-input" id="t-title" type="text" maxlength="60" value="${esc(v.title)}" placeholder="e.g. WWII unit test"></div>
      <div class="form-group"><label class="form-label">Topics (comma-separated)</label>
        <input class="form-input" id="t-topics" type="text" value="${esc((v.topics || []).join(', '))}" placeholder="causes, key dates, treaties"></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Test date</label>
          <input class="form-input" id="t-date" type="date" value="${esc(v.testDate || '')}"></div>
        <div class="form-group"><label class="form-label">Importance</label>
          <input class="form-input" id="t-importance" type="number" inputmode="numeric" min="1" max="5" value="${v.importance}"></div>
      </div>
      <div class="form-group">
        <label class="form-label">Worst grade you'd accept</label>
        <select class="form-input" id="t-worst">${gradeOptions(v.worstAcceptableGrade)}</select>
        <div class="school-field-help">The worst grade you can get while still keeping the result you want. Lower = more pressure = a denser plan.</div>
      </div>
      <div class="form-group"><label class="form-label">Notes (optional)</label>
        <input class="form-input" id="t-notes" type="text" maxlength="120" value="${esc(v.notes || '')}" placeholder="format, weighting, teacher hints…"></div>
      ${dec ? `<div class="school-field-help">Readiness ${dec._readiness}% · ${RISK_LABEL[dec._risk]} · ${sessionsForTest(id).filter(s => s.status === 'planned').length} planned sessions${dec._daysUntil != null ? ` · ${dec._daysUntil} days left` : ''}.</div>` : ''}
      <div class="modal-actions">
        ${editing ? `<button type="button" class="btn btn-danger" id="t-delete">Delete</button>` : ''}
        <button type="submit" class="btn btn-primary">${editing ? 'Save' : 'Add test'}</button>
      </div>
      ${editing ? `<div class="school-test-manage">
        <button type="button" class="btn btn-ghost school-btn" id="t-complete">${t.status === 'completed' ? 'Reopen' : 'Mark completed'}</button>
        <button type="button" class="btn btn-ghost school-btn" id="t-archive">${t.status === 'archived' ? 'Unarchive' : 'Archive'}</button>
        <button type="button" class="btn btn-ghost school-btn" id="t-plan">View plan</button>
      </div>` : ''}
    </form>`, editing ? 'Edit test' : 'Add test');

  document.getElementById('test-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const data = {
      subjectId: document.getElementById('t-subject').value,
      title: document.getElementById('t-title').value.trim(),
      topics: parseTopics(document.getElementById('t-topics').value),
      testDate: document.getElementById('t-date').value || null,
      worstAcceptableGrade: parseInt(document.getElementById('t-worst').value),
      importance: parseInt(document.getElementById('t-importance').value),
      notes: document.getElementById('t-notes').value.trim(),
    };
    if (!data.title) { showToast('Enter a title', 'warning'); return; }
    if (!data.testDate) { showToast('Pick a test date', 'warning'); return; }
    if (editing) updateTest(id, data); else addTest(data);
    closeModal();
    showToast(editing ? 'Test saved' : 'Test added — plan generated', 'success');
    renderSchoolTests();
  });

  const del = document.getElementById('t-delete');
  if (del) del.addEventListener('click', () => {
    deleteTest(id); closeModal(); showToast('Test deleted'); renderSchoolTests();
  });
  const comp = document.getElementById('t-complete');
  if (comp) comp.addEventListener('click', () => {
    setTestStatus(id, t.status === 'completed' ? 'active' : 'completed');
    closeModal(); renderSchoolTests();
  });
  const arch = document.getElementById('t-archive');
  if (arch) arch.addEventListener('click', () => {
    setTestStatus(id, t.status === 'archived' ? 'active' : 'archived');
    closeModal(); renderSchoolTests();
  });
  const plan = document.getElementById('t-plan');
  if (plan) plan.addEventListener('click', () => { closeModal(); switchTab('plan'); });
}
