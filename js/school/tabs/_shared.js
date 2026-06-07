// Shared building blocks for the School tabs: the session card markup, the
// delegated action handler (copy / done / skip / paste result), and the
// APP_RESULT paste modal. Kept here so Dashboard and Plan render identical
// cards and never duplicate the wiring.

import { openModal, closeModal } from '../../ui/modal.js';
import { showToast } from '../../ui/toast.js';
import { esc, copyToClipboard } from '../util.js';
import { sessionType, isScored } from '../sessionTypes.js';
import {
  findSession, findTest, decorateTest, subjectName, subjectColor,
  promptForSession, markSessionDone, skipSession, addResultFromText,
  getTests,
} from '../store.js';

export const RISK_LABEL = { low: 'Low risk', medium: 'Medium risk', high: 'High risk' };

function topicLine(arr) {
  if (!Array.isArray(arr) || !arr.length) return '';
  const shown = arr.slice(0, 3).join(', ');
  return arr.length > 3 ? `${shown} +${arr.length - 3}` : shown;
}

// One planned/done/skipped session as an action card.
export function sessionCardHtml(session, { showDate = false } = {}) {
  if (!session) return '';
  const st = sessionType(session.sessionType);
  const test = decorateTest(findTest(session.testId));
  const subj = subjectName(session.subjectId);
  const color = subjectColor(session.subjectId);
  const du = test && Number.isFinite(test._daysUntil) ? test._daysUntil : null;
  const duPill = du == null ? '' : `<span class="school-pill">test in ${du}d</span>`;
  const riskPill = test ? `<span class="school-pill risk-${test._risk}">${RISK_LABEL[test._risk]}</span>` : '';
  const scored = isScored(session.sessionType);
  const done = session.status === 'done';
  const skipped = session.status === 'skipped';
  const topics = topicLine(session.targetTopics);

  const actions = (done || skipped)
    ? `<div class="school-card-actions">
         <button class="btn btn-ghost school-btn" data-school-action="copy" data-sid="${session.id}">Copy prompt</button>
         ${scored && !session.resultId ? `<button class="btn btn-ghost school-btn" data-school-action="paste" data-sid="${session.id}">Paste result</button>` : ''}
       </div>`
    : `<div class="school-card-actions">
         <button class="btn btn-primary school-btn" data-school-action="copy" data-sid="${session.id}">Copy prompt</button>
         <button class="btn btn-ghost school-btn" data-school-action="done" data-sid="${session.id}">Mark done</button>
         ${scored ? `<button class="btn btn-ghost school-btn" data-school-action="paste" data-sid="${session.id}">Paste result</button>` : ''}
         <button class="btn btn-ghost school-btn" data-school-action="skip" data-sid="${session.id}">Skip</button>
       </div>`;

  return `
    <div class="school-session-card ${done ? 'is-done' : ''} ${skipped ? 'is-skipped' : ''}" style="--subject-color:${color}">
      <div class="school-card-top">
        <div class="school-card-headline">
          <span class="school-subject">${esc(subj)}</span>
          <span class="school-dot">·</span>
          <span class="school-stype" style="color:${st.color}">${esc(st.label)}</span>
        </div>
        <span class="school-min">${session.minutes}m</span>
      </div>
      <div class="school-card-meta">
        ${showDate ? `<span class="school-pill">${esc(session.date)}</span>` : ''}
        ${duPill}${riskPill}
        ${done ? '<span class="school-pill ok">done</span>' : ''}${skipped ? '<span class="school-pill">skipped</span>' : ''}
      </div>
      ${session.reason ? `<div class="school-reason">${esc(session.reason)}</div>` : ''}
      ${topics ? `<div class="school-targets">Targets: ${esc(topics)}</div>` : ''}
      ${actions}
    </div>`;
}

// Delegated handler — attach once to a persistent container. `rerender` is
// called after any state change so the tab refreshes.
export function bindSchoolActions(container, rerender) {
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-school-action]');
    if (!btn) return;
    const sid = btn.dataset.sid;
    const action = btn.dataset.schoolAction;
    if (action === 'copy') {
      const text = promptForSession(sid);
      if (!text) { showToast('Could not build prompt', 'error'); return; }
      copyToClipboard(text).then(ok => showToast(ok ? 'Prompt copied.' : 'Copy failed — select & copy manually', ok ? 'success' : 'error'));
    } else if (action === 'done') {
      markSessionDone(sid); showToast('Marked done', 'success'); rerender();
    } else if (action === 'skip') {
      skipSession(sid); showToast('Session skipped'); rerender();
    } else if (action === 'paste') {
      const s = findSession(sid);
      openResultModal({ sessionId: sid, testId: s ? s.testId : null, onDone: rerender });
    }
  });
}

// APP_RESULT paste modal. opts: { sessionId?, testId?, onDone }.
// When neither id is given, shows a test picker (or auto-detect).
export function openResultModal({ sessionId = null, testId = null, onDone } = {}) {
  const active = getTests('active');
  const picker = (!sessionId && !testId && active.length > 1)
    ? `<div class="form-group"><label class="form-label">Link to test</label>
        <select class="form-input" id="res-test">
          <option value="">Auto-detect from result</option>
          ${active.map(t => `<option value="${t.id}">${esc(t.title)} · ${esc(subjectName(t.subjectId))}</option>`).join('')}
        </select></div>`
    : '';

  openModal(`
    <p class="school-modal-help">Paste the <code>APP_RESULT … END_APP_RESULT</code> block Claude printed at the end of a scored session.</p>
    ${picker}
    <textarea class="form-input school-area" id="res-text" rows="9" placeholder="APP_RESULT
subject: ...
session_type: mixed_quiz
score_percent: 74
weak_topics: ...
END_APP_RESULT"></textarea>
    <div id="res-error" class="school-import-err" style="display:none;"></div>
    <div class="modal-actions">
      <button type="button" class="btn btn-ghost" id="res-cancel">Cancel</button>
      <button type="button" class="btn btn-primary" id="res-import">Import result</button>
    </div>`, 'Paste APP_RESULT');

  const errEl = document.getElementById('res-error');
  document.getElementById('res-cancel').addEventListener('click', closeModal);
  document.getElementById('res-import').addEventListener('click', () => {
    const text = document.getElementById('res-text').value;
    const pick = document.getElementById('res-test');
    const chosenTest = testId || (pick && pick.value) || null;
    const r = addResultFromText(text, { sessionId, testId: chosenTest });
    if (!r.ok) {
      errEl.style.display = 'block';
      errEl.textContent = '✗ ' + r.error;
      return;
    }
    closeModal();
    const linked = r.testId ? '' : ' (not linked to a test)';
    showToast('Result imported' + linked, 'success');
    if (onDone) onDone();
  });
}
