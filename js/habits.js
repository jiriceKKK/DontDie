import { BUILT_IN_HABITS } from './constants.js';
import { state } from './state.js';
import { formatDate, today, addDays, getMondayOfWeek, getNDaysAgo, parseDate } from './utils/date.js';
import { getBuiltinOverride, getCustomMeta } from './habitConfig.js';

// ---- scheduling -----------------------------------------------------------
// A habit's schedule. Falls back to the legacy `days` array (daily if it covers
// all 7 days, otherwise specific weekdays) so existing habits keep working.
//   { type: 'daily' }
//   { type: 'weekdays', days: [0..6] }
//   { type: 'interval', everyN: N, start: 'YYYY-MM-DD' }
export function scheduleOf(habit) {
  if (habit && habit.schedule && habit.schedule.type) return habit.schedule;
  const days = Array.isArray(habit && habit.days) ? habit.days : [0, 1, 2, 3, 4, 5, 6];
  if (days.length >= 7) return { type: 'daily' };
  return { type: 'weekdays', days };
}

// Is this habit scheduled on `date`? Interval habits land every N days from a
// start date; unscheduled days are simply not counted (never "missed").
export function isScheduledOn(habit, date) {
  const s = scheduleOf(habit);
  if (s.type === 'daily') return true;
  if (s.type === 'interval') {
    const n = Math.max(1, Math.round(Number(s.everyN) || 1));
    const start = s.start ? parseDate(s.start) : null;
    if (!start || isNaN(start.getTime())) return false;
    const d0 = new Date(date); d0.setHours(0, 0, 0, 0);
    const st = new Date(start); st.setHours(0, 0, 0, 0);
    if (d0 < st) return false;
    const diff = Math.round((d0.getTime() - st.getTime()) / 86400000);
    return diff % n === 0;
  }
  const days = Array.isArray(s.days) ? s.days : [];
  return days.includes(date.getDay());
}

// ---- effective definitions (merge overrides / meta, keep stable ids) -------
function effectiveBuiltin(h) {
  const o = getBuiltinOverride(h.id);
  return o ? { ...h, ...o, _builtin: true } : { ...h, _builtin: true };
}
function effectiveCustom(c) {
  const m = getCustomMeta(c.id) || {};
  const tags = Array.isArray(m.tags) ? m.tags : [];
  return {
    id: c.id, name: c.name, days: c.days, color: c.color, active: c.active,
    category: m.category || 'custom',
    schedule: m.schedule || undefined,
    stimLink: m.stimLink || undefined,
    tags,
    icon: m.icon || '✦',
    label: tags.length ? tags.join(' · ') : '',  // no more "Custom · Custom"
    _custom: true,
  };
}

// Look up a single habit (built-in or custom) as its effective definition.
export function findEffectiveHabit(id) {
  const b = BUILT_IN_HABITS.find(h => h.id === id);
  if (b) return effectiveBuiltin(b);
  const c = state.customHabits.find(h => h.id === id);
  if (c) return effectiveCustom(c);
  return null;
}

// Every visible/active habit (built-ins not hidden + active customs), merged.
export function getAllActiveHabits() {
  return [
    ...BUILT_IN_HABITS.filter(h => !state.hiddenBuiltins.has(h.id)).map(effectiveBuiltin),
    ...state.customHabits.filter(h => h.active).map(effectiveCustom),
  ];
}

export function getHabitsForDate(date) {
  return getAllActiveHabits().filter(h => isScheduledOn(h, date));
}

export function getLogsForDate(dateStr) {
  return state.logsByDate[dateStr] || {};
}

export function isCompleted(dateStr, habitId) {
  return !!(getLogsForDate(dateStr)[habitId]);
}

export function getDayStats(date) {
  const habits = getHabitsForDate(date);
  const logs   = getLogsForDate(formatDate(date));
  return { total: habits.length, completed: habits.filter(h => logs[h.id]).length };
}

export function computeStreak() {
  const todayStr   = formatDate(today());
  let currentDate  = new Date(today());

  const todayHabits = getHabitsForDate(today());
  const todayLogs   = getLogsForDate(todayStr);
  const todayDone   = todayHabits.some(h => todayLogs[h.id]);

  if (!todayDone) currentDate = addDays(today(), -1);

  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const dStr   = formatDate(currentDate);
    const habits = getHabitsForDate(currentDate);
    if (habits.length === 0) { currentDate = addDays(currentDate, -1); continue; }
    const logs   = getLogsForDate(dStr);
    if (!habits.some(h => logs[h.id])) break;
    streak++;
    currentDate = addDays(currentDate, -1);
  }
  return streak;
}

export function computeLongestStreak() {
  const end   = today();
  const start = getNDaysAgo(365);
  let longest = 0, current = 0;
  let d = new Date(start);

  while (d <= end) {
    const dStr   = formatDate(d);
    const habits = getHabitsForDate(d);
    if (habits.length === 0) { d = addDays(d, 1); continue; }
    const logs   = getLogsForDate(dStr);
    if (habits.some(h => logs[h.id])) {
      current++;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
    d = addDays(d, 1);
  }
  return longest;
}

export function computeHabitStreak(habitId) {
  const habit = findEffectiveHabit(habitId);
  if (!habit) return 0;

  let d = new Date(today());
  const todayScheduled = isScheduledOn(habit, today());
  const todayDone      = isCompleted(formatDate(today()), habitId);
  if (todayScheduled && !todayDone) d = addDays(d, -1);

  let streak = 0;
  for (let i = 0; i < 365; i++) {
    if (!isScheduledOn(habit, d)) { d = addDays(d, -1); continue; }
    if (!isCompleted(formatDate(d), habitId)) break;
    streak++;
    d = addDays(d, -1);
  }
  return streak;
}

export function getWeeklyStats(numWeeks) {
  const result     = [];
  const todayDate  = today();
  const monday     = getMondayOfWeek(todayDate);

  for (let w = numWeeks - 1; w >= 0; w--) {
    const weekStart      = addDays(monday, -w * 7);
    let totalScheduled   = 0, totalCompleted = 0;

    for (let d = 0; d < 7; d++) {
      const date = addDays(weekStart, d);
      if (date > todayDate) break;
      const habits = getHabitsForDate(date);
      totalScheduled  += habits.length;
      const logs = getLogsForDate(formatDate(date));
      totalCompleted  += habits.filter(h => logs[h.id]).length;
    }

    const pct     = totalScheduled > 0 ? Math.round((totalCompleted / totalScheduled) * 100) : 0;
    const weekNum = numWeeks - w;
    result.push({ label: `W${weekNum}`, pct, completed: totalCompleted, scheduled: totalScheduled, weekStart });
  }
  return result;
}

export function getHabitWeeklyData(habit, numWeeks) {
  const todayDate = today();
  const monday    = getMondayOfWeek(todayDate);
  const result    = [];

  for (let w = numWeeks - 1; w >= 0; w--) {
    const weekStart         = addDays(monday, -w * 7);
    let scheduled = 0, completed = 0;

    for (let d = 0; d < 7; d++) {
      const date = addDays(weekStart, d);
      if (date > todayDate) break;
      if (!isScheduledOn(habit, date)) continue;
      scheduled++;
      if (isCompleted(formatDate(date), habit.id)) completed++;
    }

    const pct = scheduled > 0 ? Math.round((completed / scheduled) * 100) : 0;
    result.push({ label: `W${numWeeks - w}`, pct, completed, scheduled });
  }
  return result;
}
