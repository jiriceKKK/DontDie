// ============================================================
// SCREEN TIME IMPORT — model + reconciliation (no DOM here).
//
// An iPhone Screen Time extract is a SNAPSHOT of total usage so far that day,
// not an event log. So a second paste of "Brawl Stars 80m" after a first of
// "49m" must import only the missing 31m, never another 80m. We never keep a
// drift-prone counter: "already imported" and "already logged" are derived live
// from the actual stimulation entries (by source). Imported entries carry
// source:'screen_time_import' + the app key; habit/manual logs count as already
// logged so we never double-count.
//
// Persistence: snapshot bookkeeping + remembered app→activity mappings live in
// state.stimulation (saved/synced by the existing stimulation store). No new
// table, no new localStorage key.
// ============================================================

import { state } from '../state.js';
import {
  saveStimulation, getActivities, addActivity,
  addEntryFull, importedMinutesForApp, loggedMinutesForActivity,
  blockIndexForMinutes, currentBlockIndex,
} from './store.js';

const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
function uid() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'b-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ---- classification options (one tap each) --------------------------------
// Maps the fast classifier buttons onto the real stimulation categories.
export const CLASS_OPTIONS = [
  { id: 'high_stim',       label: 'High stim',   hint: 'games · shorts · social scrolling' },
  { id: 'medium_stim',     label: 'Medium stim', hint: 'normal entertainment · chatting' },
  { id: 'productive_stim', label: 'Productive',  hint: 'school · coding · learning' },
  { id: 'low_stim',        label: 'Low / neutral', hint: 'utility · info · photos · maps' },
  { id: 'recovery',        label: 'Recovery',    hint: 'genuinely calming' },
  { id: 'ignored',         label: 'Ignore',      hint: "don't import this app" },
];
const VALID_CATS = new Set(['high_stim', 'medium_stim', 'productive_stim', 'low_stim', 'recovery']);
const DEFAULT_SCORE = { high_stim: 5, medium_stim: 3, productive_stim: 3, low_stim: 0, recovery: -2 };

