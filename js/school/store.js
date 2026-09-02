// ============================================================
// SCHOOL STORE — single source of truth for the study planner. Same
// persistence pattern as split/mental/stimulation: runtime truth in
// state.school, localStorage immediate, Supabase best-effort (newer
// updatedAt wins), no hard dependency on the table.
//
// Owns: subjects, tests, sessions (the generated plan), results (parsed
// APP_RESULT blocks). The planner (planner.js) is pure; this module turns
// its specs into dated sessions, and re-plans when results arrive.
// ============================================================

import { state } from '../state.js';
import { persistDocument } from '../data/repository.js';
import { reportSaveResult } from '../ui/saveFeedback.js';
import { formatDate, today, addDays, parseDate } from '../utils/date.js';
import { generatePlan, suggestSession, READINESS_THRESHOLD } from './planner.js';
import { isValidSessionType } from './sessionTypes.js';
import { buildPrompt } from './prompts.js';

const LS_KEY = 'dontdie_school_v1';
const VERSION = 1;

function uid() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
const stampMs = s => Date.parse(s || 0) || 0;
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const nowIso = () => new Date().toISOString();

export const DEFAULT_SETTINGS = {
  defaultSessionMinutes: 25,
  maxStudyMinutesPerDay: 60,
  useWeekends: true,
  defaultWorstAcceptableGrade: 3,
  autoRescheduleAfterResult: true,
};

const SUBJECT_PALETTE = ['#38bdf8', '#34d399', '#f59e0b', '#f472b6', '#a78bfa', '#fb923c', '#22d3ee', '#facc15'];

function buildDefaultSchool() {
  return { version: VERSION, updatedAt: null, subjects: [], tests: [], sessions: [], results: [], settings: { ...DEFAULT_SETTINGS } };
}

// ---- load / save ----------------------------------------------------------

function loadLocal() {
  try { const raw = localStorage.getItem(LS_KEY); return raw ? JSON.parse(raw) : null; }
  catch { return null; }
}
function saveLocal(d) { try { localStorage.setItem(LS_KEY, JSON.stringify(d)); } catch {} }

function normalize(d) {
  if (!d || typeof d !== 'object') d = buildDefaultSchool();
  d.version = VERSION;
  d.settings = { ...DEFAULT_SETTINGS, ...(d.settings || {}) };
  d.settings.defaultWorstAcceptableGrade = clamp(num(d.settings.defaultWorstAcceptableGrade, 3), 1, 5);
  d.settings.defaultSessionMinutes = clamp(num(d.settings.defaultSessionMinutes, 25), 5, 120);
  d.settings.maxStudyMinutesPerDay = clamp(num(d.settings.maxStudyMinutesPerDay, 60), 10, 600);

  d.subjects = Array.isArray(d.subjects) ? d.subjects : [];
  for (const s of d.subjects) {
    if (!s.id) s.id = uid();
    s.name = String(s.name || 'Untitled');
    s.color = s.color || SUBJECT_PALETTE[0];
    s.defaultDifficulty = clamp(num(s.defaultDifficulty, 3), 1, 5);
    if (s.archived === undefined) s.archived = false;
  }
  d.tests = Array.isArray(d.tests) ? d.tests : [];
  for (const t of d.tests) {
    if (!t.id) t.id = uid();
    t.title = String(t.title || 'Untitled test');
    t.topics = Array.isArray(t.topics) ? t.topics : [];
    t.weakTopics = Array.isArray(t.weakTopics) ? t.weakTopics : [];
    t.strongTopics = Array.isArray(t.strongTopics) ? t.strongTopics : [];
    t.worstAcceptableGrade = clamp(num(t.worstAcceptableGrade, 3), 1, 5);
    t.targetGrade = clamp(num(t.targetGrade, 1), 1, 5);
    t.importance = clamp(num(t.importance, 3), 1, 5);
    t.currentReadiness = clamp(num(t.currentReadiness, 0), 0, 100);
    t.lastScore = (t.lastScore == null) ? null : clamp(num(t.lastScore, 0), 0, 100);
    t.status = ['active', 'completed', 'archived'].includes(t.status) ? t.status : 'active';
    if (!t.createdAt) t.createdAt = nowIso();
    if (!t.updatedAt) t.updatedAt = t.createdAt;
  }
  d.sessions = Array.isArray(d.sessions) ? d.sessions : [];
  for (const s of d.sessions) {
    if (!s.id) s.id = uid();
    if (!isValidSessionType(s.sessionType)) s.sessionType = 'mixed_quiz';
    s.minutes = clamp(num(s.minutes, 25), 5, 180);
    s.status = ['planned', 'done', 'skipped'].includes(s.status) ? s.status : 'planned';
    s.targetTopics = Array.isArray(s.targetTopics) ? s.targetTopics : [];
    s.source = ['auto', 'manual_extra', 'quick_review'].includes(s.source) ? s.source : 'auto';
    s.addedManually = s.source !== 'auto';
    if (!s.createdAt) s.createdAt = nowIso();
  }
  d.results = Array.isArray(d.results) ? d.results : [];
  for (const r of d.results) {
    if (!r.id) r.id = uid();
    r.weakTopics = Array.isArray(r.weakTopics) ? r.weakTopics : [];
    r.strongTopics = Array.isArray(r.strongTopics) ? r.strongTopics : [];
    if (!r.createdAt) r.createdAt = nowIso();
  }
  return d;
}

