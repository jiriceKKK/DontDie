// ============================================================
// STIMULATION STORE — single source of truth for the behaviour-based
// stimulation model. Same persistence pattern as split/mental:
// runtime truth in state.stimulation, localStorage immediate, Supabase
// best-effort (newer updatedAt wins), no hard dependency on the table.
//
// NOTE: this is an ESTIMATE from logged activities, not a biological
// measurement. "Load" and "baseline" are simple weighted sums.
// ============================================================

import { state } from '../state.js';
import { dbSaveStimulationStore } from '../db.js';
import { showToast } from '../ui/toast.js';
import { formatDate, today, addDays } from '../utils/date.js';
import { buildDefaultStimulation, DEFAULT_SETTINGS, CATEGORY_IDS } from './defaultActivities.js';

const LS_KEY = 'dontdie_stim_v1';
const VERSION = 1;
let _cloudOk = true;

function uid() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
const stampMs = s => Date.parse(s || 0) || 0;
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

function loadLocal() {
  try { const raw = localStorage.getItem(LS_KEY); return raw ? JSON.parse(raw) : null; }
  catch { return null; }
}
function saveLocal(d) { try { localStorage.setItem(LS_KEY, JSON.stringify(d)); } catch {} }

function normalize(d) {
  if (!d || typeof d !== 'object') d = buildDefaultStimulation();
  d.version = VERSION;
  d.settings = { ...DEFAULT_SETTINGS, ...(d.settings || {}) };
  if (!Array.isArray(d.activities)) d.activities = [];
  for (const ex of d.activities) {
    if (!ex.id) ex.id = uid();
    ex.stimulationScore = num(ex.stimulationScore, 0);
    ex.defaultDurationMinutes = Math.max(1, num(ex.defaultDurationMinutes, 15));
    if (!Array.isArray(ex.tags)) ex.tags = [];
    if (ex.active === undefined) ex.active = true;
  }
  if (!d.logs || typeof d.logs !== 'object') d.logs = {};
  for (const date of Object.keys(d.logs)) {
    const day = d.logs[date] || {};
    if (!day.blocks || typeof day.blocks !== 'object') day.blocks = {};
    d.logs[date] = day;
  }
  // Screen Time import bookkeeping (snapshots per date) + remembered app→activity
  // mappings. Both additive; absent in older stores, so they default empty here.
  if (!d.screenTime || typeof d.screenTime !== 'object') d.screenTime = {};
  if (!d.screenTime.byDate || typeof d.screenTime.byDate !== 'object') d.screenTime.byDate = {};
  if (!d.appMappings || typeof d.appMappings !== 'object') d.appMappings = {};
  return d;
}

// ---- load / save ----------------------------------------------------------

export function initStimulation(remote) {
  const local = loadLocal();
  let chosen;
  if (remote && local) chosen = stampMs(remote.updatedAt) >= stampMs(local.updatedAt) ? remote : local;
  else                 chosen = remote || local || buildDefaultStimulation();

  chosen = normalize(chosen);
  if (!chosen.updatedAt) chosen.updatedAt = new Date().toISOString();
  state.stimulation = chosen;
  saveLocal(chosen);

  if (!remote || stampMs(chosen.updatedAt) > stampMs(remote.updatedAt)) {
    dbSaveStimulationStore(chosen).catch(() => {});
  }
}

export function saveStimulation() {
  const d = state.stimulation;
  d.updatedAt = new Date().toISOString();
  saveLocal(d);
  dbSaveStimulationStore(d).then(({ error }) => {
    if (error && _cloudOk) { _cloudOk = false; showToast('Saved on this device · cloud sync unavailable', 'warning'); }
    else if (!error && !_cloudOk) { _cloudOk = true; showToast('Synced', 'success'); }
  });
}

export function getStimulation() { return state.stimulation; }
export function getSettings() { return state.stimulation.settings; }

