// ============================================================
// MIND · TEXTS STORE — single source of truth for the guided reading
// library: imported texts, the unread queue, the currently-open text,
// reading time, progress, highlights and reflections.
//
// Persistence mirrors the other module stores: runtime truth lives in
// state.mindTexts, is written to localStorage immediately, and is pushed
// best-effort to the optional `mind_texts_store` Supabase row (newer
// updatedAt wins). If that table is absent, everything still works fully
// from localStorage — a missing table never breaks startup.
//
// This file holds ONLY data + rules. Parsing lives in parser.js, prompt/
// feedback text in prompts.js, and all UI in reader.js / highlights.js /
// tabs/texts.js.
// ============================================================

import { state } from '../../state.js';
import { dbSaveMindTextsStore } from '../../db.js';
import { showToast } from '../../ui/toast.js';

const LS_KEY = 'dontdie_mind_texts_v1';
const SCHEMA_VERSION = 1;
const STATUSES = ['unread', 'reading', 'reflection', 'completed'];

let _cloudOk = true;
let _cloudTimer = null;

function uid() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
const stampMs = s => Date.parse(s || 0) || 0;
const nowIso = () => new Date().toISOString();
const numOr = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

function emptyData() {
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: null,
    batches: [],
    texts: [],
    currentTextId: null,
    lastFeedbackExportAt: null,
  };
}

// ---- persistence ----------------------------------------------------------

function loadLocal() {
  try { const raw = localStorage.getItem(LS_KEY); return raw ? JSON.parse(raw) : null; }
  catch { return null; }
}
function saveLocal(d) { try { localStorage.setItem(LS_KEY, JSON.stringify(d)); } catch {} }

// Defensive load: missing/renamed fields must never blank the Texts screen.
function normalizeText(t) {
  if (!t || typeof t !== 'object') t = {};
  const paragraphs = Array.isArray(t.paragraphs) ? t.paragraphs.filter(p => typeof p === 'string') : [];
  const status = STATUSES.includes(t.status) ? t.status : 'unread';
  const prog = (t.progress && typeof t.progress === 'object') ? t.progress : {};
  return {
    id: t.id || uid(),
    batchId: t.batchId || null,
    contentHash: t.contentHash || null,
    externalId: t.externalId || null,
    title: typeof t.title === 'string' ? t.title : '',
    topic: typeof t.topic === 'string' && t.topic ? t.topic : 'general',
    style: typeof t.style === 'string' && t.style ? t.style : 'explanatory',
    lengthClass: ['short', 'medium', 'long'].includes(t.lengthClass) ? t.lengthClass : 'medium',
    paragraphs,
    wordCount: numOr(t.wordCount, 0),
    status,
    queueOrder: numOr(t.queueOrder, 0),
    importedAt: t.importedAt || nowIso(),
    startedAt: t.startedAt || null,
    completedAt: t.completedAt || null,
    readingSeconds: Math.max(0, numOr(t.readingSeconds, 0)),
    progress: { paragraphIndex: Math.max(0, numOr(prog.paragraphIndex, 0)), scrollRatio: Math.min(1, Math.max(0, numOr(prog.scrollRatio, 0))) },
    highlights: Array.isArray(t.highlights) ? t.highlights.filter(h => h && typeof h === 'object').map(normalizeHighlight) : [],
    reflectionDraft: (t.reflectionDraft && typeof t.reflectionDraft === 'object') ? t.reflectionDraft : null,
    reflection: (t.reflection && typeof t.reflection === 'object') ? t.reflection : null,
  };
}

function normalizeHighlight(h) {
  return {
    id: h.id || uid(),
    type: h.type === 'sentence' ? 'sentence' : 'word',
    paragraph_index: Math.max(0, numOr(h.paragraph_index, 0)),
    sentence_index: Math.max(0, numOr(h.sentence_index, 0)),
    word_start: Math.max(0, numOr(h.word_start, 0)),
    word_end: Math.max(0, numOr(h.word_end, 0)),
    quote: typeof h.quote === 'string' ? h.quote : '',
    created_at: h.created_at || nowIso(),
  };
}