// ---- app name handling ----------------------------------------------------
export function appKey(name) {
  return String(name || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ').replace(/[.]+$/, '').trim();
}

// Best-guess mappings for common apps so they don't all need classifying.
// activityId (optional) points at an existing default activity; otherwise the
// category is used and a per-app activity is created on first import.
const KNOWN = {
  'instagram': { category: 'high_stim', activityId: 'instagram' },
  'tiktok': { category: 'high_stim', activityId: 'tiktok' },
  'tik tok': { category: 'high_stim', activityId: 'tiktok' },
  'snapchat': { category: 'high_stim' },
  'reddit': { category: 'high_stim' },
  'twitter': { category: 'high_stim' }, 'x': { category: 'high_stim' },
  'facebook': { category: 'high_stim' }, 'threads': { category: 'high_stim' },
  'brawl stars': { category: 'high_stim' }, 'clash royale': { category: 'high_stim' },
  'clash of clans': { category: 'high_stim' }, 'roblox': { category: 'high_stim' },
  'minecraft': { category: 'high_stim' }, 'fortnite': { category: 'high_stim' },
  'call of duty': { category: 'high_stim' }, 'genshin impact': { category: 'high_stim' },
  'pokemon go': { category: 'medium_stim' },
  'spotify': { category: 'medium_stim', activityId: 'music' }, 'apple music': { category: 'medium_stim', activityId: 'music' },
  'netflix': { category: 'medium_stim', activityId: 'tv' }, 'disney+': { category: 'medium_stim', activityId: 'tv' },
  'twitch': { category: 'medium_stim' },
  'duolingo': { category: 'productive_stim', activityId: 'active_learn' },
  'maps': { category: 'low_stim' }, 'apple maps': { category: 'low_stim' }, 'google maps': { category: 'low_stim' },
  'weather': { category: 'low_stim' }, 'clock': { category: 'low_stim' }, 'calculator': { category: 'low_stim' },
  'settings': { category: 'low_stim' }, 'phone': { category: 'low_stim' }, 'mail': { category: 'low_stim' },
  'calendar': { category: 'low_stim' }, 'notes': { category: 'low_stim' }, 'files': { category: 'low_stim' },
  'wallet': { category: 'low_stim' }, 'health': { category: 'low_stim' }, 'reminders': { category: 'low_stim' },
};

// Apps whose meaning shifts with context — always offer a "change" even when a
// mapping is remembered (Safari is productive one day, doomscrolling the next).
const HIGHLY_AMBIGUOUS = new Set([
  'safari', 'google', 'chrome', 'youtube', 'photos', 'camera', 'discord',
  'whatsapp', 'messenger', 'telegram', 'chatgpt', 'claude', 'gemini', 'messages',
]);

export function isHighlyAmbiguous(key) { return HIGHLY_AMBIGUOUS.has(key); }

// ---- remembered mappings (state.stimulation.appMappings) ------------------
function mappings() {
  if (!state.stimulation.appMappings) state.stimulation.appMappings = {};
  return state.stimulation.appMappings;
}
export function getAppMapping(key) { return mappings()[key] || null; }
export function getAllAppMappings() {
  return Object.entries(mappings()).map(([key, m]) => ({ key, ...m }));
}
export function setAppMapping(key, patch) {
  mappings()[key] = { ...(mappings()[key] || {}), ...patch, updatedAt: new Date().toISOString() };
  saveStimulation();
}
export function deleteAppMapping(key) {
  if (mappings()[key]) { delete mappings()[key]; saveStimulation(); }
}

// Resolve how an app should be treated, before any classification this session.
//   status: 'mapped' (known/remembered) | 'ignored' | 'ambiguous' (needs a tap)
//   source: 'user' (remembered) | 'known' (built-in guess) | 'none'
//   recheck: true → remembered but context-sensitive, show a change option
export function resolveMapping(key) {
  const user = getAppMapping(key);
  if (user) {
    if (user.category === 'ignored') return { status: 'ignored', category: 'ignored', activityId: null, source: 'user', recheck: isHighlyAmbiguous(key) };
    return { status: 'mapped', category: user.category, activityId: user.activityId || null, source: 'user', recheck: isHighlyAmbiguous(key) };
  }
  if (!HIGHLY_AMBIGUOUS.has(key) && KNOWN[key]) {
    const k = KNOWN[key];
    return { status: 'mapped', category: k.category, activityId: k.activityId || null, source: 'known', recheck: false };
  }
  return { status: 'ambiguous', category: null, activityId: null, source: 'none', recheck: false };
}

// ---- parser ---------------------------------------------------------------
// Tolerant of the messy text people paste/dictate from iOS Screen Time:
//   "Brawl Stars: 49 min"  ·  "Instagram 1h 20m"  ·  "- YouTube  45m"  ·  "Safari 12"
// A leading "At 12:45:" / standalone time line becomes the snapshot time.
const IGNORE_LINE = /^(screen ?time|most used|show categories|categor|today|yesterday|this week|updated|daily average|see all activity|pick ?ups?|notifications?|limits?|total|app ?limits?)\b/i;
const TIME_RE = /\b([01]?\d|2[0-3]):([0-5]\d)\b/;
// Trailing duration: "1h 23m" / "1 h" / "49 min" / "80m" / bare "45" (= minutes).
const TAIL_RE = /\s*[:\-]?\s*(\d+\s*h(?:ours?|rs?)?(?:\s*\d+\s*m(?:in(?:ute)?s?)?)?|\d+\s*m(?:in(?:ute)?s?)?|\d+)\s*$/i;

export function parseDuration(s) {
  const t = String(s || '').toLowerCase();
  let total = 0, matched = false;
  const h = t.match(/(\d+)\s*h(?:ours?|rs?)?\b/);
  if (h) { total += parseInt(h[1], 10) * 60; matched = true; }
  const m = t.match(/(\d+)\s*m(?:in(?:ute)?s?)?\b/);
  if (m) { total += parseInt(m[1], 10); matched = true; }
  if (!matched) { const bare = t.match(/^\s*(\d+)\s*$/); if (bare) { total = parseInt(bare[1], 10); matched = true; } }
  return matched ? total : null;
}

export function timeToMinutes(hhmm) {
  const m = String(hhmm || '').match(TIME_RE);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}

// Top-level dispatcher. If the advanced DONTDIE_SCREEN_TIME_IMPORT_V1 marker is
// present anywhere in the pasted text we parse it as structured JSON and NEVER
// fall back to the line parser (so the marker line can't be read as an app). A
// fatal advanced error is surfaced to the UI instead of a silent simple parse.
export function parseScreenTime(text) {
  if (hasAdvancedMarker(text)) return parseAdvanced(text);
  return parseSimple(text);
}

function parseSimple(text) {
  const items = [];      // { rawApp, app, key, totalMin }
  const errors = [];
  let capturedAt = null; // "HH:MM"
  const byKey = {};      // dedupe within one paste → keep the max total

  String(text || '').split(/\r?\n/).forEach((line, i) => {
    const raw = line.replace(/^[\s*\-]+/, '').trim(); // strip bullets
    if (!raw) return;

    // A bare time line ("At 12:45", "12:45", "Updated 18:30") is the snapshot
    // time, not an app — capture it and skip before the duration parser, which
    // would otherwise read the trailing "45" as 45 minutes.
    const th = raw.match(/^(?:at|as of|updated|time|today)?\s*([01]?\d|2[0-3]):([0-5]\d)\s*$/i);
    if (th) { if (!capturedAt) capturedAt = `${th[1].padStart(2, '0')}:${th[2]}`; return; }

    const tm = raw.match(TAIL_RE);
    const looksLikeApp = tm && /\d/.test(tm[1]);
    if (!looksLikeApp) {
      // No trailing duration → maybe a header carrying the snapshot time.
      if (!capturedAt) { const t = raw.match(TIME_RE); if (t && !IGNORE_LINE.test(raw)) capturedAt = `${t[1].padStart(2, '0')}:${t[2]}`; }
      return;
    }
    const name = raw.slice(0, tm.index).replace(/[:\-\s]+$/, '').trim();
    if (!name || IGNORE_LINE.test(name)) return;
    const totalMin = parseDuration(tm[1]);
    if (totalMin == null || totalMin <= 0) { errors.push({ line: i + 1, reason: `couldn't read a duration in "${line.trim()}"` }); return; }

    const key = appKey(name);
    if (!key) return;
    if (byKey[key]) { byKey[key].totalMin = Math.max(byKey[key].totalMin, totalMin); }
    else { byKey[key] = { rawApp: name, app: name, key, totalMin }; items.push(byKey[key]); }
  });

  return { format: 'simple', items, capturedAt, errors, warnings: [] };
}

// ---- advanced format: DONTDIE_SCREEN_TIME_IMPORT_V1 -----------------------
// A structured JSON extract (produced by an AI from a Screen Time screenshot).
// Richer than the simple list: explicit date/snapshot time, daily total, source
// confidence, per-app guesses, plus optional hourlyEstimates / appTimeBlocks for
// estimated time placement.
export const ADV_MARKER = 'DONTDIE_SCREEN_TIME_IMPORT_V1';
export function hasAdvancedMarker(text) { return String(text || '').includes(ADV_MARKER); }

// iOS paste often turns quotes into smart/curly quotes, which break JSON.parse.
// Normalise them to plain ASCII quotes first (built from char codes so the
// source stays ASCII-clean). Apostrophes inside double-quoted values stay valid.
const SMART_DBL = new RegExp('[' + String.fromCharCode(0x201C, 0x201D, 0x201E, 0x201F, 0x2033, 0x2036) + ']', 'g');
const SMART_SGL = new RegExp('[' + String.fromCharCode(0x2018, 0x2019, 0x201A, 0x201B, 0x2032, 0x2035) + ']', 'g');
export function normalizeSmartQuotes(s) { return String(s).replace(SMART_DBL, '"').replace(SMART_SGL, "'"); }

function extractJsonObject(text) {
  const i = text.indexOf('{');
  const j = text.lastIndexOf('}');
  if (i === -1 || j === -1 || j < i) return null;
  return text.slice(i, j + 1);
}
function normTime(s) {
  const m = String(s == null ? '' : s).match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}
function pickGuess(a, b) {
  const v = String(a || b || '').toLowerCase().trim().replace(/[\s-]+/g, '_');
  if (VALID_CATS.has(v)) return v;
  if (v === 'ignored' || v === 'ignore') return 'ignored';
  return 'unknown';
}

export function parseAdvanced(text) {
  const out = { format: 'advanced', items: [], capturedAt: null, date: null, errors: [], warnings: [], meta: {}, categories: [], hourlyEstimates: [], appTimeBlocks: [] };

  const jsonRaw = extractJsonObject(String(text || ''));
  if (!jsonRaw) { out.fatal = 'Advanced Screen Time import detected, but no JSON object was found. Paste the full DONTDIE_SCREEN_TIME_IMPORT_V1 block.'; return out; }

  let data;
  try { data = JSON.parse(normalizeSmartQuotes(jsonRaw)); }
  catch (e) { out.fatal = 'Advanced Screen Time import detected, but the JSON could not be parsed. Try replacing smart quotes with normal double quotes.'; return out; }

  if (!data || typeof data !== 'object' || data.type !== ADV_MARKER) { out.fatal = 'Unsupported import type.'; return out; }

  out.date = (typeof data.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.date)) ? data.date : null;
  out.capturedAt = normTime(data.capturedAt) || normTime(data.screenTimeUpdatedAt) || null;
  out.warnings = Array.isArray(data.warnings) ? data.warnings.filter(w => typeof w === 'string') : [];
  out.categories = Array.isArray(data.categories) ? data.categories : [];
  out.hourlyEstimates = Array.isArray(data.hourlyEstimates) ? data.hourlyEstimates : [];
  out.appTimeBlocks = Array.isArray(data.appTimeBlocks) ? data.appTimeBlocks : [];
  out.meta = {
    totalScreenTimeMin: Number.isFinite(Number(data.totalScreenTimeMin)) ? Number(data.totalScreenTimeMin) : null,
    totalScreenTimeText: typeof data.totalScreenTimeText === 'string' ? data.totalScreenTimeText : null,
    device: typeof data.device === 'string' ? data.device : null,
    dateLabel: typeof data.dateLabelFromScreenshot === 'string' ? data.dateLabelFromScreenshot : null,
    sourceConfidence: (data.sourceConfidence && typeof data.sourceConfidence === 'object') ? data.sourceConfidence : {},
    unaccountedTimeMinEstimate: num(data.unaccountedTimeMinEstimate, 0),
    humanSummary: (data.humanSummary && typeof data.humanSummary === 'object') ? data.humanSummary : null,
  };

  const apps = Array.isArray(data.apps) ? data.apps : [];
  const byKey = {};
  for (const a of apps) {
    if (!a || typeof a !== 'object') continue;
    const name = String(a.name || '').trim();
    if (!name) continue;
    let mins = Number.isFinite(Number(a.durationMin)) ? Number(a.durationMin) : parseDuration(a.durationText);
    if (mins == null || mins <= 0) continue;
    const key = appKey(name);
    if (!key) continue;
    const guess = pickGuess(a.stimulationGuess, a.categoryGuess);
    if (byKey[key]) { byKey[key].totalMin = Math.max(byKey[key].totalMin, mins); }
    else { byKey[key] = { rawApp: name, app: name, key, totalMin: mins, stimulationGuess: guess, confidence: a.confidence || null, notes: a.notes || null }; out.items.push(byKey[key]); }
  }
  if (!out.items.length) { out.fatal = 'No app totals found in this import.'; return out; }
  return out;
}

