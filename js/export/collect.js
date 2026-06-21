// ============================================================
// EXPORT — raw data collection + date-range filtering. Pure-ish: reads
// state and deep-clones so exporting never mutates anything. Used by both
// the backup JSON and the AI reflection report.
//
// PRIVACY: only user-created / app-tracked data is collected here. Config
// secrets (Supabase URL/key), the PIN hash, and auth/session internals are
// never touched by this module.
// ============================================================

import { state } from '../state.js';
import { BUILT_IN_HABITS } from '../constants.js';
import { formatDate, today, addDays, parseDate } from '../utils/date.js';

export const APP_VERSION = '1.0.0';
export const EXPORT_VERSION = 1;

const clone = o => JSON.parse(JSON.stringify(o == null ? null : o));

// range: 7 | 30 | 90 | 'all'. Returns { start, end, days, label }.
export function rangeBounds(range) {
  if (range === 'all' || range == null) {
    return { start: null, end: formatDate(today()), days: null, label: 'All time' };
  }
  const days = Number(range) || 30;
  return { start: formatDate(addDays(today(), -(days - 1))), end: formatDate(today()), days, label: `Last ${days} days` };
}

const inRange = (dateStr, b) => !dateStr ? false : (!b.start || (dateStr >= b.start && dateStr <= b.end));

// Filter a { "YYYY-MM-DD": value } map to the range.
function filterDateMap(obj, b) {
  if (!b.start) return clone(obj || {});
  const out = {};
  for (const k of Object.keys(obj || {})) if (inRange(k, b)) out[k] = obj[k];
  return clone(out);
}

// Earliest date string across the date-based data (for "all time" spans).
export function earliestDataDate() {
  const dates = [];
  const push = arr => { for (const d of arr) if (d) dates.push(d); };
  push(Object.keys(state.logsByDate || {}));
  push(Object.keys((state.mental && state.mental.checkins) || {}));
  push(((state.mental && state.mental.tasks) || []).map(t => t.date));
  push(((state.mental && state.mental.journal) || []).map(j => j.date));
  push(Object.keys((state.stimulation && state.stimulation.logs) || {}));
  push(((state.school && state.school.sessions) || []).map(s => s.date));
  push(((state.school && state.school.results) || []).map(r => (r.createdAt || '').slice(0, 10)));
  dates.sort();
  return dates[0] || null;
}

// Number of calendar days the range spans (for coverage denominators).
export function spanDays(b) {
  if (b.days) return b.days;
  const e = earliestDataDate();
  if (!e) return 0;
  const ms = today().getTime() - parseDate(e).setHours(0, 0, 0, 0);
  return Math.max(1, Math.round(ms / 86400000) + 1);
}

export function collectPhysical(b) {
  return {
    builtInHabits: BUILT_IN_HABITS.map(h => ({ id: h.id, name: h.name, days: h.days, category: h.category, label: h.label })),
    customHabits: clone(state.customHabits || []),
    hiddenBuiltins: [...(state.hiddenBuiltins || [])], // Set → array
    habitConfig: clone(state.habitConfig || null),     // built-in overrides + custom meta (tags, schedule, stim links)
    logsByDate: filterDateMap(state.logsByDate, b),
    split: clone(state.split || null),
  };
}

export function collectMental(b) {
  const m = state.mental || {};
  return {
    checkins: filterDateMap(m.checkins, b),
    tasks: clone((m.tasks || []).filter(t => inRange(t.date, b))),
    journal: clone((m.journal || []).filter(j => inRange(j.date, b))),
  };
}

export function collectStimulation(b) {
  const s = state.stimulation || {};
  return {
    settings: clone(s.settings || null),
    activities: clone(s.activities || []),
    logs: filterDateMap(s.logs, b),
    screenTime: { byDate: filterDateMap((s.screenTime || {}).byDate, b) }, // Screen Time import snapshots
    appMappings: clone(s.appMappings || {}),                               // remembered app→category mappings
  };
}

export function collectSchool(b) {
  const sc = state.school || {};
  return {
    settings: clone(sc.settings || null),
    subjects: clone(sc.subjects || []),
    tests: clone(sc.tests || []),
    sessions: clone((sc.sessions || []).filter(x => inRange(x.date, b))),
    results: clone((sc.results || []).filter(r => inRange((r.createdAt || '').slice(0, 10), b))),
  };
}

export function collectAll(b) {
  return {
    physical: collectPhysical(b),
    mental: collectMental(b),
    stimulation: collectStimulation(b),
    school: collectSchool(b),
  };
}
