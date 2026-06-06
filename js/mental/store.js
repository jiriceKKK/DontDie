// ============================================================
// MENTAL-HEALTH STORE — single source of truth for check-ins,
// temporary tasks and journal entries.
//
// Same persistence model as the split store: runtime truth in
// state.mental, written to localStorage immediately and pushed
// best-effort to the `mh_store` Supabase row (newer updatedAt wins).
// ============================================================

import { state } from '../state.js';
import { dbSaveMentalStore } from '../db.js';
import { showToast } from '../ui/toast.js';
import { formatDate, today, addDays } from '../utils/date.js';

const LS_KEY = 'dontdie_mh_v1';
const VERSION = 1;
let _cloudOk = true;

function uid() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
const stampMs = s => Date.parse(s || 0) || 0;

function emptyData() {
  return { version: VERSION, updatedAt: null, checkins: {}, tasks: [], journal: [] };
}

function loadLocal() {
  try { const raw = localStorage.getItem(LS_KEY); return raw ? JSON.parse(raw) : null; }
  catch { return null; }
}
function saveLocal(d) { try { localStorage.setItem(LS_KEY, JSON.stringify(d)); } catch {} }

function normalize(d) {
  if (!d || typeof d !== 'object') d = emptyData();
  d.version = VERSION;
  if (!d.checkins || typeof d.checkins !== 'object') d.checkins = {};
  if (!Array.isArray(d.tasks)) d.tasks = [];
  if (!Array.isArray(d.journal)) d.journal = [];
  for (const t of d.tasks) if (!t.id) t.id = uid();
  for (const j of d.journal) if (!j.id) j.id = uid();
  return d;
}

// ---- load / save ----------------------------------------------------------

export function initMental(remote) {
  const local = loadLocal();
  let chosen;
  if (remote && local) chosen = stampMs(remote.updatedAt) >= stampMs(local.updatedAt) ? remote : local;
  else                 chosen = remote || local || emptyData();

  chosen = normalize(chosen);
  if (!chosen.updatedAt) chosen.updatedAt = new Date().toISOString();
  state.mental = chosen;
  saveLocal(chosen);

  if (!remote || stampMs(chosen.updatedAt) > stampMs(remote.updatedAt)) {
    dbSaveMentalStore(chosen).catch(() => {});
  }
}

export function saveMental() {
  const d = state.mental;
  d.updatedAt = new Date().toISOString();
  saveLocal(d);
  dbSaveMentalStore(d).then(({ error }) => {
    if (error && _cloudOk) { _cloudOk = false; showToast('Saved on this device · cloud sync unavailable', 'warning'); }
    else if (!error && !_cloudOk) { _cloudOk = true; showToast('Synced', 'success'); }
  });
}

export function getMental() { return state.mental; }

// ---- check-ins (one per day) ----------------------------------------------

export function getCheckin(dateStr) {
  return state.mental.checkins[dateStr] || null;
}

// Insert or replace the single check-in for a day.
export function saveCheckin(dateStr, data) {
  state.mental.checkins[dateStr] = { ...data, date: dateStr };
  saveMental();
}

// Most recent N check-ins as { date, ...fields } sorted oldest→newest.
export function recentCheckins(n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const dateStr = formatDate(addDays(today(), -i));
    const c = state.mental.checkins[dateStr];
    out.push({ date: dateStr, has: !!c, ...(c || {}) });
  }
  return out;
}

// ---- tasks (date-based, temporary) ----------------------------------------

export function getTasks(dateStr) {
  return state.mental.tasks.filter(t => t.date === dateStr);
}

export function addTask(dateStr, text) {
  state.mental.tasks.push({ id: uid(), date: dateStr, text, done: false });
  saveMental();
}

export function toggleTask(id) {
  const t = state.mental.tasks.find(x => x.id === id);
  if (t) { t.done = !t.done; saveMental(); }
}

export function deleteTask(id) {
  state.mental.tasks = state.mental.tasks.filter(x => x.id !== id);
  saveMental();
}

// ---- journal (template-typed entries) -------------------------------------

export function addJournal(type, fields) {
  const now = new Date();
  state.mental.journal.push({
    id: uid(), date: formatDate(now), type, fields, createdAt: now.toISOString(),
  });
  saveMental();
}