export function updateSettings(patch) {
  const s = state.stimulation.settings;
  s.dayStartHour = Math.min(23, Math.max(0, num(patch.dayStartHour, s.dayStartHour)));
  s.dayEndHour = Math.min(24, Math.max(s.dayStartHour + 1, num(patch.dayEndHour, s.dayEndHour)));
  s.blockMinutes = Math.min(240, Math.max(30, num(patch.blockMinutes, s.blockMinutes)));
  s.baselineWindowDays = Math.min(60, Math.max(1, num(patch.baselineWindowDays, s.baselineWindowDays)));
  saveStimulation();
}

export function resetStimulation() {
  state.stimulation = normalize(buildDefaultStimulation());
  state.stimulation.updatedAt = new Date().toISOString();
  saveStimulation();
}

// ---- activities -----------------------------------------------------------

export function getActivities(includeInactive = false) {
  const list = state.stimulation.activities;
  return includeInactive ? list : list.filter(a => a.active !== false);
}
export function findActivity(id) { return state.stimulation.activities.find(a => a.id === id) || null; }

export function addActivity({ name, category, stimulationScore, defaultDurationMinutes, tags = [] }) {
  const id = uid();
  state.stimulation.activities.push({
    id, name: String(name).trim(),
    category: CATEGORY_IDS.includes(category) ? category : 'medium_stim',
    stimulationScore: num(stimulationScore, 0),
    defaultDurationMinutes: Math.max(1, num(defaultDurationMinutes, 15)),
    tags: Array.isArray(tags) ? tags : [],
    active: true,
  });
  saveStimulation();
  return id;
}

export function updateActivity(id, patch) {
  const ex = findActivity(id);
  if (!ex) return;
  if (patch.name !== undefined) ex.name = String(patch.name).trim();
  if (patch.category !== undefined && CATEGORY_IDS.includes(patch.category)) ex.category = patch.category;
  if (patch.stimulationScore !== undefined) ex.stimulationScore = num(patch.stimulationScore, ex.stimulationScore);
  if (patch.defaultDurationMinutes !== undefined) ex.defaultDurationMinutes = Math.max(1, num(patch.defaultDurationMinutes, ex.defaultDurationMinutes));
  if (patch.tags !== undefined) ex.tags = Array.isArray(patch.tags) ? patch.tags : ex.tags;
  if (patch.active !== undefined) ex.active = !!patch.active;
  saveStimulation();
}

export function deleteActivity(id) {
  state.stimulation.activities = state.stimulation.activities.filter(a => a.id !== id);
  saveStimulation();
}

// ---- activity import (pipe or JSON) ---------------------------------------
// Pipe format per line:  name | category | score | durationMinutes | tags
export function parseActivities(text) {
  const valid = [], errors = [];
  const raw = String(text || '').trim();
  if (!raw) return { valid, errors };

  // Try JSON array first.
  if (raw[0] === '[') {
    try {
      const arr = JSON.parse(raw);
      arr.forEach((o, i) => {
        const r = validateActivity(o.name, o.category, o.stimulationScore ?? o.score, o.defaultDurationMinutes ?? o.duration, o.tags);
        if (r.ok) valid.push(r.value); else errors.push({ line: i + 1, reason: r.reason });
      });
      return { valid, errors };
    } catch { /* fall through to pipe parsing */ }
  }

  raw.split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (!t) return;
    const parts = t.split('|').map(p => p.trim());
    if (parts.length < 4) { errors.push({ line: i + 1, reason: 'expected: name | category | score | duration | tags' }); return; }
    const tags = parts[4] ? parts[4].split(',').map(s => s.trim()).filter(Boolean) : [];
    const r = validateActivity(parts[0], parts[1], parts[2], parts[3], tags);
    if (r.ok) valid.push(r.value); else errors.push({ line: i + 1, reason: r.reason });
  });
  return { valid, errors };
}

