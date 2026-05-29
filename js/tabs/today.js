import { state } from '../state.js';
import { CATEGORY_COLORS, CATEGORY_LABELS, DAY_FULL, MONTH_NAMES } from '../constants.js';
import { formatDate, today, addDays, isSameDay, parseDate, friendlyDay } from '../utils/date.js';
import { getHabitsForDate, getLogsForDate, isCompleted, getDayStats, computeStreak } from '../habits.js';
import { dbUpsertLog } from '../db.js';
import { queueSync, setOnline, startRetryInterval } from '../sync.js';
import { showToast } from '../ui/toast.js';
import { openModal, closeModal } from '../ui/modal.js';
import { launchConfetti } from '../ui/confetti.js';
import { updateProgressRing } from '../ui/progress.js';

// toggleHabit lives here (not in habits.js) because it calls renderTodayHabits,
// which would create a circular import if it were in a shared module.
export async function toggleHabit(dateStr, habitId, currentState) {
  const newValue = !currentState;

  if (!state.logsByDate[dateStr]) state.logsByDate[dateStr] = {};
  state.logsByDate[dateStr][habitId] = newValue;

  if (dateStr === formatDate(today())) {
    renderTodayHabits(today());
    updateProgressRing(today());
  }

  const { error } = await dbUpsertLog(dateStr, habitId, newValue);

  if (error) {
    state.logsByDate[dateStr][habitId] = currentState;
    if (dateStr === formatDate(today())) {
      renderTodayHabits(today());
      updateProgressRing(today());
    }
    queueSync(dateStr, habitId, newValue);
    setOnline(false);
    showToast('Sync failed — will retry', 'error');
    startRetryInterval();
  }
}

export function renderToday(date) {
  const panel   = document.getElementById('tab-today');
  const dateStr = formatDate(date);
  const isToday = isSameDay(date, today());
  const dayName = DAY_FULL[date.getDay()];
  const monthDay = `${MONTH_NAMES[date.getMonth()]} ${date.getDate()}`;
  const streak  = computeStreak();

  panel.innerHTML = `
    <div class="today-header">
      <div class="today-date">
        <div class="today-day">${dayName}</div>
        <div class="today-dateline">${monthDay}</div>
      </div>
      <div class="today-meta">
        ${streak > 0 ? `
          <div class="streak-badge" id="streak-badge">
            🔥 <span class="streak-num" id="streak-num">${streak}</span>
            <span style="font-size:11px;color:var(--text-muted)">day${streak !== 1 ? 's' : ''}</span>
          </div>
        ` : ''}
        <div class="progress-ring-wrap">
          <svg width="52" height="52" viewBox="0 0 52 52">
            <circle class="progress-ring-bg" cx="26" cy="26" r="20"/>
            <circle class="progress-ring-fill" id="progress-ring-fill" cx="26" cy="26" r="20"
              stroke-dasharray="125.66" stroke-dashoffset="125.66"/>
          </svg>
          <div class="progress-ring-text" id="progress-ring-text">0/0</div>
        </div>
      </div>
    </div>

    <div id="habit-list-container"></div>

    ${isToday ? `
      <button class="log-past-btn" id="log-past-btn">↩ Log a past day</button>
    ` : ''}
  `;

  updateProgressRing(date);
  renderTodayHabits(date);

  if (isToday) {
    document.getElementById('log-past-btn').addEventListener('click', openLogPastDayModal);
  }
}