function normalize(d) {
  if (!d || typeof d !== 'object') d = emptyData();
  d.schemaVersion = SCHEMA_VERSION;
  if (!Array.isArray(d.batches)) d.batches = [];
  d.texts = Array.isArray(d.texts) ? d.texts.map(normalizeText) : [];
  if (typeof d.lastFeedbackExportAt !== 'string') d.lastFeedbackExportAt = d.lastFeedbackExportAt || null;
  // currentTextId must point at a real, still-open text.
  const cur = d.texts.find(t => t.id === d.currentTextId);
  d.currentTextId = (cur && (cur.status === 'reading' || cur.status === 'reflection')) ? cur.id : null;
  return d;
}

export function initMindTexts(remote) {
  const local = loadLocal();
  let chosen;
  if (remote && local) chosen = stampMs(remote.updatedAt) >= stampMs(local.updatedAt) ? remote : local;
  else                 chosen = remote || local || emptyData();

  chosen = normalize(chosen);
  if (!chosen.updatedAt) chosen.updatedAt = nowIso();
  state.mindTexts = chosen;
  saveLocal(chosen);

  // Only push if local is genuinely newer than what's on the server.
  if (!remote || stampMs(chosen.updatedAt) > stampMs(remote.updatedAt)) {
    dbSaveMindTextsStore(chosen).catch(() => {});
  }
}

// Local-only checkpoint — for high-frequency writes (reading timer, scroll
// progress, reflection draft). Bumps updatedAt so a later cloud push wins,
// but does not hit the network on every tick.
export function saveMindTextsLocal() {
  const d = state.mindTexts;
  if (!d) return;
  d.updatedAt = nowIso();
  saveLocal(d);
}

// Full save — localStorage immediately + best-effort cloud (debounced, or
// immediate for important one-off events like import / completion).
export function saveMindTexts({ immediateCloud = false } = {}) {
  const d = state.mindTexts;
  if (!d) return;
  d.updatedAt = nowIso();
  saveLocal(d);
  if (_cloudTimer) { clearTimeout(_cloudTimer); _cloudTimer = null; }
  const push = () => dbSaveMindTextsStore(d).then(({ error }) => {
    if (error && _cloudOk) { _cloudOk = false; showToast('Saved on this device · cloud sync unavailable', 'warning'); }
    else if (!error && !_cloudOk) { _cloudOk = true; showToast('Synced', 'success'); }
  }).catch(() => {});
  if (immediateCloud) push();
  else _cloudTimer = setTimeout(push, 600);
}

export function getMindTexts() { return state.mindTexts; }

// ---- lookups / queue ------------------------------------------------------

export function getTextById(id) {
  return (state.mindTexts.texts || []).find(t => t.id === id) || null;
}

// Texts still waiting to be read, in their stable randomized queue order.
export function unreadQueue() {
  return (state.mindTexts.texts || [])
    .filter(t => t.status === 'unread')
    .sort((a, b) => a.queueOrder - b.queueOrder);
}
export function unreadCount() { return unreadQueue().length; }

// The single locked in-progress text (reading or mid-reflection), if any.
export function getCurrentText() {
  const d = state.mindTexts;
  if (!d.currentTextId) return null;
  const t = getTextById(d.currentTextId);
  if (!t || (t.status !== 'reading' && t.status !== 'reflection')) { d.currentTextId = null; return null; }
  return t;
}

// What the big primary button should do right now.
export function primaryAction() {
  const cur = getCurrentText();
  if (cur && cur.status === 'reflection') return { kind: 'continue-reflection', textId: cur.id, label: 'Continue reflection' };
  if (cur && cur.status === 'reading')    return { kind: 'continue-reading', textId: cur.id, label: 'Continue reading' };
  if (unreadCount() > 0) return { kind: 'read', label: 'Read a text' };
  return { kind: 'empty', label: 'Queue empty' };
}

// ---- import ---------------------------------------------------------------

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function makeTextObject(c, batchId, queueOrder) {
  return normalizeText({
    id: uid(), batchId, contentHash: c.contentHash, externalId: c.externalId || null,
    title: c.title, topic: c.topic, style: c.style, lengthClass: c.lengthClass,
    paragraphs: c.paragraphs, wordCount: c.wordCount,
    status: 'unread', queueOrder, importedAt: nowIso(),
  });
}

