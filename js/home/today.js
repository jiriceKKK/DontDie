// ============================================================
// HOME · TODAY — the global command center. Action-first: habits, tasks, a
// compact stimulation status + fast logging, today's study sessions and
// training, and a check-in nudge. It aggregates read-only via home/data.js and
// reuses each module's own write functions (toggleHabit, toggleTask, sessions)
// so no data logic is duplicated or changed.
// ============================================================

import { formatDate, today } from '../utils/date.js';
import { DAY_FULL, MONTH_NAMES, CATEGORY_COLORS, CATEGORY_LABELS } from '../constants.js';
import { isCompleted } from '../habits.js';
import { toggleHabit } from '../tabs/today.js';
import { addTask, toggleTask, deleteTask } from '../mental/store.js';
import { sessionCardHtml, bindSchoolActions } from '../school/tabs/_shared.js';
import { goTo } from '../modes/go.js';
import { openQuickLog } from './quicklog.js';
import { safeColor } from '../ui/dom.js';
import {
  habitSummary, taskSummary, stimSummary, splitToday, schoolToday, checkinToday, whatMatters,
  currentBlockLabel,
} from './data.js';

const MOODS = ['😞', '🙁', '😐', '🙂', '😄'];
const r1 = n => Math.round(n * 10) / 10;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function statusPill(status) {
  if (status === 'within') return '<span class="home-pill ok">On target</span>';
  if (status === 'above') return '<span class="home-pill warn">Above target</span>';
  return '<span class="home-pill">Below target</span>';
}

export function renderHomeToday() {
  const panel = document.getElementById('tab-today');
  if (!panel) return;
  const date = today();
  const dateStr = formatDate(date);

  const h = habitSummary(date);
  const t = taskSummary(dateStr);
  const stim = stimSummary(dateStr);
  const school = schoolToday();
  const split = splitToday(date);
  const checkin = checkinToday(dateStr);
  const matters = whatMatters();

  // ---- header ----
  const header = `
    <div class="home-header">
      <div>
        <div class="home-hello">Today</div>
        <div class="home-date">${DAY_FULL[date.getDay()]}, ${MONTH_NAMES[date.getMonth()]} ${date.getDate()}</div>
      </div>
      <div class="home-habit-count">
        <span class="home-habit-num">${h.completed}/${h.total || 0}</span>
        <span class="home-habit-lbl">habits</span>
      </div>
    </div>
    <div class="home-matters">${matters.length ? matters.map(m => `<span class="home-matters-chip">${esc(m)}</span>`).join('') : '<span class="home-matters-clear">You\'re on top of today ✓</span>'}</div>`;

  // ---- quick actions ----
  const quick = `
    <div class="home-quick">
      <button class="home-quick-btn" data-q="log"><span class="home-quick-ic">⚡</span>Log stim</button>
      <button class="home-quick-btn" data-q="task"><span class="home-quick-ic">＋</span>Task</button>
      <button class="home-quick-btn" data-q="checkin"><span class="home-quick-ic">◎</span>Check-in</button>
      <button class="home-quick-btn" data-q="split"><span class="home-quick-ic">🏋</span>Training</button>
    </div>`;

  // ---- stimulation card ----
  const tgt = stim.target ? `${r1(stim.target.lo)}–${r1(stim.target.hi)}` : '–';
  const stimCard = `
    <div class="card home-stim">
      <div class="home-stim-top">
        <div class="home-stim-main">
          <div class="home-stim-label">Cheap Stim today</div>
          <div class="home-stim-score">${stim.hasData ? r1(stim.cheap) : '–'}</div>
        </div>
        <div class="home-stim-side">
          ${stim.hasData ? statusPill(stim.status) : '<span class="home-pill">No logs yet</span>'}
          <div class="home-stim-sub">target ${tgt}${stim.hasData && stim.baseline ? ` · base ${r1(stim.baseline)}` : ''}</div>
          <div class="home-stim-sub">productive ${r1(stim.productive)}</div>
        </div>
      </div>
      <div class="home-stim-actions">
        <button class="btn btn-primary home-stim-log" data-q="log">⚡ Log ${esc(currentBlockLabel())}</button>
        <button class="btn btn-ghost home-stim-dash" data-q="dashboard">Dashboard</button>
      </div>
    </div>`;

  // ---- habits ----
  let habitsHtml;
  if (h.restDay) {
    habitsHtml = `<div class="home-rest">😴 Rest day — no habits scheduled.</div>`;
  } else {
    const incomplete = h.habits.filter(x => !h.logs[x.id]);
    const complete = h.habits.filter(x => h.logs[x.id]);
    habitsHtml = `<div class="home-habit-list">${[...incomplete, ...complete].map(habit => {
      const done = !!h.logs[habit.id];
      const color = habit.color || CATEGORY_COLORS[habit.category] || 'var(--accent)';
      return `
        <div class="habit-card ${done ? 'completed' : ''}" data-home-habit="${esc(habit.id)}">
          <div class="habit-card-left">
            <div class="cat-dot" style="background:${safeColor(color)}"></div>
            <div class="habit-info">
              <div class="habit-name">${esc(habit.name)}</div>
              <div class="habit-category">${esc(CATEGORY_LABELS[habit.category] || habit.category)}${habit.label ? ' · ' + esc(habit.label) : ''}</div>
            </div>
          </div>
          <div class="habit-check">
            <svg class="habit-check-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
        </div>`;
    }).join('')}</div>`;
  }
  const habitsSection = `
    <div class="home-section-head"><span>Habits</span><span class="home-section-sub">${h.completed}/${h.total || 0}</span></div>
    ${habitsHtml}`;

  // ---- tasks ----
  const taskRows = t.tasks.length ? t.tasks.map(task => `
    <div class="home-task ${task.done ? 'done' : ''}">
      <button class="home-task-check" data-home-task="${task.id}" aria-label="Toggle">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      </button>
      <span class="home-task-text">${esc(task.text)}</span>
      <button class="home-task-del" data-home-task-del="${task.id}" aria-label="Delete">✕</button>
    </div>`).join('') : `<div class="home-empty-line">No tasks for today.</div>`;
  const tasksSection = `
    <div class="home-section-head"><span>Tasks</span><span class="home-section-sub">${t.done}/${t.total}</span></div>
    <div class="home-task-list">${taskRows}</div>
    <div class="home-task-add">
      <input class="form-input" id="home-task-input" type="text" maxlength="120" placeholder="Add a task for today…" autocomplete="off">
      <button class="btn btn-ghost" data-home-addtask aria-label="Add task">Add</button>
    </div>`;

  // ---- study (school) ----
  let studySection = '';
  if (school.sessions.length) {
    studySection = `
      <div class="home-section-head"><span>Study</span><span class="home-section-sub">${school.sessions.filter(s => s.status === 'done').length}/${school.sessions.length} done</span></div>
      ${school.sessions.map(s => sessionCardHtml(s, { collapsible: true })).join('')}`;
  } else if (school.nextTest) {
    const t2 = school.nextTest;
    const when = t2._daysUntil === 0 ? 'today' : `in ${t2._daysUntil}d`;
    studySection = `
      <div class="home-section-head"><span>Study</span></div>
      <button class="home-nexttest" data-q="school">
        <span>No sessions today · next test ${esc(t2.title)}</span>
        <span class="home-pill risk-${t2._risk}">${when}</span>
      </button>`;
  }

  // ---- training (split) ----
  let trainingSection = '';
  if (split) {
    const line = split.isRest
      ? 'Rest / mobility day'
      : `${split.exercises} exercise${split.exercises === 1 ? '' : 's'} · ${split.sets} sets${split.mobility ? ` · ${split.mobility} mobility` : ''}`;
    trainingSection = `
      <div class="home-section-head"><span>Training</span></div>
      <button class="home-train" data-q="split">
        <span class="home-train-name">${esc(split.name || split.gymTitle || 'Training')}</span>
        <span class="home-train-sub">${esc(line)}</span>
      </button>`;
  }

  // ---- check-in nudge ----
  let checkinSection;
  if (checkin) {
    checkinSection = `
      <button class="home-checkin done" data-q="checkin">
        <span class="home-checkin-emoji">${MOODS[(checkin.mood || 3) - 1] || '😐'}</span>
        <span class="home-checkin-text">Checked in today${typeof checkin.sleepScore === 'number' ? ` · sleep ${checkin.sleepScore}` : ''}</span>
        <span class="home-checkin-edit">Edit</span>
      </button>`;
  } else {
    checkinSection = `
      <button class="home-checkin" data-q="checkin">
        <span class="home-checkin-emoji">◎</span>
        <span class="home-checkin-text">How are you, honestly? Quick check-in</span>
        <span class="home-checkin-edit">Start →</span>
      </button>`;
  }

  panel.innerHTML = `
    ${header}
    ${quick}
    ${stimCard}
    <div class="home-section">${habitsSection}</div>
    <div class="home-section">${tasksSection}</div>
    ${studySection ? `<div class="home-section">${studySection}</div>` : ''}
    ${trainingSection ? `<div class="home-section">${trainingSection}</div>` : ''}
    <div class="home-section">${checkinSection}</div>
  `;

  wire(panel);
}

