// ============================================================
// HABIT CONFIG — overrides for built-in habits + extra meta for custom habits
// (tags, schedule, category) that don't fit the columned `custom_habits` table.
// Same persistence pattern as split/mental: runtime truth in state.habitConfig,
// localStorage immediate, best-effort Supabase (optional `habit_config` table,
// graceful when absent). Habit IDs are never changed, so existing logs always
// keep mapping to the same habit.
// ============================================================

import { state } from './state.js';
import { persistDocument } from './data/repository.js';
import { reportSaveResult } from './ui/saveFeedback.js';

const LS_KEY = 'dontdie_habitcfg_v1';
const VERSION = 1;

function empty() { return { version: VERSION, updatedAt: null, builtin: {}, custom: {} }; }
function loadLocal() { try { const r = localStorage.getItem(LS_KEY); return r ? JSON.parse(r) : null; } catch { return null; } }
function saveLocal(d) { try { localStorage.setItem(LS_KEY, JSON.stringify(d)); } catch {} }
function normalize(d) {
  if (!d || typeof d !== 'object') d = empty();
  d.version = VERSION;
  if (!d.builtin || typeof d.builtin !== 'object') d.builtin = {};
  if (!d.custom || typeof d.custom !== 'object') d.custom = {};
  return d;
}

export function initHabitConfig(localDocument) {
  const chosen = normalize(localDocument || loadLocal() || empty());
  if (!chosen.updatedAt) chosen.updatedAt = new Date().toISOString();
  state.habitConfig = chosen;
  saveLocal(chosen);
}

/** Replace the in-memory copy with one the reconciler adopted from the cloud. */
export function adoptHabitConfig(data) {
  state.habitConfig = normalize(data);
  saveLocal(state.habitConfig);
}

// `habit_config` is NOT installed in the production project. The repository
// stores it durably on device and the reconciler simply records the table as
// missing, so the feature keeps working without a cloud copy.
export function saveHabitConfig() {
  const d = state.habitConfig;
  if (!d) return Promise.resolve({ status: 'local' });
  d.updatedAt = new Date().toISOString();
  saveLocal(d);
  return persistDocument('habitConfig', d).then(result => {
    reportSaveResult('Habit settings', result);
    return result;
  });
}

export { normalize as normalizeHabitConfigDocument };

export function getBuiltinOverride(id) { return (state.habitConfig && state.habitConfig.builtin[id]) || null; }
export function hasBuiltinOverride(id) { return !!getBuiltinOverride(id); }
export function setBuiltinOverride(id, patch) {
  if (!state.habitConfig) state.habitConfig = empty();
  state.habitConfig.builtin[id] = { ...(state.habitConfig.builtin[id] || {}), ...patch };
  saveHabitConfig();
}
export function resetBuiltinOverride(id) {
  if (state.habitConfig && state.habitConfig.builtin[id]) { delete state.habitConfig.builtin[id]; saveHabitConfig(); }
}

// The active stimulation link for a habit (built-in or custom), or null. Only
// returns it when enabled AND it points at an activity, so callers can treat a
// truthy result as "create/remove a linked Stimulation log on toggle".
export function getStimLink(habitId) {
  const c = state.habitConfig;
  if (!c) return null;
  const link = (c.builtin[habitId] && c.builtin[habitId].stimLink) || (c.custom[habitId] && c.custom[habitId].stimLink) || null;
  return (link && link.enabled && link.activityId) ? link : null;
}

export function getCustomMeta(id) { return (state.habitConfig && state.habitConfig.custom[id]) || null; }
export function setCustomMeta(id, patch) {
  if (!state.habitConfig) state.habitConfig = empty();
  state.habitConfig.custom[id] = { ...(state.habitConfig.custom[id] || {}), ...patch };
  saveHabitConfig();
}
export function deleteCustomMeta(id) {
  if (state.habitConfig && state.habitConfig.custom[id]) { delete state.habitConfig.custom[id]; saveHabitConfig(); }
}