// candidates: validated text candidates from parser.js (each carries
// contentHash + wordCount). Dedupes by contentHash against the whole library
// AND within the batch. New texts are shuffled, then appended after the
// current queue so the in-progress text is never disturbed.
export function commitTextsImport(candidates, meta = {}) {
  const d = state.mindTexts;
  const seen = new Set(d.texts.map(t => t.contentHash).filter(Boolean));
  const batchId = uid();
  const fresh = [];
  let skipped = 0;
  for (const c of candidates) {
    if (c.contentHash && seen.has(c.contentHash)) { skipped++; continue; }
    if (c.contentHash) seen.add(c.contentHash);
    fresh.push(c);
  }
  const maxOrder = d.texts.reduce((m, t) => Math.max(m, t.queueOrder || 0), 0);
  shuffle(fresh.slice()).forEach((c, i) => d.texts.push(makeTextObject(c, batchId, maxOrder + 1 + i)));
  if (fresh.length) d.batches.push({ id: batchId, importedAt: nowIso(), language: meta.language || null, generatedAt: meta.generatedAt || null, count: fresh.length });
  if (fresh.length) saveMindTexts({ immediateCloud: true });
  return { imported: fresh.length, skipped, queueSize: unreadCount(), batchId };
}

// ---- reader lifecycle -----------------------------------------------------

// Returns the text to open. Reopens the locked current text if one exists;
// otherwise promotes the first unread text and locks it. Never lets the user
// pick a different unread text while one is in progress.
export function startOrContinueReading() {
  const cur = getCurrentText();
  if (cur) return cur;
  const q = unreadQueue();
  if (!q.length) return null;
  const t = q[0];
  t.status = 'reading';
  if (!t.startedAt) t.startedAt = nowIso();
  state.mindTexts.currentTextId = t.id;
  saveMindTexts({ immediateCloud: true });
  return t;
}

export function setProgress(textId, paragraphIndex, scrollRatio) {
  const t = getTextById(textId);
  if (!t) return;
  t.progress = { paragraphIndex: Math.max(0, numOr(paragraphIndex, 0)), scrollRatio: Math.min(1, Math.max(0, numOr(scrollRatio, 0))) };
  saveMindTextsLocal();
}

export function addReadingSeconds(textId, secs) {
  const t = getTextById(textId);
  if (!t || !(secs > 0)) return;
  t.readingSeconds = Math.max(0, t.readingSeconds + secs);
  saveMindTextsLocal();
}

// Move from reading into the reflection step (reading time stops here — the
// reader is responsible for flushing the timer before calling this).
export function enterReflection(textId) {
  const t = getTextById(textId);
  if (!t) return;
  t.status = 'reflection';
  state.mindTexts.currentTextId = t.id;
  saveMindTexts({ immediateCloud: true });
}

export function saveReflectionDraft(textId, draft) {
  const t = getTextById(textId);
  if (!t) return;
  t.reflectionDraft = draft || null;
  saveMindTextsLocal();
}

// The one and only completion path. Word count now counts toward "words read".
export function completeText(textId, reflection) {
  const d = state.mindTexts;
  const t = getTextById(textId);
  if (!t) return;
  t.reflection = reflection;
  t.reflectionDraft = null;
  t.status = 'completed';
  t.completedAt = nowIso();
  t.progress = { paragraphIndex: Math.max(0, t.paragraphs.length - 1), scrollRatio: 1 };
  if (d.currentTextId === textId) d.currentTextId = null;
  saveMindTexts({ immediateCloud: true });
}

// ---- highlights -----------------------------------------------------------

export function textHighlights(textId) {
  const t = getTextById(textId);
  return t ? t.highlights : [];
}

// Toggle a single word. If it's highlighted by its own word entry, remove
// that. If it's only highlighted because its sentence is highlighted, tapping
// removes that sentence range (the range under the finger).
export function toggleWordHighlight(textId, p, s, w, quote) {
  const t = getTextById(textId);
  if (!t) return;
  const hs = t.highlights;
  const wi = hs.findIndex(h => h.type === 'word' && h.paragraph_index === p && h.sentence_index === s && h.word_start === w && h.word_end === w);
  if (wi >= 0) { hs.splice(wi, 1); }
  else {
    const si = hs.findIndex(h => h.type === 'sentence' && h.paragraph_index === p && h.sentence_index === s);
    if (si >= 0) hs.splice(si, 1);
    else hs.push(normalizeHighlight({ type: 'word', paragraph_index: p, sentence_index: s, word_start: w, word_end: w, quote }));
  }
  saveMindTexts();
}