// Whether an AI stimulationGuess is confident enough to auto-map (so the app
// skips the one-tap classifier). Context-sensitive apps are never auto-mapped.
export function guessApplies(it) {
  return !!(it && it.stimulationGuess && it.stimulationGuess !== 'unknown' && it.stimulationGuess !== 'ignored'
    && VALID_CATS.has(it.stimulationGuess) && !isHighlyAmbiguous(it.key));
}
function ignoredByGuess(it) {
  return !!(it && it.stimulationGuess === 'ignored' && !isHighlyAmbiguous(it.key) && !getAppMapping(it.key));
}
// Does this app still need the one-tap classifier? (No confident mapping/guess.)
export function needsClassify(it) {
  if (resolveMapping(it.key).status !== 'ambiguous') return false; // remembered or known
  return !guessApplies(it) && !ignoredByGuess(it);
}

// ---- snapshot duplicate detection -----------------------------------------
export function snapshotSignature(items) {
  return items.map(it => `${it.key}:${Math.round(it.totalMin)}`).sort().join('|');
}
function dateBatches(date) {
  const bd = state.stimulation.screenTime.byDate[date];
  return (bd && Array.isArray(bd.batches)) ? bd.batches : [];
}
// 'duplicate' (identical totals already imported) | 'update' (prior, different
// snapshot for this date) | 'fresh' (nothing imported for this date yet).
export function snapshotStatus(date, items) {
  const batches = dateBatches(date);
  if (!batches.length) return { kind: 'fresh' };
  const sig = snapshotSignature(items);
  if (batches.some(b => b.signature === sig)) return { kind: 'duplicate' };
  return { kind: 'update', batchCount: batches.length };
}