function validateActivity(name, category, score, duration, tags) {
  name = String(name || '').trim();
  if (!name) return { ok: false, reason: 'missing name' };
  if (!CATEGORY_IDS.includes(category)) return { ok: false, reason: `bad category "${category}" (use ${CATEGORY_IDS.join(' / ')})` };
  if (!Number.isFinite(Number(score))) return { ok: false, reason: `score not a number ("${score}")` };
  if (!Number.isFinite(Number(duration)) || Number(duration) <= 0) return { ok: false, reason: `duration not a positive number ("${duration}")` };
  return { ok: true, value: { name, category, stimulationScore: Number(score), defaultDurationMinutes: Number(duration), tags: Array.isArray(tags) ? tags : [] } };
}

// Adds parsed activities, skipping ones whose name already exists.
export function importActivities(list) {
  const existing = new Set(state.stimulation.activities.map(a => a.name.toLowerCase()));
  let added = 0, skipped = 0;
  for (const item of list) {
    if (existing.has(item.name.toLowerCase())) { skipped++; continue; }
    state.stimulation.activities.push({ id: uid(), active: true, ...item });
    existing.add(item.name.toLowerCase());
    added++;
  }
  if (added) saveStimulation();
  return { added, skipped };
}

// ---- time blocks ----------------------------------------------------------