// Toggle a whole sentence. Adding one normalizes away any word highlights it
// contains; removing one leaves every other highlight untouched.
export function toggleSentenceHighlight(textId, p, s, quote, lastWordIndex) {
  const t = getTextById(textId);
  if (!t) return;
  const si = t.highlights.findIndex(h => h.type === 'sentence' && h.paragraph_index === p && h.sentence_index === s);
  if (si >= 0) { t.highlights.splice(si, 1); }
  else {
    t.highlights = t.highlights.filter(h => !(h.type === 'word' && h.paragraph_index === p && h.sentence_index === s));
    t.highlights.push(normalizeHighlight({ type: 'sentence', paragraph_index: p, sentence_index: s, word_start: 0, word_end: Math.max(0, lastWordIndex), quote }));
  }
  saveMindTexts();
}

// ---- statistics -----------------------------------------------------------

const avg = arr => { const v = arr.filter(x => Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

export function completedTexts() {
  return (state.mindTexts.texts || []).filter(t => t.status === 'completed');
}

export function statsSummary() {
  const done = completedTexts();
  const eng = done.map(t => t.reflection && t.reflection.engagement).filter(Number.isFinite);
  const lrn = done.map(t => t.reflection && t.reflection.learning).filter(Number.isFinite);
  const rel = done.map(t => t.reflection && t.reflection.relevance).filter(Number.isFinite);
  const highlights = (state.mindTexts.texts || []).reduce((n, t) => n + (t.highlights ? t.highlights.length : 0), 0);
  return {
    wordsRead: done.reduce((n, t) => n + numOr(t.wordCount, 0), 0),
    readingSeconds: done.reduce((n, t) => n + numOr(t.readingSeconds, 0), 0),
    textsCompleted: done.length,
    avgEngagement: avg(eng),
    avgLearning: avg(lrn),
    avgRelevance: avg(rel),
    highlightsSaved: highlights,
    unread: unreadCount(),
    hasCurrent: !!getCurrentText(),
  };
}

// Aggregate completed texts by topic. Ordered by count then words.
export function topTopics() {
  const map = new Map();
  for (const t of completedTexts()) {
    const key = t.topic || 'general';
    if (!map.has(key)) map.set(key, { topic: key, count: 0, words: 0, eng: [], lrn: [], rel: [], more: { yes: 0, maybe: 0, no: 0 } });
    const g = map.get(key);
    g.count++;
    g.words += numOr(t.wordCount, 0);
    const r = t.reflection || {};
    if (Number.isFinite(r.engagement)) g.eng.push(r.engagement);
    if (Number.isFinite(r.learning)) g.lrn.push(r.learning);
    if (Number.isFinite(r.relevance)) g.rel.push(r.relevance);
    if (r.more_like_this === 'yes') g.more.yes++;
    else if (r.more_like_this === 'maybe') g.more.maybe++;
    else if (r.more_like_this === 'no') g.more.no++;
  }
  return [...map.values()].map(g => ({
    topic: g.topic, count: g.count, words: g.words,
    avgEngagement: avg(g.eng), avgLearning: avg(g.lrn), avgRelevance: avg(g.rel),
    more: g.more,
  })).sort((a, b) => (b.count - a.count) || (b.words - a.words));
}

// Every saved highlight (from completed AND in-progress texts) paired with its
// parent text, newest-created first — feeds the Highlights reel viewer.
export function allHighlightsFlat() {
  const out = [];
  for (const t of (state.mindTexts.texts || [])) {
    if (t.status === 'unread') continue; // nothing read yet; also usually has none
    for (const h of (t.highlights || [])) out.push({ highlight: h, text: t });
  }
  return out.sort((a, b) => (b.highlight.created_at || '').localeCompare(a.highlight.created_at || ''));
}

export function markFeedbackExported() {
  state.mindTexts.lastFeedbackExportAt = nowIso();
  saveMindTexts({ immediateCloud: true });
}
