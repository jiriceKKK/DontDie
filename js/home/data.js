// ============================================================
// HOME DATA — read-only aggregation across modules for the Today command
// center and the Weekly Review. This file ONLY reads existing store APIs and
// derives view-model objects; it never mutates state, never changes any
// calculation, and never persists. Safe to import anywhere (leaf-ish).
// ============================================================

import { state } from '../state.js';
import { formatDate, today, addDays } from '../utils/date.js';
import { getHabitsForDate, getLogsForDate, getDayStats } from '../habits.js';
import { getTasks, getCheckin } from '../mental/store.js';
import {
  dailyMetric, metricTarget, targetStatus, baselineMetricDaily, dayBlocks, hasAnyEntries,
} from '../stimulation/store.js';
import { todaySessions, getTests, decorateTest } from '../school/store.js';

const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

// Index of the block containing the current clock time (mirrors the Log tab's
// own helper; duplicated here so we don't import a tab into a data module).
export function currentBlockIndex() {
  const blocks = dayBlocks();
  if (!blocks.length) return 0;
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const idx = blocks.findIndex(b => cur >= b.startMin && cur < b.endMin);
  if (idx !== -1) return idx;
  return cur < blocks[0].startMin ? 0 : blocks.length - 1;
}

export function currentBlockLabel() {
  const blocks = dayBlocks();
  const b = blocks[currentBlockIndex()];
  return b ? b.label : '';
}

// Habits for a date with completion counts.
export function habitSummary(date = today()) {
  const habits = getHabitsForDate(date);
  const logs = getLogsForDate(formatDate(date));
  const { total, completed } = getDayStats(date);
  return { habits, logs, total, completed, restDay: habits.length === 0 };
}

// Mental tasks for a date string.
export function taskSummary(dateStr = formatDate(today())) {
  const tasks = getTasks(dateStr);
  return { tasks, total: tasks.length, done: tasks.filter(t => t.done).length };
}

// Stimulation status for today: cheap (net) score vs target + baseline, plus
// productive + recovery context. Pure reads — no calc change.
export function stimSummary(dateStr = formatDate(today())) {
  const cheap = num(dailyMetric(dateStr, 'cheap'));
  const productive = num(dailyMetric(dateStr, 'productive'));
  const recovery = num(dailyMetric(dateStr, 'recovery'));
  const target = metricTarget('cheap');
  const status = targetStatus(cheap, target);
  const baseline = num(baselineMetricDaily('cheap'));
  return { cheap, productive, recovery, target, status, baseline, hasData: hasAnyEntries(dateStr) };
}

// Today's training day from the split (or a rest day).
export function splitToday(date = today()) {
  const split = state.split;
  if (!split || !Array.isArray(split.days)) return null;
  const day = split.days.find(d => d.dow === date.getDay());
  if (!day) return null;
  const groups = (day.gym && Array.isArray(day.gym.groups)) ? day.gym.groups : [];
  let sets = 0, exercises = 0;
  for (const g of groups) for (const it of (g.items || [])) { sets += num(it.sets); exercises++; }
  const mobility = (day.mobility && Array.isArray(day.mobility.items)) ? day.mobility.items.length : 0;
  return {
    name: day.name || '',
    isRest: exercises === 0 && mobility === 0,
    exercises, sets, mobility,
    gymTitle: day.gym && day.gym.title ? day.gym.title : (day.name || ''),
  };
}

// Today's school sessions (planned/done) + the next upcoming test as fallback.
export function schoolToday() {
  const sessions = todaySessions();
  const tests = getTests('active').map(decorateTest)
    .filter(t => t._daysUntil != null && t._daysUntil >= 0)
    .sort((a, b) => (a._daysUntil ?? 9999) - (b._daysUntil ?? 9999));
  return { sessions, nextTest: tests[0] || null };
}

export function checkinToday(dateStr = formatDate(today())) {
  return getCheckin(dateStr);
}

// Small helper used by the header: a friendly one-line "what matters" nudge.
export function whatMatters() {
  const dateStr = formatDate(today());
  const h = habitSummary();
  const t = taskSummary(dateStr);
  const s = schoolToday();
  const items = [];
  if (!h.restDay && h.completed < h.total) items.push(`${h.total - h.completed} habit${h.total - h.completed === 1 ? '' : 's'} left`);
  if (t.total - t.done > 0) items.push(`${t.total - t.done} task${t.total - t.done === 1 ? '' : 's'} to do`);
  const openSessions = s.sessions.filter(x => x.status !== 'done').length;
  if (openSessions) items.push(`${openSessions} study session${openSessions === 1 ? '' : 's'}`);
  return items;
}