// ---- reconciliation plan --------------------------------------------------
// For each item compute: screen-time total, already manually/habit logged,
// already imported, the missing delta to import, and the suggested action.
// `classified` overrides ambiguous apps for this session: { [key]: category }.
export function buildPlan(date, items, classified = {}) {
  return items.map(it => {
    const base = resolveMapping(it.key);
    let category = base.category, status = base.status, source = base.source, activityId = base.activityId;

    if (classified[it.key]) {
      category = classified[it.key]; activityId = null; source = 'session'; status = category === 'ignored' ? 'ignored' : 'mapped';
    } else if (status === 'ambiguous') {
      // No remembered/known mapping — let a confident AI guess fill it in so the
      // app doesn't need a manual tap. Context-sensitive apps are never filled.
      if (guessApplies(it)) { category = it.stimulationGuess; activityId = null; source = 'guess'; status = 'mapped'; }
      else if (ignoredByGuess(it)) { category = 'ignored'; source = 'guess'; status = 'ignored'; }
    }

    if (status === 'ambiguous') {
      return { ...it, status: 'ambiguous', category: null, recheck: base.recheck };
    }
    if (status === 'ignored') {
      return { ...it, status: 'ignored', category: 'ignored', action: 'ignore', missing: 0, recheck: base.recheck };
    }

    // Resolve the activity this app maps to (without creating it yet — that
    // happens at confirm time so a previewed-but-cancelled import adds nothing).
    let resolvedActivityId = activityId;
    if (!resolvedActivityId) { const ex = getActivities(true).find(a => a.name.toLowerCase() === it.app.toLowerCase()); if (ex) resolvedActivityId = ex.id; }

    const alreadyImported = importedMinutesForApp(date, it.key);
    const alreadyManual = resolvedActivityId ? loggedMinutesForActivity(date, resolvedActivityId, ['manual', 'habit_link']) : 0;
    const accounted = alreadyImported + alreadyManual;
    const missing = Math.max(0, it.totalMin - accounted);
    const exceeds = accounted > it.totalMin;

    let action = 'import';
    if (missing <= 0) action = exceeds ? 'exceeds' : 'covered';

    return {
      ...it, status: 'mapped', category, source, recheck: base.recheck,
      activityId: resolvedActivityId, alreadyImported, alreadyManual, accounted, missing, exceeds, action,
    };
  });
}