export function initSchool(localDocument) {
  const chosen = normalize(localDocument || loadLocal() || buildDefaultSchool());
  if (!chosen.updatedAt) chosen.updatedAt = nowIso();
  state.school = chosen;
  saveLocal(chosen);
}

/** Replace the in-memory copy with one the reconciler adopted from the cloud. */
export function adoptSchool(data) {
  state.school = normalize(data);
  saveLocal(state.school);
}

export function saveSchool() {
  const d = state.school;
  d.updatedAt = nowIso();
  saveLocal(d);
  return persistDocument('school', d).then(result => {
    reportSaveResult('School', result);
    return result;
  });
}

export { normalize as normalizeSchoolDocument };

export function getSchool() { return state.school; }
export function getSettings() { return state.school.settings; }
export function updateSettings(patch) {
  const s = state.school.settings;
  if (patch.defaultSessionMinutes !== undefined) s.defaultSessionMinutes = clamp(num(patch.defaultSessionMinutes, s.defaultSessionMinutes), 5, 120);
  if (patch.maxStudyMinutesPerDay !== undefined) s.maxStudyMinutesPerDay = clamp(num(patch.maxStudyMinutesPerDay, s.maxStudyMinutesPerDay), 10, 600);
  if (patch.useWeekends !== undefined) s.useWeekends = !!patch.useWeekends;
  if (patch.defaultWorstAcceptableGrade !== undefined) s.defaultWorstAcceptableGrade = clamp(num(patch.defaultWorstAcceptableGrade, s.defaultWorstAcceptableGrade), 1, 5);
  if (patch.autoRescheduleAfterResult !== undefined) s.autoRescheduleAfterResult = !!patch.autoRescheduleAfterResult;
  saveSchool();
}
export function resetSchool() {
  state.school = normalize(buildDefaultSchool());
  state.school.updatedAt = nowIso();
  saveSchool();
}

// ---- subjects -------------------------------------------------------------

export function getSubjects(includeArchived = false) {
  const list = state.school.subjects;
  return includeArchived ? list : list.filter(s => !s.archived);
}
export function findSubject(id) { return state.school.subjects.find(s => s.id === id) || null; }
export function subjectName(id) { const s = findSubject(id); return s ? s.name : 'Unknown subject'; }
export function subjectColor(id) { const s = findSubject(id); return s ? s.color : 'var(--text-muted)'; }

