// ============================================================
// SPLIT STORE — single source of truth for the editable split.
//
// Runtime truth = state.split. Persisted to localStorage immediately
// (instant + offline-safe) and pushed best-effort to Supabase so it
// syncs across devices and can be included in the existing export.
// An `updatedAt` stamp reconciles local vs cloud on load.
// ============================================================

import { state } from '../state.js';
import { dbSaveSplitConfig } from '../db.js';
import { showToast } from '../ui/toast.js';
import { buildDefaultSplit, SPLIT_VERSION } from './defaultSplit.js';

const LS_KEY = 'dontdie_split_v1';

let _cloudOk = true; // tracks last cloud push result, to toast only on change

function uid() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ---- persistence helpers --------------------------------------------------

function loadLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveLocal(split) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(split)); } catch {}
}

// Ensure every structural field exists and every editable item has a stable
// uid. Runs on load so older/partial data and the default seed are consistent.
function normalize(split) {
  if (!split || typeof split !== 'object') split = buildDefaultSplit();
  split.version = SPLIT_VERSION;
  if (!Array.isArray(split.muscles) || !split.muscles.length) split.muscles = buildDefaultSplit().muscles;
  if (!Array.isArray(split.library)) split.library = [];
  if (!Array.isArray(split.days))    split.days = [];
  if (!split.warmup) split.warmup = { title: '', duration: '', items: [] };
  if (!Array.isArray(split.notes))   split.notes = [];

  for (const ex of split.library) {
    if (!Array.isArray(ex.tags)) ex.tags = [];
    for (const tag of ex.tags) if (tag.count === undefined) tag.count = true;
  }

  for (const day of split.days) {
    if (day.gym && Array.isArray(day.gym.groups)) {
      for (const grp of day.gym.groups) {
        if (!Array.isArray(grp.items)) grp.items = [];
        for (const it of grp.items) if (!it.uid) it.uid = uid();
      }
    }
    if (!day.mobility) day.mobility = { label: '', items: [] };
    if (!Array.isArray(day.mobility.items)) day.mobility.items = [];
    for (const it of day.mobility.items) if (!it.uid) it.uid = uid();
  }
  return split;
}

// ---- public: load / save --------------------------------------------------

const stamp = s => Date.parse(s || 0) || 0;

// Called once at startup with whatever Supabase returned (or null).
export function initSplit(remote) {
  const local = loadLocal();
  let chosen;
  if (remote && local) chosen = stamp(remote.updatedAt) >= stamp(local.updatedAt) ? remote : local;
  else                 chosen = remote || local || buildDefaultSplit();

  chosen = normalize(chosen);
  if (!chosen.updatedAt) chosen.updatedAt = new Date().toISOString(); // stamp a fresh seed
  state.split = chosen;
  saveLocal(chosen);

  // Push up if the cloud has nothing, or our chosen copy is newer (e.g. the
  // initial seed, or offline edits made on a previous run). Best effort.
  if (!remote || stamp(chosen.updatedAt) > stamp(remote.updatedAt)) {
    dbSaveSplitConfig(chosen).catch(() => {});
  }
}

// Persist after any edit: stamp, write local now, push cloud best-effort.
export function saveSplit() {
  const split = state.split;
  split.updatedAt = new Date().toISOString();
  saveLocal(split);
  dbSaveSplitConfig(split).then(({ error }) => {
    if (error && _cloudOk) { _cloudOk = false; showToast('Saved on this device · cloud sync unavailable', 'warning'); }
    else if (!error && !_cloudOk) { _cloudOk = true; showToast('Split synced', 'success'); }
  });
}

export function getSplit() { return state.split; }
export function getMuscles() { return state.split.muscles; }
export function getLibrary() { return state.split.library; }
export function findLibrary(ref) { return state.split.library.find(e => e.id === ref) || null; }

// Name shown for a gym item (falls back gracefully if its library entry is gone)
export function exerciseName(ref) {
  const ex = findLibrary(ref);
  return ex ? ex.name : '(removed)';
}

// ---- volume ---------------------------------------------------------------

// Weekly planned volume per muscle: { muscleId: { direct, indirect } }.
// Sums planned sets of every gym item whose library tags count toward a muscle.
export function computeVolume() {
  const vol = {};
  for (const mus of state.split.muscles) vol[mus.id] = { direct: 0, indirect: 0 };

  for (const day of state.split.days) {
    if (!day.gym || !Array.isArray(day.gym.groups)) continue;
    for (const grp of day.gym.groups) {
      for (const it of grp.items) {
        const ex = findLibrary(it.ref);
        if (!ex) continue;
        const sets = Number(it.sets) || 0;
        for (const tag of ex.tags) {
          if (tag.count === false) continue;
          const bucket = vol[tag.muscle];
          if (!bucket) continue;
          if (tag.type === 'indirect') bucket.indirect += sets;
          else bucket.direct += sets;
        }
      }
    }
  }
  return vol;
}

// ---- gym library + item CRUD ----------------------------------------------

// Create a new library exercise, returns its id.
export function addLibraryExercise({ name, tags = [], sets = 3, reps = '', rest = '' }) {
  const id = uid();
  state.split.library.push({ id, name, tags, sets, reps, rest });
  return id;
}

// Update an existing library exercise (shared name/tags/defaults — affects
// every day that uses it).
export function updateLibraryExercise(ref, patch) {
  const ex = findLibrary(ref);
  if (ex) Object.assign(ex, patch);
}

function findDay(dow) { return state.split.days.find(d => d.dow === dow) || null; }