// ---- commit ---------------------------------------------------------------
// Find or create the activity an imported app maps to. New per-app activities
// are tagged 'screen-time' so they're easy to spot/manage.
export function ensureImportActivity(appName, category) {
  const cat = VALID_CATS.has(category) ? category : 'medium_stim';
  const existing = getActivities(true).find(a => a.name.toLowerCase() === String(appName).toLowerCase());
  if (existing) return existing.id;
  return addActivity({
    name: appName, category, stimulationScore: DEFAULT_SCORE[cat] ?? 3,
    defaultDurationMinutes: 30, tags: ['screen-time'],
  });
}

// Round fractional allocations to whole minutes that still sum to `total`
// (largest-remainder method). weights need not be normalised.
function allocateMinutes(weights, total) {
  const sum = weights.reduce((s, w) => s + w, 0) || 1;
  const raw = weights.map(w => total * w / sum);
  const out = raw.map(Math.floor);
  let rem = total - out.reduce((s, n) => s + n, 0);
  const order = raw.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < order.length && rem > 0; k++) { out[order[k].i]++; rem--; }
  return out;
}

// Whether an advanced import carries usable time placement data.
export function hasTimePlacement(parsed) {
  return !!(parsed && parsed.format === 'advanced' &&
    ((Array.isArray(parsed.appTimeBlocks) && parsed.appTimeBlocks.length) ||
     (Array.isArray(parsed.hourlyEstimates) && parsed.hourlyEstimates.length)));
}

