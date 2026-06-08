import { formatDate, today, parseDate } from '../../utils/date.js';
import { switchTab } from '../../navigation.js';
import { esc } from '../util.js';
import { getSchool, getTests } from '../store.js';
import { sessionCardHtml, bindSchoolActions, openAddSessionModal } from './_shared.js';

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function prettyDate(dateStr) {
  const d = parseDate(dateStr);
  if (!d || isNaN(d.getTime())) return dateStr;
  const todayStr = formatDate(today());
  if (dateStr === todayStr) return 'Today';
  if (dateStr === formatDate(new Date(today().getTime() + 86400000))) return 'Tomorrow';
  return `${WEEKDAY[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
}

export function renderSchoolPlan() {
  const panel = document.getElementById('tab-plan');
  if (!panel) return;

  const header = `<div class="mh-header"><div class="mh-title">Plan</div><div class="mh-subtitle">Your generated study sessions</div></div>`;
  const addBar = `<button class="school-add-top" data-add-session="${formatDate(today())}">+ Add extra session</button>`;

  if (getTests('active').length === 0) {
    panel.innerHTML = header + `
      <div class="card mh-card" style="text-align:center;">
        <div class="mh-empty" style="padding:14px 8px;">No plan yet — add a test and sessions appear here, grouped by date.</div>
        <button class="btn btn-primary" data-go="tests" style="width:100%;">Add a test</button>
      </div>`;
    wire(panel);
    return;
  }

  const todayStr = formatDate(today());
  const sessions = getSchool().sessions.slice();

  // Overdue (planned, before today) first, then everything today-or-later by date.
  const overdue = sessions.filter(s => s.status === 'planned' && s.date < todayStr)
    .sort((a, b) => a.date.localeCompare(b.date));
  const upcoming = sessions.filter(s => s.date >= todayStr)
    .sort((a, b) => a.date.localeCompare(b.date) || b.minutes - a.minutes);

  // Group upcoming by date.
  const groups = new Map();
  for (const s of upcoming) {
    if (!groups.has(s.date)) groups.set(s.date, []);
    groups.get(s.date).push(s);
  }

  let body = '';
  if (overdue.length) {
    body += `<div class="section-title school-overdue-title">Overdue</div>`;
    body += overdue.map(s => sessionCardHtml(s, { showDate: true })).join('');
  }
  if (groups.size === 0 && overdue.length === 0) {
    body += `<div class="mh-empty">No upcoming sessions. Open Tests to add or adjust a test.</div>`;
  }
  for (const [date, list] of groups) {
    const mins = list.filter(s => s.status === 'planned').reduce((sum, s) => sum + s.minutes, 0);
    body += `<div class="section-title school-day-head">
        <span>${prettyDate(date)}</span>
        <span class="school-day-head-right">
          ${mins ? `<span class="school-day-min">${mins} min</span>` : ''}
          <button class="school-add-day" data-add-session="${date}" aria-label="Add session to ${prettyDate(date)}">+</button>
        </span>
      </div>`;
    body += list.map(s => sessionCardHtml(s)).join('');
  }

  panel.innerHTML = header + addBar + body;
  wire(panel);
}

function wire(panel) {
  if (panel.dataset.schoolBound) return;
  panel.dataset.schoolBound = '1';
  bindSchoolActions(panel, renderSchoolPlan);
  panel.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add-session]');
    if (add) { openAddSessionModal({ date: add.dataset.addSession, onDone: renderSchoolPlan }); return; }
    const go = e.target.closest('[data-go]');
    if (go) switchTab(go.dataset.go);
  });
}
