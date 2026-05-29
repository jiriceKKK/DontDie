import { DAY_NAMES, DAY_FULL, MONTH_NAMES } from '../constants.js';
import { formatDate, today, addDays, getMondayOfWeek, isSameDay, parseDate } from '../utils/date.js';
import { getDayStats } from '../habits.js';
import { openDayLogModal } from './today.js';

export function renderWeek() {
  const panel     = document.getElementById('tab-week');
  const todayDate = today();
  const monday    = getMondayOfWeek(todayDate);

  let gridHtml = `<div class="week-grid">`;
  let weekCompleted = 0, weekTotal = 0;
  let bestDay = null, bestPct = -1;

  for (let i = 0; i < 7; i++) {
    const date    = addDays(monday, i);
    const dateStr = formatDate(date);
    const isFuture = date > todayDate;
    const isToday  = isSameDay(date, todayDate);
    const { total, completed } = getDayStats(date);

    if (!isFuture) {
      weekCompleted += completed;
      weekTotal     += total;
      const pct = total > 0 ? completed / total : 0;
      if (pct > bestPct) { bestPct = pct; bestDay = date; }
    }

    const fillPct  = total > 0 ? (completed / total) * 100 : 0;
    const colClass = `week-day-col${isToday ? ' today' : ''}${isFuture ? ' future' : ''}`;

    gridHtml += `
      <div class="${colClass}" data-date="${dateStr}">
        <div class="week-day-header">
          <div class="week-day-name">${DAY_NAMES[date.getDay()]}</div>
          <div class="week-day-num">${date.getDate()}</div>
        </div>
        <div class="week-day-body">
          <div class="week-fraction">${isFuture ? '—' : `${completed}/${total}`}</div>
          <div class="week-mini-bar">
            <div class="week-mini-bar-fill" style="width:${isFuture ? 0 : fillPct}%"></div>
          </div>
        </div>
      </div>
    `;
  }
  gridHtml += `</div>`;

  const weekPct     = weekTotal > 0 ? Math.round((weekCompleted / weekTotal) * 100) : 0;
  const bestDayName = bestDay ? DAY_FULL[bestDay.getDay()] : '—';
  const bestStats   = bestDay ? getDayStats(bestDay) : { completed: 0, total: 0 };

  panel.innerHTML = `
    ${gridHtml}
    <div class="week-summary-bar">
      <div class="week-summary-stat">
        This week: <strong>${weekCompleted}/${weekTotal} habits · ${weekPct}%</strong>
      </div>
      ${bestDay ? `<div class="week-summary-best">Best: ${bestDayName} (${bestStats.completed}/${bestStats.total})</div>` : ''}
    </div>
  `;

  panel.querySelectorAll('.week-day-col:not(.future)').forEach(col => {
    col.addEventListener('click', () => openDayLogModal(parseDate(col.dataset.date)));
  });
}
