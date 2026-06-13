import { state } from '../state.js';
import { BUILT_IN_HABITS, CATEGORY_COLORS, DAY_FULL, MONTH_NAMES } from '../constants.js';
import { formatDate, today, addDays, getMondayOfWeek } from '../utils/date.js';
import {
  getHabitsForDate, getLogsForDate, isCompleted,
  computeStreak, computeLongestStreak, computeHabitStreak,
  getWeeklyStats, getHabitWeeklyData,
  getAllActiveHabits, isScheduledOn, scheduleOf,
} from '../habits.js';
import { openModal } from '../ui/modal.js';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DOW2 = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
function schedText(habit) {
  const s = scheduleOf(habit);
  if (s.type === 'daily') return 'Every day';
  if (s.type === 'interval') return `Every ${Math.max(1, Math.round(Number(s.everyN) || 1))} days`;
  const order = [1, 2, 3, 4, 5, 6, 0];
  const days = (s.days || []).slice().sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return days.length === 7 ? 'Every day' : days.map(d => DOW2[d]).join(' ') || '—';
}
// Completion over [from, from+span) days ago, schedule-aware: { sched, done, rate }.
function windowRate(habit, from, span) {
  let sched = 0, done = 0;
  for (let i = from; i < from + span; i++) {
    const d = addDays(today(), -i);
    if (!isScheduledOn(habit, d)) continue;
    sched++;
    if (isCompleted(formatDate(d), habit.id)) done++;
  }
  return { sched, done, rate: sched > 0 ? Math.round((done / sched) * 100) : null };
}

export function renderStats() {
  const panel = document.getElementById('tab-stats');
  panel.innerHTML = `
    <div class="pill-nav" id="stats-pill-nav">
      <button class="pill-btn ${state.statsSection === 'overview'  ? 'active' : ''}" data-section="overview">Overview</button>
      <button class="pill-btn ${state.statsSection === 'activity'  ? 'active' : ''}" data-section="activity">Activity</button>
      <button class="pill-btn ${state.statsSection === 'insights'  ? 'active' : ''}" data-section="insights">Insights</button>
    </div>
    <div id="stats-content"></div>
  `;

  panel.querySelectorAll('.pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.statsSection = btn.dataset.section;
      panel.querySelectorAll('.pill-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.section === state.statsSection)
      );
      renderStatsSection(state.statsSection);
    });
  });

  renderStatsSection(state.statsSection);
}

function renderStatsSection(section) {
  const container = document.getElementById('stats-content');
  if (!container) return;
  if (section === 'overview')  renderStatsOverview(container);
  else if (section === 'activity') renderStatsActivity(container);
  else if (section === 'insights') renderStatsInsights(container);
}

function renderStatsOverview(container) {
  const isMobile     = window.innerWidth < 480;
  const heatmapWeeks = isMobile ? 8 : 12;
  const weeklyData   = getWeeklyStats(8);
  const streak       = computeStreak();
  const longest      = computeLongestStreak();

  container.innerHTML = `
    <div class="chart-card">
      <div class="chart-title">Weekly Completion (last 8 weeks)</div>
      <div class="chart-svg-wrap">${renderBarChartSVG(weeklyData)}</div>
    </div>

    <div class="streak-card" style="margin-bottom:16px;">
      <div class="streak-big-num">${streak >= 7 ? '🔥' : ''} ${streak}</div>
      <div class="streak-card-info">
        <div class="streak-card-label">day streak</div>
        <div class="streak-card-sub">Longest: ${longest} days</div>
      </div>
    </div>

    <div class="chart-card">
      <div class="chart-title">Activity — last ${heatmapWeeks} weeks</div>
      <div class="heatmap-wrap">${renderHeatmapSVG(heatmapWeeks)}</div>
    </div>
  `;
}