// Bind once per panel element (survives innerHTML rewrites; delegated).
function wire(panel) {
  if (panel.dataset.homeBound) return;
  panel.dataset.homeBound = '1';
  bindSchoolActions(panel, renderHomeToday);

  panel.addEventListener('click', (e) => {
    const q = e.target.closest('[data-q]');
    if (q) { handleQuick(q.dataset.q); return; }

    const hb = e.target.closest('[data-home-habit]');
    if (hb) {
      const id = hb.dataset.homeHabit;
      const cur = isCompleted(formatDate(today()), id);
      const check = hb.querySelector('.habit-check');
      if (check) { check.classList.add('pulse'); check.addEventListener('animationend', () => check.classList.remove('pulse'), { once: true }); }
      toggleHabit(formatDate(today()), id, cur).then(renderHomeToday);
      return;
    }
    const tk = e.target.closest('[data-home-task]');
    if (tk) { toggleTask(tk.dataset.homeTask); renderHomeToday(); return; }
    const td = e.target.closest('[data-home-task-del]');
    if (td) { deleteTask(td.dataset.homeTaskDel); renderHomeToday(); return; }
    const add = e.target.closest('[data-home-addtask]');
    if (add) { commitTask(panel); return; }
  });

  panel.addEventListener('keydown', (e) => {
    if (e.target.id === 'home-task-input' && e.key === 'Enter') { e.preventDefault(); commitTask(panel); }
  });
}

function commitTask(panel) {
  const input = panel.querySelector('#home-task-input');
  if (!input) return;
  const text = (input.value || '').trim();
  if (!text) { input.focus(); return; }
  addTask(formatDate(today()), text);
  renderHomeToday();
  const again = document.getElementById('home-task-input');
  if (again) again.focus();
}

function handleQuick(q) {
  switch (q) {
    case 'log':       openQuickLog(renderHomeToday); break;
    case 'task':      { const i = document.getElementById('home-task-input'); if (i) i.focus(); break; }
    case 'checkin':   goTo('mental', 'checkin'); break;
    case 'split':     goTo('physical', 'split'); break;
    case 'dashboard': goTo('stimulation', 'dashboard'); break;
    case 'school':    goTo('school', 'tests'); break;
  }
}
