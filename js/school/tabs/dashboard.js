import { formatDate, today } from '../../utils/date.js';
import { switchTab } from '../../navigation.js';
import { esc } from '../util.js';
import {
  todaySessions, missedSessions, plannedMinutesForDate, getTests, decorateTest,
  subjectName, getSubjects, rescheduleSession,
} from '../store.js';
import { sessionCardHtml, bindSchoolActions } from './_shared.js';
import { showToast } from '../../ui/toast.js';

export function renderSchoolDashboard() {
  const panel = document.getElementById('tab-dashboard');
  if (!panel) return;

  const dateStr = formatDate(today());
  const sessions = todaySessions();
  const planned = sessions.filter(s => s.status !== 'done');
  const totalMin = plannedMinutesForDate(dateStr);
  const tests = getTests('active').map(decorateTest)
    .sort((a, b) => (a._daysUntil ?? 9999) - (b._daysUntil ?? 9999));
  const missed = missedSessions();
  const noSubjects = getSubjects().length === 0;
  const noTests = getTests('active').length === 0;

  const header = `<div class="mh-header">
    <div class="mh-title">What should I study today?</div>
    <div class="mh-subtitle">${dateStr}${totalMin ? ` · ${totalMin} min planned` : ''}</div>
  </div>`;

  // First-run empty state.
  if (noSubjects && noTests) {
    panel.innerHTML = header + `
      <div class="card mh-card" style="text-align:center;">
        <div class="mh-empty" style="padding:14px 8px;">No tests yet. Add a subject and an upcoming test, and the planner builds your study sessions.</div>
        <button class="btn btn-primary" data-go="tests" style="width:100%;">Add a test</button>
      </div>`;
    wire(panel);
    return;
  }

  const missedHtml = missed.length ? `
    <div class="card school-missed">
      <div class="school-missed-row">
        <span>${missed.length} missed session${missed.length === 1 ? '' : 's'}</span>
        <button class="btn btn-ghost school-btn" data-school-bump="all">Move to today</button>
      </div>
    </div>` : '';

  const todayHtml = planned.length
    ? planned.map(s => sessionCardHtml(s)).join('')
    : `<div class="mh-empty" style="text-align:left;">No sessions scheduled for today.${noTests ? '' : ' You\'re on track — open Plan to see what\'s next.'}</div>`;

  const doneToday = sessions.filter(s => s.status === 'done').length;

  const testsHtml = tests.length ? `
    <div class="section-title">Upcoming tests</div>
    <div class="school-test-strip">
      ${tests.slice(0, 6).map(t => {
        const du = t._daysUntil;
        const when = du == null ? 'no date' : du < 0 ? 'past' : du === 0 ? 'today' : `${du}d`;
        return `<button class="school-test-mini" data-go-test="${t.id}">
          <div class="school-test-mini-top"><span>${esc(t.title)}</span><span class="school-pill risk-${t._risk}">${when}</span></div>
          <div class="school-test-mini-sub">${esc(subjectName(t.subjectId))} · readiness ${t._readiness}%</div>
          <div class="school-readiness"><div class="school-readiness-fill risk-${t._risk}" style="width:${t._readiness}%"></div></div>
        </button>`;
      }).join('')}
    </div>` : '';

  panel.innerHTML = header + missedHtml + `
    <div class="section-title">Today${doneToday ? ` · ${doneToday} done` : ''}</div>
    ${todayHtml}
    ${testsHtml}
  `;
  wire(panel);
}

// Bind delegated handlers once per panel ELEMENT (survives innerHTML rewrites;
// re-binds if the mode controller rebuilds the panel).
function wire(panel) {
  if (panel.dataset.schoolBound) return;
  panel.dataset.schoolBound = '1';
  bindSchoolActions(panel, renderSchoolDashboard);
  panel.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (go) { switchTab(go.dataset.go); return; }
    const goTest = e.target.closest('[data-go-test]');
    if (goTest) { switchTab('tests'); return; }
    const bump = e.target.closest('[data-school-bump]');
    if (bump) {
      const todayStr = formatDate(today());
      missedSessions().forEach(s => rescheduleSession(s.id, todayStr));
      showToast('Moved missed sessions to today', 'success');
      renderSchoolDashboard();
    }
  });
}