const pad = n => String(n).padStart(2, '0');
const hhmm = mins => `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;

// Block definitions for the current settings: [{ index, startMin, endMin, label, minutes }]
export function dayBlocks() {
  const { dayStartHour, dayEndHour, blockMinutes } = state.stimulation.settings;
  const blocks = [];
  let start = dayStartHour * 60;
  const end = dayEndHour * 60;
  let i = 0;
  while (start < end && i < 24) {
    const bEnd = Math.min(start + blockMinutes, end);
    blocks.push({ index: i, startMin: start, endMin: bEnd, minutes: bEnd - start, label: `${hhmm(start)}–${hhmm(bEnd)}` });
    start = bEnd; i++;
  }
  return blocks;
}

function ensureDay(date) {
  if (!state.stimulation.logs[date]) state.stimulation.logs[date] = { blocks: {} };
  if (!state.stimulation.logs[date].blocks) state.stimulation.logs[date].blocks = {};
  return state.stimulation.logs[date];
}

export function blockEntries(date, idx) {
  const day = state.stimulation.logs[date];
  return (day && day.blocks && day.blocks[idx]) ? day.blocks[idx] : [];
}

export function addEntry(date, idx, activityId, durationMinutes) {
  const day = ensureDay(date);
  if (!day.blocks[idx]) day.blocks[idx] = [];
  const id = uid();
  day.blocks[idx].push({ id, activityId, durationMinutes: Math.max(1, num(durationMinutes, 15)), intensity: 1, source: 'manual', createdAt: new Date().toISOString() });
  saveStimulation();
  return id;
}

export function setEntryDuration(date, idx, entryIndex, durationMinutes) {
  const entries = blockEntries(date, idx);
  if (entries[entryIndex]) {
    entries[entryIndex].durationMinutes = Math.max(1, num(durationMinutes, 15));
    // Editing a habit-linked / imported entry keeps the link but flags it as edited.
    if (entrySource(entries[entryIndex]) !== 'manual') entries[entryIndex].edited = true;
    saveStimulation();
  }
}

export function removeEntry(date, idx, entryIndex) {
  const day = state.stimulation.logs[date];
  if (day && day.blocks[idx]) {
    day.blocks[idx].splice(entryIndex, 1);
    if (day.blocks[idx].length === 0) delete day.blocks[idx];
    saveStimulation();
  }
}

// ---- entry sources, linking & import helpers ------------------------------
// Entries may carry an optional `source` ('manual' | 'screen_time_import' |
// 'habit_link'; absent = manual) plus link/import metadata. All additive: old
// entries without a source keep working and still count as manual everywhere.

export function entrySource(e) { return (e && e.source) || 'manual'; }

// A short {text, cls} badge for an entry's source, or null for plain manual.
export function entrySourceBadge(e) {
  switch (entrySource(e)) {
    case 'habit_link':          return { text: 'From habit', cls: 'src-habit' };
    case 'screen_time_import':  return { text: e && e.edited ? 'Imported · edited' : 'Imported', cls: 'src-import' };
    default:                    return null;
  }
}

// Push a fully-formed entry (with source + metadata) into a block. Used by the
// habit-link and Screen Time import paths. Returns the new entry's id.
export function addEntryFull(date, idx, entry) {
  const day = ensureDay(date);
  if (!day.blocks[idx]) day.blocks[idx] = [];
  const e = {
    intensity: 1,
    source: 'manual',
    createdAt: new Date().toISOString(),
    ...entry,
    id: entry.id || uid(),
    durationMinutes: Math.max(1, num(entry.durationMinutes, 15)),
  };
  day.blocks[idx].push(e);
  saveStimulation();
  return e.id;
}

// Total minutes logged for one activity on a date, optionally restricted to a
// set of sources. Drives Screen Time reconciliation's "already logged" figure.
export function loggedMinutesForActivity(date, activityId, sources = null) {
  let mins = 0;
  for (const b of dayBlocks()) {
    for (const e of blockEntries(date, b.index)) {
      if (e.activityId !== activityId) continue;
      if (sources && !sources.includes(entrySource(e))) continue;
      mins += num(e.durationMinutes, 0);
    }
  }
  return mins;
}

// Total minutes previously imported from Screen Time for one app key on a date.
export function importedMinutesForApp(date, appKey) {
  let mins = 0;
  for (const b of dayBlocks()) {
    for (const e of blockEntries(date, b.index)) {
      if (entrySource(e) === 'screen_time_import' && e.importAppKey === appKey) mins += num(e.durationMinutes, 0);
    }
  }
  return mins;
}

// Locate all habit-linked entries for a habit/date → [{ idx, entryIndex, entry }].
export function findHabitLinkEntries(date, habitId) {
  const out = [];
  const day = state.stimulation.logs[date];
  if (!day || !day.blocks) return out;
  for (const idx of Object.keys(day.blocks)) {
    (day.blocks[idx] || []).forEach((e, entryIndex) => {
      if (entrySource(e) === 'habit_link' && e.linkedHabitId === habitId && e.linkedHabitDate === date)
        out.push({ idx: Number(idx), entryIndex, entry: e });
    });
  }
  return out;
}

// Remove every habit-linked entry for a habit/date. Never touches manual logs.
// Returns the count removed; saves once if anything changed.
export function removeHabitLinkEntries(date, habitId) {
  const day = state.stimulation.logs[date];
  if (!day || !day.blocks) return 0;
  let removed = 0;
  for (const idx of Object.keys(day.blocks)) {
    const before = day.blocks[idx].length;
    day.blocks[idx] = day.blocks[idx].filter(e =>
      !(entrySource(e) === 'habit_link' && e.linkedHabitId === habitId && e.linkedHabitDate === date));
    removed += before - day.blocks[idx].length;
    if (day.blocks[idx].length === 0) delete day.blocks[idx];
  }
  if (removed) saveStimulation();
  return removed;
}

// Block index that contains a minutes-of-day value; clamps to first/last block.
export function blockIndexForMinutes(mins) {
  const blocks = dayBlocks();
  if (!blocks.length) return 0;
  const i = blocks.findIndex(b => mins >= b.startMin && mins < b.endMin);
  if (i !== -1) return i;
  return mins < blocks[0].startMin ? 0 : blocks.length - 1;
}

// Block index for the current clock time (used by habit-link + import placement).
export function currentBlockIndex() {
  const now = new Date();
  return blockIndexForMinutes(now.getHours() * 60 + now.getMinutes());
}

// How many of the day's blocks have at least one entry (for "3 / 8 blocks").
export function filledBlockCount(date) {
  const day = state.stimulation.logs[date];
  if (!day || !day.blocks) return 0;
  return dayBlocks().filter(b => (day.blocks[b.index] || []).length > 0).length;
}

// ---- calculations ---------------------------------------------------------

// Weighted load for one block: sum(score * durationFraction * intensity).
// durationFraction normalises against the block length so 90 min counts far
// more than 5 min.  Simple and explainable on purpose.
export function blockLoad(date, idx) {
  const block = dayBlocks().find(b => b.index === idx);
  const len = block ? block.minutes : state.stimulation.settings.blockMinutes;
  let load = 0;
  for (const e of blockEntries(date, idx)) {
    const ex = findActivity(e.activityId);
    if (!ex) continue;
    load += ex.stimulationScore * (num(e.durationMinutes, 0) / len) * num(e.intensity, 1);
  }
  return load;
}

// Sum of all block loads for a day.
export function dailyLoad(date) {
  return dayBlocks().reduce((sum, b) => sum + blockLoad(date, b.index), 0);
}

export function hasAnyEntries(date) {
  const day = state.stimulation.logs[date];
  if (!day || !day.blocks) return false;
  return Object.values(day.blocks).some(arr => arr && arr.length > 0);
}

// Per-block loads for a day → [{ ...block, load }].
export function todayCurve(date) {
  return dayBlocks().map(b => ({ ...b, load: blockLoad(date, b.index) }));
}

// Daily loads for the last n days (excluding today) that actually have data.
export function recentDailyLoads(n) {
  const out = [];
  for (let i = 1; i <= n; i++) {
    const date = formatDate(addDays(today(), -i));
    if (hasAnyEntries(date)) out.push(dailyLoad(date));
  }
  return out;
}

// Recent average daily load. Neutral 0 when there's no history yet.
export function baselineDaily() {
  const loads = recentDailyLoads(state.stimulation.settings.baselineWindowDays);
  return loads.length ? loads.reduce((a, b) => a + b, 0) / loads.length : 0;
}

// Per-block baseline reference (so the chart line and the today curve share a
// scale): if every block matched this, the day's sum would equal baselineDaily.
export function baselinePerBlock() {
  const blocks = dayBlocks().length || 1;
  return baselineDaily() / blocks;
}

// ---- separated metrics: Cheap Stim vs Productive vs Recovery --------------
// The dashboard does NOT treat all stimulation as one number. An activity's
// category decides which metric its score feeds, so gym/OAH/study/coding raise
// Productive Activation but never Cheap Stim Load, while Instagram/TikTok/porn
// raise Cheap Stim Load but never Productive. The formula stays a simple
// duration-weighted sum — only the routing changes.
//
//   high_stim / medium_stim  → cheap      = +score (gross)
//   productive_stim          → productive = +score
//   recovery                 → recovery   = score (negative)
//   low_stim                 → neutral    (feeds nothing)
//
// Recovery is modelled as a WHOLE-DAY credit, not a per-block subtraction:
//   • Block level (timeline): cheap = gross cheap of that block. The chart shows
//     where stimulation actually happened; recovery is shown separately.
//   • Daily level (regulation): Cheap Stim Load = max(0, dailyGrossCheap -
//     dailyRecoveryCredit * DAILY_RECOVERY_FACTOR). So a calm walk at 14:00 still
//     lowers a busy morning, even though its own block can't go below 0.
// Recovery is therefore credited exactly once (at the daily level) — no double
// counting between block and day.
export function metricWeights(category, score) {
  const s = num(score, 0);
  const pos = Math.max(0, s);
  const neg = Math.min(0, s); // ≤ 0
  switch (category) {
    case 'high_stim':       return { cheap: pos, productive: 0,   recovery: 0 };
    case 'medium_stim':     return { cheap: pos, productive: 0,   recovery: 0 };
    case 'productive_stim': return { cheap: 0,   productive: pos, recovery: 0 };
    case 'low_stim':        return { cheap: 0,   productive: 0,   recovery: 0 };
    case 'recovery':        return { cheap: 0,   productive: 0,   recovery: neg };
    default:                return { cheap: pos, productive: 0,   recovery: 0 };
  }
}

// Duration-weighted {cheap, productive, recovery} for one block.
function blockMetrics(date, idx) {
  const block = dayBlocks().find(b => b.index === idx);
  const len = block ? block.minutes : state.stimulation.settings.blockMinutes;
  const out = { cheap: 0, productive: 0, recovery: 0 };
  if (!len) return out;
  for (const e of blockEntries(date, idx)) {
    const ex = findActivity(e.activityId);
    if (!ex) continue;
    const w = metricWeights(ex.category, ex.stimulationScore);
    const frac = (num(e.durationMinutes, 0) / len) * num(e.intensity, 1);
    out.cheap += w.cheap * frac;
    out.productive += w.productive * frac;
    out.recovery += w.recovery * frac;
  }
  return out;
}

// Per-activity contributions for one block — same duration-weighted calc the
// chart uses, so the dashboard's segment popup never invents numbers. Returns
// [{ name, category, minutes, cheap, productive, recovery }] (one per entry).
export function blockDrivers(date, idx) {
  const block = dayBlocks().find(b => b.index === idx);
  const len = block ? block.minutes : state.stimulation.settings.blockMinutes;
  const out = [];
  if (!len) return out;
  for (const e of blockEntries(date, idx)) {
    const ex = findActivity(e.activityId);
    if (!ex) continue;
    const w = metricWeights(ex.category, ex.stimulationScore);
    const frac = (num(e.durationMinutes, 0) / len) * num(e.intensity, 1);
    out.push({
      name: ex.name,
      category: ex.category,
      minutes: num(e.durationMinutes, 0),
      source: entrySource(e),
      cheap: w.cheap * frac,
      productive: w.productive * frac,
      recovery: w.recovery * frac,
    });
  }
  return out;
}

// How strongly the day's recovery offsets the day's gross cheap stim. 0.7 means
// recovery cancels 70% of its own magnitude — it helps a lot, but never 1:1, so
// a short walk can't fully erase an hour of doomscrolling. (0.6–0.8 is sensible.)
export const DAILY_RECOVERY_FACTOR = 0.7;

// Gross cheap stim for one block (high/medium-stim only). This is the block-
// level TIMELINE value the chart shows — recovery is never subtracted per block.
export function blockGrossCheap(date, idx) {
  return num(blockMetrics(date, idx).cheap, 0);
}

// One metric for one block. metric ∈ 'cheap' | 'productive' | 'recovery'.
// 'cheap' is the block's GROSS cheap (the timeline). Recovery is applied once at
// the daily level (see dailyNetCheap), so the chart still shows true spikes.
export function blockMetric(date, idx, metric) {
  if (metric === 'cheap') return blockGrossCheap(date, idx);
  return num(blockMetrics(date, idx)[metric], 0);
}

// Whole-day gross cheap stim (sum of every block's gross).
export function dailyGrossCheap(date) {
  return dayBlocks().reduce((sum, b) => sum + blockGrossCheap(date, b.index), 0);
}

// Whole-day recovery credit — the positive magnitude of all recovery logged
// across the day (recovery scores are negative; this is their absolute total).
export function dailyRecoveryCredit(date) {
  const total = dayBlocks().reduce((sum, b) => sum + num(blockMetrics(date, b.index).recovery, 0), 0);
  return Math.abs(total);
}

// The MAIN daily Cheap Stim Load: gross minus a fraction of the day's recovery
// credit, clamped at 0. Recovery ANYWHERE in the day reduces it (cross-block).
export function dailyNetCheap(date) {
  return Math.max(0, dailyGrossCheap(date) - dailyRecoveryCredit(date) * DAILY_RECOVERY_FACTOR);
}

// Optional: leftover calm beyond what the day's cheap stim required.
export function recoverySurplus(date) {
  return Math.max(0, dailyRecoveryCredit(date) - dailyGrossCheap(date));
}

// Sum of one metric across the whole day. 'cheap' returns the DAILY net (recovery
// credited across the whole day) so the Load card, baseline, target and daily
// series all agree; the per-block chart uses blockMetric('cheap') = gross.
export function dailyMetric(date, metric) {
  if (metric === 'cheap') return dailyNetCheap(date);
  return dayBlocks().reduce((sum, b) => sum + blockMetric(date, b.index, metric), 0);
}

// Per-block curve for one metric → [{ ...block, load }].
export function metricCurve(date, metric) {
  return dayBlocks().map(b => ({ ...b, load: blockMetric(date, b.index, metric) }));
}

// Recent daily values of one metric (excluding today), only days with data.
function recentDailyMetric(n, metric) {
  const out = [];
  for (let i = 1; i <= n; i++) {
    const date = formatDate(addDays(today(), -i));
    if (hasAnyEntries(date)) out.push(dailyMetric(date, metric));
  }
  return out;
}

// Recent average for one metric. 0 when there's no history yet.
//   Cheap Stim Baseline  = average recent daily cheap load (high/medium days raise it).
//   Productive Average   = average recent daily productive activation.
// Because cheap excludes productive_stim, productive activity can never raise
// the Cheap Stim Baseline.
export function baselineMetricDaily(metric) {
  const loads = recentDailyMetric(state.stimulation.settings.baselineWindowDays, metric);
  return loads.length ? loads.reduce((a, b) => a + b, 0) / loads.length : 0;
}

// Per-block baseline for one metric — shares the chart's Y scale with the curve.
export function baselineMetricPerBlock(metric) {
  const blocks = dayBlocks().length || 1;
  return baselineMetricDaily(metric) / blocks;
}

// Did the day record any of this metric? (Used for per-view empty lines.)
export function hasMetricToday(date, metric) {
  return metricCurve(date, metric).some(c => Math.abs(c.load) > 1e-9);
}

// Daily series of one metric for the last n days (today included), with data flag.
export function dailyMetricSeries(n, metric) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const date = formatDate(addDays(today(), -i));
    out.push({ date, has: hasAnyEntries(date), load: dailyMetric(date, metric) });
  }
  return out;
}

// ---- target / ideal range ------------------------------------------------
// A practical, behaviour-based target band per metric (NOT a medical target).
// When there's enough history we estimate it from your better days — days that
// pair low cheap stim with decent productive activation; otherwise we fall back
// to stable defaults. Because cheap and productive are derived independently,
// productive activity never widens the cheap target and vice-versa.
const TARGET_DEFAULTS = {
  cheap:      { lo: 0,   hi: 0.8 }, // low is good
  productive: { lo: 1.5, hi: 3.5 }, // a solid productive day
};
const round1 = n => Math.round(n * 10) / 10;
function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Returns { lo, hi, source: 'data' | 'default' } for a metric's daily scale.
export function metricTarget(metric) {
  const def = TARGET_DEFAULTS[metric] || TARGET_DEFAULTS.cheap;
  const recent = [];
  for (let i = 1; i <= 14; i++) {
    const date = formatDate(addDays(today(), -i));
    if (!hasAnyEntries(date)) continue;
    recent.push({ cheap: dailyMetric(date, 'cheap'), prod: dailyMetric(date, 'productive') });
  }
  if (recent.length < 4) return { lo: def.lo, hi: def.hi, source: 'default' };

  // Better days = low cheap stim AND decent productive activation.
  const medCheap = median(recent.map(r => r.cheap));
  const medProd = median(recent.map(r => r.prod));
  const good = recent.filter(r => r.cheap <= medCheap && r.prod >= medProd);
  if (good.length < 2) return { lo: def.lo, hi: def.hi, source: 'default' };

  if (metric === 'cheap') {
    const hi = Math.max(...good.map(r => r.cheap));
    return { lo: 0, hi: hi > 0.05 ? round1(hi) : def.hi, source: 'data' };
  }
  const vals = good.map(r => r.prod).sort((a, b) => a - b);
  let lo = vals[0], hi = vals[vals.length - 1];
  if (hi - lo < 0.1) { lo = Math.max(0, lo - 0.5); hi = hi + 0.5; } // keep a visible band
  return { lo: round1(lo), hi: round1(hi), source: 'data' };
}

// 'below' | 'within' | 'above' for a value against a {lo, hi} band.
export function targetStatus(value, target) {
  if (!target) return 'within';
  if (value < target.lo - 1e-9) return 'below';
  if (value > target.hi + 1e-9) return 'above';
  return 'within';
}

// Top contributors to one metric over the last n days, sorted by magnitude.
export function topActivitiesByMetric(n, metric) {
  const totals = {};
  for (let i = 0; i < n; i++) {
    const date = formatDate(addDays(today(), -i));
    for (const b of dayBlocks()) {
      for (const e of blockEntries(date, b.index)) {
        const ex = findActivity(e.activityId);
        if (!ex) continue;
        const unit = metricWeights(ex.category, ex.stimulationScore)[metric];
        if (!unit) continue;
        const frac = (num(e.durationMinutes, 0) / b.minutes) * num(e.intensity, 1);
        totals[ex.id] = totals[ex.id] || { name: ex.name, load: 0, minutes: 0 };
        totals[ex.id].load += unit * frac;
        totals[ex.id].minutes += num(e.durationMinutes, 0);
      }
    }
  }
  return Object.values(totals).filter(t => Math.abs(t.load) > 1e-9).sort((a, b) => Math.abs(b.load) - Math.abs(a.load));
}

// ---- stats helpers --------------------------------------------------------

// Daily load series for the last n days (today included), with data flag.
export function dailyLoadSeries(n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const date = formatDate(addDays(today(), -i));
    out.push({ date, has: hasAnyEntries(date), load: dailyLoad(date) });
  }
  return out;
}

// Total weighted load contributed per activity over last n days, sorted desc.
export function topActivities(n) {
  const totals = {};
  for (let i = 0; i < n; i++) {
    const date = formatDate(addDays(today(), -i));
    for (const b of dayBlocks()) {
      for (const e of blockEntries(date, b.index)) {
        const ex = findActivity(e.activityId);
        if (!ex) continue;
        const contrib = ex.stimulationScore * (num(e.durationMinutes, 0) / b.minutes) * num(e.intensity, 1);
        totals[ex.id] = totals[ex.id] || { name: ex.name, load: 0, minutes: 0 };
        totals[ex.id].load += contrib;
        totals[ex.id].minutes += num(e.durationMinutes, 0);
      }
    }
  }
  return Object.values(totals).sort((a, b) => Math.abs(b.load) - Math.abs(a.load));
}

// Average load by hour-of-day band over last n days → highest band.
export function blockAverages(n) {
  const sums = {};
  for (let i = 0; i < n; i++) {
    const date = formatDate(addDays(today(), -i));
    if (!hasAnyEntries(date)) continue;
    for (const b of dayBlocks()) {
      sums[b.index] = sums[b.index] || { label: b.label, startMin: b.startMin, sum: 0, count: 0 };
      sums[b.index].sum += blockLoad(date, b.index);
      sums[b.index].count++;
    }
  }
  return Object.values(sums).map(s => ({ label: s.label, startMin: s.startMin, avg: s.count ? s.sum / s.count : 0 }));
}

// Sum of positive (high-stim) vs negative (recovery) contributions over n days.
export function highVsRecovery(n) {
  let high = 0, recovery = 0;
  for (let i = 0; i < n; i++) {
    const date = formatDate(addDays(today(), -i));
    for (const b of dayBlocks()) {
      const l = blockLoad(date, b.index);
      if (l > 0) high += l; else recovery += l;
    }
  }
  return { high, recovery };
}

// Factual crossover with mental check-ins, if both exist. Splits days by
// daily load (above/below baseline) and reports average mood. No causation.
export function stimMoodCrossover(n) {
  const checkins = (state.mental && state.mental.checkins) || {};
  const base = baselineDaily();
  let hiSum = 0, hiCount = 0, loSum = 0, loCount = 0;
  for (let i = 1; i <= n; i++) {
    const date = formatDate(addDays(today(), -i));
    if (!hasAnyEntries(date)) continue;
    const c = checkins[date];
    if (!c || typeof c.mood !== 'number') continue;
    if (dailyLoad(date) >= base) { hiSum += c.mood; hiCount++; }
    else { loSum += c.mood; loCount++; }
  }
  return { hiAvg: hiCount ? hiSum / hiCount : null, hiCount, loAvg: loCount ? loSum / loCount : null, loCount };
}