export function addSubject({ name, color, defaultDifficulty }) {
  const id = uid();
  const used = state.school.subjects.length;
  state.school.subjects.push({
    id, name: String(name || 'Untitled').trim() || 'Untitled',
    color: color || SUBJECT_PALETTE[used % SUBJECT_PALETTE.length],
    defaultDifficulty: clamp(num(defaultDifficulty, 3), 1, 5),
    archived: false,
  });
  saveSchool();
  return id;
}
export function updateSubject(id, patch) {
  const s = findSubject(id);
  if (!s) return;
  if (patch.name !== undefined) s.name = String(patch.name).trim() || s.name;
  if (patch.color !== undefined) s.color = patch.color;
  if (patch.defaultDifficulty !== undefined) s.defaultDifficulty = clamp(num(patch.defaultDifficulty, s.defaultDifficulty), 1, 5);
  if (patch.archived !== undefined) s.archived = !!patch.archived;
  saveSchool();
}
export function deleteSubject(id) {
  state.school.subjects = state.school.subjects.filter(s => s.id !== id);
  saveSchool();
}

// ---- date helpers ---------------------------------------------------------

export function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = parseDate(dateStr);
  if (!d || isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today().getTime()) / 86400000);
}

// ---- tests ----------------------------------------------------------------

export function getTests(filter = 'active') {
  const list = state.school.tests;
  if (filter === 'all') return list;
  return list.filter(t => t.status === filter);
}
export function findTest(id) { return state.school.tests.find(t => t.id === id) || null; }

// Decorate a test with derived fields for the UI (never persisted).
export function decorateTest(t) {
  if (!t) return null;
  const du = daysUntil(t.testDate);
  return { ...t, _daysUntil: du, _risk: riskLevel(t), _readiness: clamp(num(t.currentReadiness, 0), 0, 100) };
}