function renderBarChartSVG(weeklyData) {
  const W = 300, H = 110;
  const barCount = weeklyData.length;
  const barW     = Math.floor(W / barCount) - 6;
  const maxBarH  = 72;
  const labelY   = H - 4;
  const pctY     = 10;

  let bars = '', labels = '', pcts = '';

  weeklyData.forEach((week, i) => {
    const barH      = Math.max(week.pct > 0 ? 4 : 0, (week.pct / 100) * maxBarH);
    const x         = i * (W / barCount) + 3;
    const y         = H - barH - 20;
    const isCurrent = i === barCount - 1;
    const fill      = isCurrent ? 'var(--accent)' : 'var(--accent-dim)';
    const opacity   = isCurrent ? '1' : '0.55';

    bars   += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="3" fill="${fill}" opacity="${opacity}"/>`;
    labels += `<text x="${x + barW/2}" y="${labelY}" text-anchor="middle" font-size="9" fill="var(--text-muted)" font-family="'DM Mono',monospace">${week.label}</text>`;
    if (week.pct > 0) {
      pcts += `<text x="${x + barW/2}" y="${Math.max(y - 3, pctY)}" text-anchor="middle" font-size="9" fill="${isCurrent ? 'var(--accent)' : 'var(--text-muted)'}" font-family="'DM Mono',monospace">${week.pct}%</text>`;
    }
  });

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    ${bars}${pcts}${labels}
  </svg>`;
}

function renderHeatmapSVG(numWeeks) {
  const cell = 12, gap = 2, step = cell + gap;
  const todayDate   = today();
  const monday      = getMondayOfWeek(todayDate);
  const startMonday = addDays(monday, -(numWeeks - 1) * 7);

  const W = numWeeks * step;
  const H = 7 * step + 18;

  let cells = '', monthLabels = '';
  let lastMonth = -1;

  for (let w = 0; w < numWeeks; w++) {
    const weekMonday = addDays(startMonday, w * 7);
    const monthNum   = weekMonday.getMonth();

    if (monthNum !== lastMonth) {
      lastMonth = monthNum;
      monthLabels += `<text x="${w * step}" y="${H - 2}" font-size="9" fill="var(--text-muted)" font-family="'DM Mono',monospace">${MONTH_NAMES[monthNum]}</text>`;
    }

    for (let d = 0; d < 7; d++) {
      const date    = addDays(weekMonday, d);
      const isFuture = date > todayDate;
      const dateStr = formatDate(date);
      let fill = 'var(--bg-elevated)';

      if (!isFuture) {
        const habits = getHabitsForDate(date);
        if (habits.length > 0) {
          const logs = getLogsForDate(dateStr);
          const done = habits.filter(h => logs[h.id]).length;
          const pct  = done / habits.length;
          if      (pct === 0)      fill = 'var(--bg-elevated)';
          else if (pct < 0.34)     fill = '#1a3d30';
          else if (pct < 0.67)     fill = '#34d399';
          else if (pct < 1)        fill = '#6ee7b7';
          else                     fill = '#a7f3d0';
        }
      }

      cells += `<rect x="${w * step}" y="${d * step}" width="${cell}" height="${cell}" rx="2" fill="${fill}" data-date="${dateStr}">
        <title>${dateStr}: ${(() => {
          if (isFuture) return 'Future';
          const habits = getHabitsForDate(date);
          if (!habits.length) return 'No habits';
          const logs = getLogsForDate(dateStr);
          return `${habits.filter(h => logs[h.id]).length}/${habits.length} completed`;
        })()}</title>
      </rect>`;
    }
  }

  const dayLetters = ['M','T','W','T','F','S','S'];
  let dayLabels = '';
  for (let d = 0; d < 7; d++) {
    if (d % 2 === 0) {
      dayLabels += `<text x="-14" y="${d * step + cell - 1}" font-size="9" fill="var(--text-muted)" font-family="'DM Mono',monospace">${dayLetters[d]}</text>`;
    }
  }

  return `<svg width="${W + 16}" height="${H}" viewBox="-16 0 ${W + 16} ${H}" xmlns="http://www.w3.org/2000/svg">
    ${dayLabels}${cells}${monthLabels}
  </svg>`;
}

function renderStatsActivity(container) {
  const allHabits = getAllActiveHabits();

  const rows = allHabits.map(habit => {
    const cur = windowRate(habit, 0, 30);
    const prev = windowRate(habit, 30, 30);
    const rate = cur.rate;
    const color = habit.color || CATEGORY_COLORS[habit.category] || 'var(--accent)';
    const chip = rate == null ? '<span class="stat-chip muted">no data</span>'
      : rate >= 80 ? '<span class="stat-chip good">strong</span>'
      : rate >= 50 ? '<span class="stat-chip">steady</span>'
      : '<span class="stat-chip warn">low</span>';
    let trend = '';
    if (rate != null && prev.rate != null) {
      const d = rate - prev.rate;
      if (d >= 8) trend = '<span class="activity-trend up">▲</span>';
      else if (d <= -8) trend = '<span class="activity-trend down">▼</span>';
    }
    return `
      <div class="activity-habit-row" data-habit="${habit.id}">
        <div class="cat-dot" style="background:${color}"></div>
        <div class="activity-habit-body">
          <div class="activity-habit-top">
            <span class="activity-habit-name">${esc(habit.name)}</span>
            <span class="activity-habit-rate">${rate !== null ? rate + '%' : '—'} ${trend}</span>
          </div>
          <div class="stat-bar"><div class="stat-bar-fill" style="width:${rate || 0}%;background:${color}"></div></div>
          <div class="activity-habit-meta"><span>${esc(schedText(habit))}</span>${chip}</div>
        </div>
        <svg class="activity-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </div>`;
  }).join('');

  container.innerHTML = `<div class="activity-habit-list">${rows || '<p style="color:var(--text-muted);padding:16px;">No habits yet.</p>'}</div>`;

  container.querySelectorAll('.activity-habit-row').forEach(row => {
    row.addEventListener('click', () => {
      const habit = allHabits.find(h => h.id === row.dataset.habit);
      if (habit) openActivityDetail(habit);
    });
  });
}

function openActivityDetail(habit) {
  const color = habit.color || CATEGORY_COLORS[habit.category] || 'var(--accent)';

  let sched30 = 0, done30 = 0, missedMonth = 0;
  for (let i = 0; i < 30; i++) {
    const d = addDays(today(), -i);
    if (!isScheduledOn(habit, d)) continue;
    sched30++;
    if (isCompleted(formatDate(d), habit.id)) done30++;
    else missedMonth++;
  }
  const rate30     = sched30 > 0 ? Math.round((done30 / sched30) * 100) : null;
  const streak     = computeHabitStreak(habit.id);
  const weeklyData = getHabitWeeklyData(habit, 8);

  const html = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;">
      <div class="cat-dot" style="background:${color};width:12px;height:12px;"></div>
      <div style="font-size:16px;font-weight:600;">${habit.name}</div>
    </div>
    <div class="activity-detail">
      <div class="activity-detail-stat">
        <span class="activity-detail-label">Last 4 weeks</span>
        <span class="activity-detail-value">${rate30 !== null ? rate30 + '%' : '—'}</span>
      </div>
      <div class="activity-detail-stat">
        <span class="activity-detail-label">Current streak</span>
        <span class="activity-detail-value">${streak} day${streak !== 1 ? 's' : ''}</span>
      </div>
      <div class="activity-detail-stat">
        <span class="activity-detail-label">Missed this month</span>
        <span class="activity-detail-value">${missedMonth} time${missedMonth !== 1 ? 's' : ''}</span>
      </div>
    </div>
    <div style="margin-top:16px;">
      <div class="chart-title">8-week completion</div>
      <div class="chart-svg-wrap">${renderBarChartSVG(weeklyData)}</div>
    </div>
  `;

  openModal(html, habit.name);
}

function renderStatsInsights(container) {
  const insights = generateInsights();
  if (insights.length === 0) {
    container.innerHTML = `<p style="color:var(--text-muted);padding:16px;text-align:center;">Log some habits to see insights.</p>`;
    return;
  }
  const html = insights.map(text => `
    <div class="insight-item">
      <div class="insight-bullet"></div>
      <div>${text}</div>
    </div>
  `).join('');
  container.innerHTML = `<div class="insights-list">${html}</div>`;
}

function generateInsights() {
  const insights   = [];
  const allHabits  = getAllActiveHabits();

  const habitStats = allHabits.map(habit => {
    const w = windowRate(habit, 0, 30);
    return { habit, sched: w.sched, done: w.done, rate: w.rate };
  }).filter(s => s.rate !== null);

  const sorted = [...habitStats].sort((a, b) => Math.abs(b.rate - 50) - Math.abs(a.rate - 50));

  for (const { habit, rate } of sorted.slice(0, 2)) {
    insights.push(`You complete ${habit.name} on ${rate}% of scheduled days`);
  }

  const dayStats = [0,1,2,3,4,5,6].map(dow => {
    let total = 0, done = 0;
    for (let i = 0; i < 30; i++) {
      const d = addDays(today(), -i);
      if (d.getDay() !== dow) continue;
      const habits = getHabitsForDate(d);
      if (!habits.length) continue;
      total += habits.length;
      const logs = getLogsForDate(formatDate(d));
      done += habits.filter(h => logs[h.id]).length;
    }
    const pct = total > 0 ? Math.round((done / total) * 100) : null;
    return { dow, pct, total };
  }).filter(d => d.total > 0 && d.pct !== null);

  if (dayStats.length > 0) {
    const weakest = dayStats.reduce((a, b) => a.pct < b.pct ? a : b);
    insights.push(`Your weakest day is ${DAY_FULL[weakest.dow]} (avg ${weakest.pct}%)`);
  }

  const mondayOfThisWeek = getMondayOfWeek(today());
  let perfectDays = 0;
  for (let d = 0; d < 7; d++) {
    const date = addDays(mondayOfThisWeek, d);
    if (date > today()) break;
    const habits = getHabitsForDate(date);
    if (!habits.length) continue;
    const logs = getLogsForDate(formatDate(date));
    if (habits.every(h => logs[h.id])) perfectDays++;
  }
  if (perfectDays > 0) {
    insights.push(`You've hit 100% on ${perfectDays} day${perfectDays !== 1 ? 's' : ''} this week`);
  }

  for (const { habit } of sorted.slice(0, 2)) {
    const s = computeHabitStreak(habit.id);
    if (s >= 2) insights.push(`${habit.name}: ${s} sessions in a row ${s >= 4 ? '🔥' : ''}`);
  }

  return insights.slice(0, 6);
}