// Per-app placement for the 'spread' option. Prefers appTimeBlocks for the app
// (most specific), else app/category-matched hourlyEstimates, else a single
// block. Returns [{ blockIdx, minutes, timeConfidence }] summing to `mins`.
const CONF_RANK = { low: 0, medium: 1, high: 2 };
function distributePlacement(row, mins, single, opts) {
  if (mins <= 0) return [];
  let buckets = null;
  const tbs = (opts.appTimeBlocks || []).filter(tb =>
    tb && appKey(tb.appName || tb.name || '') === row.key && num(tb.durationMin, 0) > 0 && timeToMinutes(tb.start) != null);
  if (tbs.length) {
    buckets = tbs.map(tb => ({ blockIdx: blockIndexForMinutes(timeToMinutes(tb.start)), weight: num(tb.durationMin, 0), conf: tb.confidence || 'medium' }));
  } else if ((opts.hourlyEstimates || []).length) {
    const cand = opts.hourlyEstimates.filter(h => h && num(h.durationMinEstimate, 0) > 0 && timeToMinutes(h.start) != null);
    const byApp = cand.filter(h => Array.isArray(h.possibleApps) && h.possibleApps.some(p => appKey(p) === row.key));
    const byCat = cand.filter(h => Array.isArray(h.dominantCategories) && h.dominantCategories.map(c => String(c).toLowerCase()).includes(row.category));
    const use = byApp.length ? byApp : (byCat.length ? byCat : cand);
    if (use.length) buckets = use.map(h => ({ blockIdx: blockIndexForMinutes(timeToMinutes(h.start)), weight: num(h.durationMinEstimate, 0), conf: h.confidence || 'low' }));
  }
  if (!buckets || !buckets.length) return [{ blockIdx: single, minutes: mins, timeConfidence: null }];
  // Merge buckets that land in the same block (sum weights, keep lowest conf).
  const merged = {};
  for (const b of buckets) {
    const m = merged[b.blockIdx] || (merged[b.blockIdx] = { blockIdx: b.blockIdx, weight: 0, conf: b.conf });
    m.weight += b.weight;
    if ((CONF_RANK[b.conf] ?? 0) < (CONF_RANK[m.conf] ?? 0)) m.conf = b.conf;
  }
  const arr = Object.values(merged);
  const alloc = allocateMinutes(arr.map(b => b.weight), mins);
  return arr.map((b, i) => ({ blockIdx: b.blockIdx, minutes: alloc[i], timeConfidence: b.conf })).filter(x => x.minutes > 0);
}

// Import the plan. Only rows with action 'import' (missing > 0) create entries.
// Remembers each app's mapping (user-confirmed for classified ones) and records
// the batch so the next snapshot reconciles against it. opts:
//   placement: 'single' (default — snapshot-time block) | 'spread' (estimated,
//   distributed via appTimeBlocks / hourlyEstimates); hourlyEstimates,
//   appTimeBlocks: the advanced extract's arrays. Returns a summary.
export function commitImport(date, plan, capturedAt, classified = {}, opts = {}) {
  const batchId = uid();
  const single = capturedAt != null ? blockIndexForMinutes(timeToMinutes(capturedAt) ?? 0) : currentBlockIndex();
  const spread = opts.placement === 'spread';
  let importedApps = 0, importedMin = 0;

  for (const row of plan) {
    // Remember the mapping for next time.
    if (row.status === 'ignored') {
      setAppMapping(row.key, { category: 'ignored', label: row.app, userConfirmed: !!classified[row.key] });
      continue;
    }
    if (row.status !== 'mapped') continue;

    const activityId = row.activityId || ensureImportActivity(row.app, row.category);
    setAppMapping(row.key, { category: row.category, activityId, label: row.app, userConfirmed: !!classified[row.key] || row.source === 'user' });

    if (row.action !== 'import' || !(row.missing > 0)) continue;
    const placements = spread
      ? distributePlacement(row, row.missing, single, opts)
      : [{ blockIdx: single, minutes: row.missing, timeConfidence: null }];
    let appAdded = 0;
    for (const p of placements) {
      if (p.minutes <= 0) continue;
      addEntryFull(date, p.blockIdx, {
        activityId, durationMinutes: p.minutes, intensity: 1,
        source: 'screen_time_import', importApp: row.app, importAppKey: row.key,
        importBatchId: batchId, estimated: true,
        ...(p.timeConfidence ? { timeConfidence: p.timeConfidence } : {}),
      });
      appAdded += p.minutes;
    }
    if (appAdded > 0) { importedApps++; importedMin += appAdded; }
  }

  // Record the snapshot batch + latest per-app totals for this date.
  const bd = state.stimulation.screenTime.byDate[date] || (state.stimulation.screenTime.byDate[date] = { batches: [], latestByApp: {} });
  if (!Array.isArray(bd.batches)) bd.batches = [];
  if (!bd.latestByApp || typeof bd.latestByApp !== 'object') bd.latestByApp = {};
  const totalMin = plan.reduce((s, r) => s + num(r.totalMin, 0), 0);
  bd.batches.push({ id: batchId, capturedAt: capturedAt || null, signature: snapshotSignature(plan), totalMin, importedMin, placement: spread ? 'spread' : 'single', at: new Date().toISOString() });
  for (const r of plan) bd.latestByApp[r.key] = { totalMin: num(r.totalMin, 0), capturedAt: capturedAt || null };

  saveStimulation();
  return { importedApps, importedMin, batchId, placement: spread ? 'spread' : 'single' };
}