export function addTest(data) {
  const id = uid();
  const s = state.school.settings;
  const t = {
    id,
    subjectId: data.subjectId || null,
    title: String(data.title || 'Untitled test').trim() || 'Untitled test',
    topics: Array.isArray(data.topics) ? data.topics : [],
    testDate: data.testDate || formatDate(addDays(today(), 14)),
    targetGrade: clamp(num(data.targetGrade, 1), 1, 5),
    worstAcceptableGrade: clamp(num(data.worstAcceptableGrade, s.defaultWorstAcceptableGrade), 1, 5),
    importance: clamp(num(data.importance, 3), 1, 5),
    currentReadiness: 0,
    weakTopics: [],
    strongTopics: [],
    lastScore: null,
    status: 'active',
    notes: String(data.notes || ''),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  state.school.tests.push(t);
  regeneratePlanForTest(id);
  saveSchool();
  return id;
}

export function updateTest(id, patch) {
  const t = findTest(id);
  if (!t) return;
  const replanKeys = ['testDate', 'worstAcceptableGrade', 'topics', 'status'];
  let replan = false;
  for (const k of ['subjectId', 'title', 'topics', 'testDate', 'targetGrade', 'worstAcceptableGrade', 'importance', 'notes', 'status', 'weakTopics', 'strongTopics']) {
    if (patch[k] !== undefined) {
      if (replanKeys.includes(k)) replan = true;
      if (['targetGrade', 'worstAcceptableGrade', 'importance'].includes(k)) t[k] = clamp(num(patch[k], t[k]), 1, 5);
      else t[k] = patch[k];
    }
  }
  t.updatedAt = nowIso();
  if (replan) regeneratePlanForTest(id);
  saveSchool();
}

export function deleteTest(id) {
  state.school.tests = state.school.tests.filter(t => t.id !== id);
  state.school.sessions = state.school.sessions.filter(s => s.testId !== id);
  saveSchool();
}
export function setTestStatus(id, status) { updateTest(id, { status }); }

// ---- readiness / risk -----------------------------------------------------

function blendReadiness(prev, score, confidence) {
  if (score == null || !Number.isFinite(score)) return prev;
  const w = confidence === 'high' ? 0.7 : confidence === 'low' ? 0.45 : 0.6;
  const base = prev > 0 ? Math.round((1 - w) * prev + w * score) : score;
  return clamp(base, 0, 100);
}

export function riskLevel(t) {
  if (!t) return 'medium';
  const thr = READINESS_THRESHOLD[clamp(num(t.worstAcceptableGrade, 3), 1, 5)] || 65;
  const r = clamp(num(t.currentReadiness, 0), 0, 100);
  const du = daysUntil(t.testDate);
  let risk = r >= thr ? 'low' : r >= thr - 20 ? 'medium' : 'high';
  if (du != null && du <= 2 && r < thr) risk = 'high';
  return risk;
}

// ---- sessions / plan ------------------------------------------------------

export function getSessions(filter) {
  const list = state.school.sessions;
  if (!filter) return list;
  return list.filter(filter);
}
export function findSession(id) { return state.school.sessions.find(s => s.id === id) || null; }
export function sessionsForTest(testId) { return state.school.sessions.filter(s => s.testId === testId); }

export function sessionsForDate(dateStr) {
  return state.school.sessions
    .filter(s => s.date === dateStr && s.status !== 'skipped')
    .sort((a, b) => b.minutes - a.minutes);
}
export function todaySessions() { return sessionsForDate(formatDate(today())); }

// Planned sessions whose date is before today and not done/skipped.
export function missedSessions() {
  const todayStr = formatDate(today());
  return state.school.sessions.filter(s => s.status === 'planned' && s.date < todayStr);
}

export function plannedMinutesForDate(dateStr) {
  return sessionsForDate(dateStr).filter(s => s.status === 'planned').reduce((sum, s) => sum + num(s.minutes, 0), 0);
}

// Replace future planned sessions for a test with a freshly generated plan.
// Keeps history (done/skipped, and anything dated before today) intact.
export function regeneratePlanForTest(testId) {
  const t = findTest(testId);
  const todayStr = formatDate(today());

  // Drop future AUTO planned sessions for this test; keep history + done/skipped,
  // and keep manually-added extras / quick reviews (the auto planner must never
  // silently delete sessions the user created by hand).
  state.school.sessions = state.school.sessions.filter(s =>
    s.testId !== testId || s.status !== 'planned' || s.date < todayStr || s.source !== 'auto');

  if (!t || t.status !== 'active') return;
  const du = daysUntil(t.testDate);
  if (du == null || du < 0) return; // past/invalid date → no new sessions

  const hasData = t.lastScore != null || sessionsForTest(testId).some(s => s.status === 'done' && s.resultId);
  const specs = generatePlan({
    daysUntilTest: du,
    worstAcceptableGrade: t.worstAcceptableGrade,
    lastScore: t.lastScore,
    weakTopics: t.weakTopics,
    topics: t.topics,
    hasData,
  });

  const useWeekends = state.school.settings.useWeekends;
  const taken = new Set(sessionsForTest(testId).filter(s => s.date >= todayStr).map(s => s.date));

  for (const spec of specs) {
    let date = formatDate(addDays(today(), spec.dayOffset));
    // Skip future weekend slots when weekends are off (keep slot 0 + final slots).
    if (!useWeekends && spec.dayOffset > 0 && spec.sessionType !== 'final_review') {
      const dow = addDays(today(), spec.dayOffset).getDay();
      if (dow === 0 || dow === 6) continue;
    }
    if (taken.has(date)) continue; // one session per day per test
    taken.add(date);
    state.school.sessions.push({
      id: uid(),
      testId,
      subjectId: t.subjectId,
      date,
      sessionType: spec.sessionType,
      minutes: spec.minutes,
      status: 'planned',
      source: 'auto',
      addedManually: false,
      reason: spec.reason,
      targetTopics: spec.targetTopics,
      promptTemplateId: spec.sessionType,
      resultId: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
  }
}

// ---- extra (manually added) sessions --------------------------------------

// Recent session types for a test up to & including `dateStr`, oldest→newest.
// Used so repeated extras on one day progress instead of repeating a type.
function recentTypesForTest(testId, dateStr) {
  return state.school.sessions
    .filter(s => s.testId === testId && s.status !== 'skipped' && s.date <= dateStr)
    .sort((a, b) => a.date.localeCompare(b.date) || stampMs(a.createdAt) - stampMs(b.createdAt))
    .map(s => s.sessionType);
}

// Propose (without saving) the best extra session for a test on a given day.
// Returns { ok, error?, spec, isTestDay }. spec = { sessionType, minutes,
// reason, targetTopics, source }. Pure preview — the modal renders this.
export function extraSessionSpec(testId, dateStr) {
  const t = findTest(testId);
  if (!t) return { ok: false, error: 'Pick a test first.' };
  if (t.status === 'archived') return { ok: false, error: 'This test is archived.' };
  if (t.status === 'completed') return { ok: false, error: 'This test is already completed.' };
  if (!dateStr) return { ok: false, error: 'No day selected.' };

  const todayStr = formatDate(today());
  if (dateStr < todayStr) return { ok: false, error: 'Pick today or a future day.' };

  const remaining = daysUntil(t.testDate);
  if (remaining == null) return { ok: false, error: 'This test has no valid date.' };

  // remaining is days from TODAY to the test; for the chosen day it shifts.
  const dayToTest = Math.round((parseDate(t.testDate).getTime() - parseDate(dateStr).getTime()) / 86400000);
  if (dayToTest < 0) return { ok: false, error: 'That day is after the test date.' };
  const isTestDay = dayToTest === 0;

  const hasData = t.lastScore != null || sessionsForTest(testId).some(s => s.status === 'done' && s.resultId);
  const spec = suggestSession({
    remaining: dayToTest,
    worstAcceptableGrade: t.worstAcceptableGrade,
    lastScore: t.lastScore,
    weakTopics: t.weakTopics,
    topics: t.topics,
    hasData,
    recentTypes: recentTypesForTest(testId, dateStr),
    isTestDay,
  });
  if (!spec) return { ok: false, error: 'Could not propose a session for that day.' };
  spec.source = isTestDay ? 'quick_review' : 'manual_extra';
  return { ok: true, spec, isTestDay };
}

// Create and persist an extra session. opts.minutes optionally overrides the
// suggested duration. Returns { ok, error?, sessionId }.
export function addExtraSession(testId, dateStr, opts = {}) {
  const proposal = extraSessionSpec(testId, dateStr);
  if (!proposal.ok) return { ok: false, error: proposal.error };
  const { spec } = proposal;
  const t = findTest(testId);

  let minutes = spec.minutes;
  if (opts.minutes != null && String(opts.minutes).trim() !== '') {
    const n = num(opts.minutes, minutes);
    if (Number.isFinite(n) && n > 0) minutes = clamp(Math.round(n), 5, 180);
  }

  const id = uid();
  state.school.sessions.push({
    id,
    testId,
    subjectId: t.subjectId,
    date: dateStr,
    sessionType: spec.sessionType,
    minutes,
    status: 'planned',
    source: spec.source,
    addedManually: true,
    reason: spec.reason,
    targetTopics: spec.targetTopics,
    promptTemplateId: spec.sessionType,
    resultId: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  saveSchool();
  return { ok: true, sessionId: id };
}

export function markSessionDone(id) {
  const s = findSession(id);
  if (!s) return;
  s.status = 'done';
  s.doneAt = nowIso();
  s.updatedAt = nowIso();
  saveSchool();
}
export function skipSession(id) {
  const s = findSession(id);
  if (!s) return;
  s.status = 'skipped';
  s.updatedAt = nowIso();
  saveSchool();
}
export function rescheduleSession(id, newDate) {
  const s = findSession(id);
  if (!s || !newDate) return;
  s.date = newDate;
  s.status = 'planned';
  s.updatedAt = nowIso();
  saveSchool();
}
export function deleteSession(id) {
  state.school.sessions = state.school.sessions.filter(s => s.id !== id);
  saveSchool();
}

// Build the copy-paste prompt for a session (gathers test/subject/last result).
export function promptForSession(id) {
  const s = findSession(id);
  if (!s) return '';
  const test = decorateTest(findTest(s.testId));
  const subject = findSubject(s.subjectId);
  const lastResult = latestResultForTest(s.testId);
  return buildPrompt(s, { test, subject, lastResult });
}

// ---- results / APP_RESULT parsing ----------------------------------------

export function getResults() { return [...state.school.results].sort((a, b) => stampMs(b.createdAt) - stampMs(a.createdAt)); }
export function resultsForTest(testId) { return getResults().filter(r => r.testId === testId); }
export function latestResultForTest(testId) { return resultsForTest(testId)[0] || null; }

const KEY_ALIASES = {
  subject: 'subject', topic: 'topic', session_type: 'sessionType',
  score_percent: 'scorePercent', weak_topics: 'weakTopics', strong_topics: 'strongTopics',
  recommended_next_session: 'recommendedNextSession', recommended_minutes: 'recommendedMinutes',
  confidence: 'confidence',
};

function topicArray(val) {
  if (val == null) return [];
  return String(val).replace(/^\[|\]$/g, '').split(/[,;]/).map(s => s.trim())
    .filter(s => s && !/^none$/i.test(s) && !/^n\/?a$/i.test(s));
}

// Parse an APP_RESULT block. Returns { ok, value } or { ok:false, error }.
export function parseAppResult(text) {
  const raw = String(text || '');
  const m = raw.match(/APP_RESULT([\s\S]*?)END_APP_RESULT/i);
  if (!m) return { ok: false, error: 'Could not find an APP_RESULT … END_APP_RESULT block.' };

  const body = m[1];
  const fields = {};
  for (const line of body.split(/\r?\n/)) {
    const mm = line.match(/^\s*([a-z_]+)\s*:\s*(.*)$/i);
    if (!mm) continue;
    const key = KEY_ALIASES[mm[1].toLowerCase()];
    if (key) fields[key] = mm[2].trim();
  }

  if (!fields.sessionType) return { ok: false, error: 'Missing session_type in the block.' };
  const sessionTypeVal = fields.sessionType.toLowerCase().replace(/[^a-z_]/g, '');
  if (!isValidSessionType(sessionTypeVal)) return { ok: false, error: `Unknown session_type "${fields.sessionType}".` };

  let scorePercent = null;
  if (fields.scorePercent != null && !/^n\/?a$/i.test(fields.scorePercent.trim()) && fields.scorePercent.trim() !== '') {
    const n = Number(String(fields.scorePercent).replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(n)) return { ok: false, error: `score_percent is not a number or n/a ("${fields.scorePercent}").` };
    scorePercent = clamp(Math.round(n), 0, 100);
  }

  let recommendedMinutes = null;
  if (fields.recommendedMinutes != null) {
    const n = Number(String(fields.recommendedMinutes).replace(/[^0-9.]/g, ''));
    if (Number.isFinite(n)) recommendedMinutes = clamp(Math.round(n), 0, 180);
  }
  const conf = (fields.confidence || '').toLowerCase();
  const confidence = ['low', 'medium', 'high'].includes(conf) ? conf : null;
  let recNext = (fields.recommendedNextSession || '').toLowerCase().replace(/[^a-z_]/g, '');
  if (!isValidSessionType(recNext) && recNext !== 'none') recNext = null;

  return {
    ok: true,
    value: {
      subject: fields.subject || '',
      topic: fields.topic || '',
      sessionType: sessionTypeVal,
      scorePercent,
      weakTopics: topicArray(fields.weakTopics),
      strongTopics: topicArray(fields.strongTopics),
      recommendedNextSession: recNext,
      recommendedMinutes,
      confidence,
      rawText: m[0],
    },
  };
}

// Try to link a parsed result to a test when none was given explicitly.
function inferTestId(value) {
  const active = getTests('active');
  const subj = (value.subject || '').toLowerCase().trim();
  const topic = (value.topic || '').toLowerCase().trim();
  // Best: subject name match + topic/title overlap.
  const bySubject = active.filter(t => subjectName(t.subjectId).toLowerCase() === subj && subj);
  if (bySubject.length === 1) return bySubject[0].id;
  if (bySubject.length > 1 && topic) {
    const hit = bySubject.find(t => topic.includes(t.title.toLowerCase()) || t.title.toLowerCase().includes(t.title.toLowerCase()));
    if (hit) return hit.id;
  }
  if (bySubject.length) return bySubject[0].id;
  // Fallback: only one active test overall.
  if (active.length === 1) return active[0].id;
  return null;
}

// Store a parsed APP_RESULT, link it, update readiness/weak topics, re-plan.
// ctx: { testId?, sessionId? }. Returns { ok, error?, result?, testId? }.
export function addResultFromText(text, ctx = {}) {
  const parsed = parseAppResult(text);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const v = parsed.value;

  let testId = ctx.testId || null;
  let sessionId = ctx.sessionId || null;
  if (!testId && sessionId) { const s = findSession(sessionId); if (s) testId = s.testId; }
  if (!testId) testId = inferTestId(v);

  const result = {
    id: uid(),
    testId: testId || null,
    sessionId: sessionId || null,
    subject: v.subject,
    topic: v.topic,
    sessionType: v.sessionType,
    scorePercent: v.scorePercent,
    weakTopics: v.weakTopics,
    strongTopics: v.strongTopics,
    recommendedNextSession: v.recommendedNextSession,
    recommendedMinutes: v.recommendedMinutes,
    confidence: v.confidence,
    rawText: v.rawText,
    createdAt: nowIso(),
  };
  state.school.results.push(result);

  // Mark the originating session done.
  if (sessionId) {
    const s = findSession(sessionId);
    if (s) { s.status = 'done'; s.resultId = result.id; s.doneAt = nowIso(); s.updatedAt = nowIso(); }
  }

  // Update the test from the result.
  const t = testId ? findTest(testId) : null;
  if (t) {
    if (v.scorePercent != null) {
      t.lastScore = v.scorePercent;
      t.currentReadiness = blendReadiness(num(t.currentReadiness, 0), v.scorePercent, v.confidence);
    }
    if (v.weakTopics.length) t.weakTopics = v.weakTopics.slice(0, 12);
    if (v.strongTopics.length) t.strongTopics = v.strongTopics.slice(0, 12);
    t.updatedAt = nowIso();
    if (state.school.settings.autoRescheduleAfterResult) regeneratePlanForTest(testId);
  }

  saveSchool();
  return { ok: true, result, testId };
}

// ---- stats helpers --------------------------------------------------------

export function sessionCounts() {
  const all = state.school.sessions;
  return {
    planned: all.filter(s => s.status === 'planned').length,
    done: all.filter(s => s.status === 'done').length,
    skipped: all.filter(s => s.status === 'skipped').length,
  };
}
export function minutesStudied() {
  return state.school.sessions.filter(s => s.status === 'done').reduce((sum, s) => sum + num(s.minutes, 0), 0);
}
export function scoreSeriesForTest(testId) {
  return resultsForTest(testId).filter(r => r.scorePercent != null)
    .sort((a, b) => stampMs(a.createdAt) - stampMs(b.createdAt))
    .map(r => ({ score: r.scorePercent, type: r.sessionType, at: r.createdAt }));
}