export function renderTodayHabits(date) {
  const dateStr  = formatDate(date);
  const habits   = getHabitsForDate(date);
  const logs     = getLogsForDate(dateStr);
  const container = document.getElementById('habit-list-container');
  if (!container) return;

  const incomplete = habits.filter(h => !logs[h.id]);
  const complete   = habits.filter(h =>  logs[h.id]);
  const sorted     = [...incomplete, ...complete];

  if (habits.length === 0) {
    container.innerHTML = `
      <div class="rest-day-label">Rest Day</div>
      <div class="all-done-msg">
        <span class="all-done-emoji">😴</span>
        No habits scheduled today. Enjoy the rest.
      </div>
    `;
    return;
  }

  const allDone = incomplete.length === 0;

  let html = `<div class="habit-list">`;
  for (const habit of sorted) {
    const done  = !!logs[habit.id];
    const color = habit.color || CATEGORY_COLORS[habit.category] || 'var(--accent)';
    html += `
      <div class="habit-card ${done ? 'completed' : ''}" data-habit="${habit.id}" data-date="${dateStr}">
        <div class="habit-card-left">
          <div class="cat-dot" style="background:${color}"></div>
          <div class="habit-info">
            <div class="habit-name">${habit.name}</div>
            <div class="habit-category">${CATEGORY_LABELS[habit.category] || habit.category}${habit.label ? ' · ' + habit.label : ''}</div>
          </div>
        </div>
        <div class="habit-check" id="check-${habit.id}">
          <svg class="habit-check-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>
      </div>
    `;
  }
  html += `</div>`;

  if (allDone && complete.length > 0) {
    html += `
      <div class="all-done-msg">
        <span class="all-done-emoji">🎯</span>
        All done today!
      </div>
    `;
  }

  container.innerHTML = html;

  container.querySelectorAll('.habit-card').forEach(card => {
    card.addEventListener('click', () => {
      const habitId = card.dataset.habit;
      const dStr    = card.dataset.date;
      const current = isCompleted(dStr, habitId);

      const check = card.querySelector('.habit-check');
      check.classList.add('pulse');
      check.addEventListener('animationend', () => check.classList.remove('pulse'), { once: true });

      toggleHabit(dStr, habitId, current).then(() => {
        const d = parseDate(dStr);
        const { total, completed } = getDayStats(d);
        if (total > 0 && completed === total) launchConfetti();
        updateProgressRing(d);
      });
    });
  });
}

export function openLogPastDayModal() {
  const days = [];
  for (let i = 1; i <= 7; i++) days.push(addDays(today(), -i));

  let html = `<div class="past-day-picker">`;
  for (const d of days) {
    const habits = getHabitsForDate(d);
    const logs   = getLogsForDate(formatDate(d));
    const done   = habits.filter(h => logs[h.id]).length;
    const dStr   = formatDate(d);
    html += `
      <button class="past-day-btn" data-date="${dStr}">
        <span>${friendlyDay(d)}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}</span>
        <span class="past-day-date">${habits.length > 0 ? `${done}/${habits.length}` : 'No habits'}</span>
      </button>
    `;
  }
  html += `</div>`;

  openModal(html, 'Log Past Day');

  document.querySelectorAll('.past-day-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const dateStr = btn.dataset.date;
      closeModal();
      openDayLogModal(parseDate(dateStr));
    });
  });
}

export function openDayLogModal(date) {
  const dateStr = formatDate(date);
  const habits  = getHabitsForDate(date);
  const label   = `${DAY_FULL[date.getDay()]}, ${MONTH_NAMES[date.getMonth()]} ${date.getDate()}`;

  if (habits.length === 0) {
    openModal('<p style="color:var(--text-muted);text-align:center;padding:16px;">No habits scheduled this day.</p>', label);
    return;
  }

  const renderHabitRows = () => habits.map(habit => {
    const done  = isCompleted(dateStr, habit.id);
    const color = habit.color || CATEGORY_COLORS[habit.category] || 'var(--accent)';
    return `
      <div class="habit-card ${done ? 'completed' : ''}" data-habit="${habit.id}" data-date="${dateStr}" style="margin-bottom:8px;">
        <div class="habit-card-left">
          <div class="cat-dot" style="background:${color}"></div>
          <div class="habit-info">
            <div class="habit-name">${habit.name}</div>
            <div class="habit-category">${CATEGORY_LABELS[habit.category] || habit.category}</div>
          </div>
        </div>
        <div class="habit-check" id="modal-check-${habit.id}">
          <svg class="habit-check-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>
      </div>
    `;
  }).join('');

  const refreshModalBody = () => {
    const body = document.querySelector('.modal-body');
    if (body) body.innerHTML = renderHabitRows();
    attachModalHabitHandlers();
  };

  const attachModalHabitHandlers = () => {
    document.querySelectorAll('.modal-body .habit-card').forEach(card => {
      card.addEventListener('click', () => {
        const habitId = card.dataset.habit;
        const dStr    = card.dataset.date;
        const current = isCompleted(dStr, habitId);
        toggleHabit(dStr, habitId, current).then(refreshModalBody);
      });
    });
  };

  openModal(renderHabitRows(), label);
  attachModalHabitHandlers();
}
