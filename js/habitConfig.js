// ============================================================
// HABIT CONFIG — overrides for built-in habits + extra meta for custom habits
// (tags, schedule, category) that don't fit the columned `custom_habits` table.
// Same persistence pattern as split/mental: runtime truth in state.habitConfig,
// localStorage immediate, best-effort Supabase (optional `habit_config` table,
// graceful when absent). Habit IDs are never changed, so existing logs always
// keep mapping to the same habit.
// ============================================================

import { state } from './state.js';
import { dbSaveHabitConfig } from './db.js';

const LS_KEY = 'dontdie_habitcfg_v1';
const VERSION = 1;
const stampMs = s => Date.parse(s || 0) || 0;

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

export function initHabitConfig(remote) {
  const local = loadLocal();
  let chosen;
  if (remote && local) chosen = stampMs(remote.updatedAt) >= stampMs(local.updatedAt) ? remote : local;
  else                 chosen = remote || local || empty();
  chosen = normalize(chosen);
  if (!chosen.updatedAt) chosen.updatedAt = new Date().toISOString();
  state.habitConfig = chosen;
  saveLocal(chosen);
  if (!remote || stampMs(chosen.updatedAt) > stampMs(remote.updatedAt)) dbSaveHabitConfig(chosen).catch(() => {});
}

export function saveHabitConfig() {
  const d = state.habitConfig;
  if (!d) return;
  d.updatedAt = new Date().toISOString();
  saveLocal(d);
  dbSaveHabitConfig(d).catch(() => {});
}

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

export function getCustomMeta(id) { return (state.habitConfig && state.habitConfig.custom[id]) || null; }
export function setCustomMeta(id, patch) {
  if (!state.habitConfig) state.habitConfig = empty();
  state.habitConfig.custom[id] = { ...(state.habitConfig.custom[id] || {}), ...patch };
  saveHabitConfig();
}
export function deleteCustomMeta(id) {
  if (state.habitConfig && state.habitConfig.custom[id]) { delete state.habitConfig.custom[id]; saveHabitConfig(); }
}