export function listJournal() {
  return [...state.mental.journal].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export function getJournal(id) {
  return state.mental.journal.find(j => j.id === id) || null;
}

export function deleteJournal(id) {
  state.mental.journal = state.mental.journal.filter(j => j.id !== id);
  saveMental();
}

// ---- stats helpers (factual, no advice) -----------------------------------

const METRICS = ['mood', 'stress', 'anxiety', 'energy', 'sleep', 'social'];

// Average of a metric over the last n days (ignoring days with no check-in).
function avg(values) {
  const v = values.filter(x => typeof x === 'number');
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

// Series of {date, value|null} for one metric over the last n days.
export function metricSeries(metric, n) {
  return recentCheckins(n).map(c => ({ date: c.date, value: c.has ? c[metric] : null }));
}

// Counts of each tag across the last n days, sorted desc.
export function tagCounts(n) {
  const counts = {};
  for (const c of recentCheckins(n)) {
    if (!c.has || !Array.isArray(c.tags)) continue;
    for (const tag of c.tags) counts[tag] = (counts[tag] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({ tag, count }));
}

// Task completion over the last n days: { done, total }.
export function taskCompletion(n) {
  let done = 0, total = 0;
  const from = formatDate(addDays(today(), -(n - 1)));
  const to = formatDate(today());
  for (const t of state.mental.tasks) {
    if (t.date >= from && t.date <= to) { total++; if (t.done) done++; }
  }
  return { done, total };
}

// Per-day task counts over the last n days: [{ date, done, total }] oldest→newest.
export function tasksByDay(n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const dateStr = formatDate(addDays(today(), -i));
    const dayTasks = state.mental.tasks.filter(t => t.date === dateStr);
    out.push({ date: dateStr, done: dayTasks.filter(t => t.done).length, total: dayTasks.length });
  }
  return out;
}

// Average mood on days where every task was completed vs days with unfinished
// tasks (only days that have a check-in AND at least one task).
export function taskMoodSplit(n) {
  let doneSum = 0, doneCount = 0, unfSum = 0, unfCount = 0;
  for (const c of recentCheckins(n)) {
    if (!c.has || typeof c.mood !== 'number') continue;
    const dayTasks = state.mental.tasks.filter(t => t.date === c.date);
    if (dayTasks.length === 0) continue;
    if (dayTasks.every(t => t.done)) { doneSum += c.mood; doneCount++; }
    else { unfSum += c.mood; unfCount++; }
  }
  return {
    doneAvg: doneCount ? doneSum / doneCount : null, doneCount,
    unfAvg: unfCount ? unfSum / unfCount : null, unfCount,
  };
}

// Average mood per weekday over last n days → best/worst.
export function weekdayMood(n) {
  const sums = Array.from({ length: 7 }, () => ({ sum: 0, count: 0 }));
  for (const c of recentCheckins(n)) {
    if (!c.has || typeof c.mood !== 'number') continue;
    const dow = new Date(c.date + 'T00:00:00').getDay();
    sums[dow].sum += c.mood; sums[dow].count++;
  }
  return sums.map((s, dow) => ({ dow, avg: s.count ? s.sum / s.count : null }));
}

// Pairs of {sleep, mood} where both exist — for the sleep-vs-mood readout.
export function sleepVsMood(n) {
  const pairs = [];
  for (const c of recentCheckins(n)) {
    if (c.has && typeof c.sleep === 'number' && typeof c.mood === 'number') pairs.push({ sleep: c.sleep, mood: c.mood });
  }
  return pairs;
}

// Factual recent-trend summary: compares the last `win` days to the `win`
// before them, and reports only the metrics that moved meaningfully.
export function patternSummary(win = 3) {
  const recent = recentCheckins(win * 2);
  const older = recent.slice(0, win);
  const newer = recent.slice(win);
  const parts = [];
  const dir = { mood: 'higher', stress: 'higher', anxiety: 'higher', energy: 'higher', sleep: 'higher', social: 'higher' };
  for (const m of METRICS) {
    const a = avg(older.map(c => (c.has ? c[m] : null)));
    const b = avg(newer.map(c => (c.has ? c[m] : null)));
    if (a == null || b == null) continue;
    const delta = b - a;
    if (Math.abs(delta) < 0.5) continue; // ignore noise
    parts.push(`${m} ${delta > 0 ? dir[m] : (dir[m] === 'higher' ? 'lower' : 'higher')}`);
  }
  return parts; // e.g. ['mood lower','stress higher','energy lower']
}

export { METRICS };