// Locate a gym item by uid -> { day, group, item, gi (group idx), ii (item idx) }
function locateGymItem(itemUid) {
  for (const day of state.split.days) {
    if (!day.gym) continue;
    for (let gi = 0; gi < day.gym.groups.length; gi++) {
      const grp = day.gym.groups[gi];
      const ii = grp.items.findIndex(it => it.uid === itemUid);
      if (ii !== -1) return { day, group: grp, item: grp.items[ii], gi, ii };
    }
  }
  return null;
}

function ensureGroup(day, groupName) {
  let grp = day.gym.groups.find(x => x.name === groupName);
  if (!grp) { grp = { name: groupName, items: [] }; day.gym.groups.push(grp); }
  return grp;
}

export function addGymItem(dow, groupName, { ref, sets, reps = '', rest = '' }) {
  const day = findDay(dow);
  if (!day) return;
  if (!day.gym) day.gym = { title: day.name, groups: [] };
  const grp = ensureGroup(day, groupName || 'Other');
  grp.items.push({ uid: uid(), ref, sets: Number(sets) || 0, reps, rest });
}

export function updateGymItem(itemUid, patch) {
  const loc = locateGymItem(itemUid);
  if (!loc) return;
  const next = {
    ref:  patch.ref  !== undefined ? patch.ref  : loc.item.ref,
    sets: patch.sets !== undefined ? Number(patch.sets) || 0 : loc.item.sets,
    reps: patch.reps !== undefined ? patch.reps : loc.item.reps,
    rest: patch.rest !== undefined ? patch.rest : loc.item.rest,
  };
  const targetDow   = patch.dow   !== undefined ? patch.dow   : loc.day.dow;
  const targetGroup = patch.group !== undefined ? patch.group : loc.group.name;

  // Remove from current location (and prune now-empty group).
  loc.group.items.splice(loc.ii, 1);
  if (loc.group.items.length === 0) {
    loc.day.gym.groups = loc.day.gym.groups.filter(x => x !== loc.group);
  }
  // Insert into target.
  addGymItem(targetDow, targetGroup, next);
  // addGymItem assigns a fresh uid; keep the original so callers stay valid.
  const reloc = findDay(targetDow);
  const grp = reloc.gym.groups.find(x => x.name === targetGroup);
  grp.items[grp.items.length - 1].uid = itemUid;
}

export function deleteGymItem(itemUid) {
  const loc = locateGymItem(itemUid);
  if (!loc) return;
  loc.group.items.splice(loc.ii, 1);
  if (loc.group.items.length === 0) {
    loc.day.gym.groups = loc.day.gym.groups.filter(x => x !== loc.group);
  }
}

// Everything the gym edit modal needs about one item (merges item + library).
export function gymItemContext(itemUid) {
  const loc = locateGymItem(itemUid);
  if (!loc) return null;
  const ex = findLibrary(loc.item.ref);
  return {
    uid: itemUid,
    dow: loc.day.dow,
    group: loc.group.name,
    ref: loc.item.ref,
    sets: loc.item.sets,
    reps: loc.item.reps || '',
    rest: loc.item.rest || '',
    name: ex ? ex.name : '',
    tags: ex ? JSON.parse(JSON.stringify(ex.tags)) : [],
  };
}

// Distinct gym section names across all days (for the "section" datalist).
export function gymGroupNames() {
  const set = new Set();
  for (const day of state.split.days) {
    if (!day.gym) continue;
    for (const grp of day.gym.groups) set.add(grp.name);
  }
  return [...set];
}

// ---- mobility item CRUD ---------------------------------------------------

function locateMobItem(itemUid) {
  for (const day of state.split.days) {
    const ii = day.mobility.items.findIndex(it => it.uid === itemUid);
    if (ii !== -1) return { day, item: day.mobility.items[ii], ii };
  }
  return null;
}

export function addMobilityItem(dow, { name, detail = '', priority = false, pails = false }) {
  const day = findDay(dow);
  if (!day) return;
  day.mobility.items.push({ uid: uid(), name, detail, priority, pails });
}

export function updateMobilityItem(itemUid, patch) {
  const loc = locateMobItem(itemUid);
  if (!loc) return;
  const targetDow = patch.dow !== undefined ? patch.dow : loc.day.dow;
  const next = {
    uid: itemUid,
    name:     patch.name     !== undefined ? patch.name     : loc.item.name,
    detail:   patch.detail   !== undefined ? patch.detail   : loc.item.detail,
    priority: patch.priority !== undefined ? patch.priority : loc.item.priority,
    pails:    patch.pails    !== undefined ? patch.pails    : loc.item.pails,
  };
  loc.day.mobility.items.splice(loc.ii, 1);
  const day = findDay(targetDow);
  if (day) day.mobility.items.push(next);
}

export function deleteMobilityItem(itemUid) {
  const loc = locateMobItem(itemUid);
  if (loc) loc.day.mobility.items.splice(loc.ii, 1);
}

// Everything the mobility edit modal needs about one item.
export function mobItemContext(itemUid) {
  const loc = locateMobItem(itemUid);
  if (!loc) return null;
  return {
    uid: itemUid,
    dow: loc.day.dow,
    name: loc.item.name,
    detail: loc.item.detail || '',
    priority: !!loc.item.priority,
    pails: !!loc.item.pails,
  };
}

// Distinct mobility exercise names (used as add suggestions).
export function mobilityNameSuggestions() {
  const set = new Set();
  for (const day of state.split.days) {
    for (const it of day.mobility.items) set.add(it.name);
  }
  for (const it of state.split.warmup.items || []) set.add(it.name);
  return [...set];
}
