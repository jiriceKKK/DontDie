import { BUILT_IN_HABITS } from './constants.js';
import { state } from './state.js';
import { formatDate, today, addDays, getMondayOfWeek, getNDaysAgo } from './utils/date.js';

export function getHabitsForDate(date) {
  const dow = date.getDay();
  const builtins = BUILT_IN_HABITS.filter(h =>
    h.days.includes(dow) && !state.hiddenBuiltins.has(h.id)
  );
  const customs = state.customHabits.filter(h => h.active && h.days.includes(dow));
  return [
    ...builtins,
    ...customs.map(c => ({
      id: c.id, name: c.name, days: c.days, category: 'custom',
      icon: '✦', label: 'Custom', color: c.color,
    })),
  ];
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
  const habit = [...BUILT_IN_HABITS, ...state.customHabits].find(h => h.id === habitId);
  if (!habit) return 0;

  let d = new Date(today());
  const todayScheduled = habit.days.includes(today().getDay());
  const todayDone      = isCompleted(formatDate(today()), habitId);
  if (todayScheduled && !todayDone) d = addDays(d, -1);

  let streak = 0;
  for (let i = 0; i < 365; i++) {
    if (!habit.days.includes(d.getDay())) { d = addDays(d, -1); continue; }
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
      if (!habit.days.includes(date.getDay())) continue;
      scheduled++;
      if (isCompleted(formatDate(date), habit.id)) completed++;
    }

    const pct = scheduled > 0 ? Math.round((completed / scheduled) * 100) : 0;
    result.push({ label: `W${numWeeks - w}`, pct, completed, scheduled });
  }
  return result;
}
