// ============================================================
// MIND · TEXTS · BOOKS — physical-book reading tracking. Pure logic + stats,
// no DOM. A book estimates newly-read words from page deltas; every count is
// stored inside an immutable-ish progress event so words are added exactly
// once and a refresh can never double-count. Goals/milestones are progress
// metadata only — they never affect the words-read total.
// ============================================================

import {
  getMindTexts, saveMindTexts, normalizeBook, bookUid,
  nowIsoExport as nowIso, numOrExport as numOr,
} from './store.js';

export const STANDARD_MILESTONES = [25, 50, 75, 100];
const intOr = (v, d = 0) => Math.round(numOr(v, d));
const clampPct = p => Math.min(100, Math.max(0, p));

function books() { return (getMindTexts().books ||= []); }
function persist() { saveMindTexts({ immediateCloud: true }); }

// ---- reads ----------------------------------------------------------------

export function listBooks() { return books().slice(); }
export function getBook(id) { return books().find(b => b.id === id) || null; }
export function activeBooks() { return books().filter(b => b.status === 'active'); }
export function completedBooks() { return books().filter(b => b.status === 'completed'); }
export function archivedBooks() { return books().filter(b => b.status === 'archived'); }

export function bookProgressPercent(b) {
  if (!b || !b.totalPages) return 0;
  return clampPct((b.currentPage / b.totalPages) * 100);
}
export function estimatedWordsForBook(b) {
  return (b && b.progressEvents || []).reduce((n, e) => n + Math.max(0, numOr(e.estimatedWords, 0)), 0);
}
// Total estimated words across ALL books (any status) — historical reading
// doesn't un-happen, so archiving/completing never drops the words total.
export function bookWordsTotal() {
  return books().reduce((n, b) => n + estimatedWordsForBook(b), 0);
}
export function latestEvent(b) {
  const ev = b && b.progressEvents;
  return (ev && ev.length) ? ev[ev.length - 1] : null;
}

// Nearest upcoming ACTIVE goal (for the compact card). Returns null if none.
export function nextGoal(b) {
  if (!b) return null;
  const pct = bookProgressPercent(b);
  let best = null;
  for (const g of (b.goals || [])) {
    if (g.status !== 'active') continue;
    const targetPage = g.type === 'percentage' ? Math.ceil((g.targetValue / 100) * b.totalPages) : g.targetValue;
    const pagesLeft = Math.max(0, targetPage - b.currentPage);
    const pctLeft = g.type === 'percentage' ? Math.max(0, g.targetValue - pct) : null;
    const cand = { goal: g, pagesLeft, pctLeft, targetPage };
    if (!best || pagesLeft < best.pagesLeft) best = cand;
  }
  return best;
}

// ---- goal evaluation (the single place goals become "reached") ------------
// Only ACTIVE goals can transition to reached, so a reached goal never
// re-triggers on refresh, re-render, re-open or an unrelated edit.
function evaluateGoals(b) {
  const pct = bookProgressPercent(b);
  const reached = [];
  for (const g of (b.goals || [])) {
    if (g.status !== 'active') continue;
    const met = g.type === 'percentage' ? (pct >= g.targetValue) : (b.currentPage >= g.targetValue);
    if (met) { g.status = 'reached'; g.reachedAt = nowIso(); reached.push(g); }
  }
  return reached;
}

// Complete the book when the final page is reached. Returns true if it just
// completed. Marks a 100% goal reached silently so completion is one event.
function maybeComplete(b) {
  if (b.currentPage >= b.totalPages && b.status === 'active') {
    b.status = 'completed';
    b.completedAt = nowIso();
    for (const g of (b.goals || [])) {
      if (g.status === 'active' && g.type === 'percentage' && g.targetValue >= 100) { g.status = 'reached'; g.reachedAt = b.completedAt; }
    }
    return true;
  }
  return false;
}

// ---- create ---------------------------------------------------------------

export function addBook(input) {
  const totalPages = Math.max(1, intOr(input.totalPages, 1));
  const currentPage = Math.min(totalPages, Math.max(0, intOr(input.currentPage, 0)));
  const wpp = Math.max(1, intOr(input.defaultWordsPerPage, 300));
  const now = nowIso();
  const b = normalizeBook({
    title: input.title, author: input.author,
    totalPages, defaultWordsPerPage: wpp,
    currentPage,
    baselinePage: input.countExisting ? 0 : currentPage,
    status: 'active', createdAt: now, updatedAt: now,
    progressEvents: [], goals: [],
  });

  // Count pages already read → one explicit initial event (0 → currentPage).
  if (input.countExisting && currentPage > 0) {
    b.progressEvents.push({
      id: bookUid('book_progress_'), kind: 'initial',
      fromPage: 0, toPage: currentPage, pageDelta: currentPage,
      wordsPerPageSnapshot: wpp, estimatedWords: currentPage * wpp, createdAt: now,
    });
  }

  // Goals: standard milestones (deduped) + any custom goals from the form.
  const goals = [];
  if (input.standardMilestones) for (const pct of STANDARD_MILESTONES) goals.push(mkGoal({ type: 'percentage', targetValue: pct, label: pct + '%' }, now));
  for (const g of (input.extraGoals || [])) {
    if (g.type === 'percentage' && goals.some(x => x.type === 'percentage' && x.targetValue === g.targetValue)) continue;
    if (g.type === 'page' && goals.some(x => x.type === 'page' && x.targetValue === g.targetValue)) continue;
    goals.push(mkGoal(g, now));
  }
  b.goals = goals;

  // Mark any already-passed goals reached SILENTLY (no notification on create),
  // and complete immediately if the book was added at its final page.
  evaluateGoals(b);
  maybeComplete(b);

  books().push(b);
  persist();
  return { ok: true, book: b };
}

function mkGoal(g, now) {
  return {
    id: bookUid('book_goal_'),
    type: g.type === 'page' ? 'page' : 'percentage',
    targetValue: Math.max(0, intOr(g.targetValue, 0)),
    label: typeof g.label === 'string' ? g.label : '',
    status: 'active', createdAt: now || nowIso(), reachedAt: null,
  };
}

// ---- log new reading ------------------------------------------------------

export function updateProgress(bookId, newPageRaw, wppOverride) {
  const b = getBook(bookId);
  if (!b) return { ok: false, error: 'Book not found.' };
  const newPage = intOr(newPageRaw, NaN);
  if (!Number.isFinite(newPage)) return { ok: false, error: 'Enter a valid page number.' };
  if (newPage < 0) return { ok: false, error: 'Page cannot be negative.' };
  if (newPage > b.totalPages) return { ok: false, error: `This book has ${b.totalPages} pages.` };
  if (newPage < b.currentPage) return { ok: false, error: `You're on page ${b.currentPage}. To fix a mistake use "Correct current page".`, isBackward: true };
  if (newPage === b.currentPage) return { ok: true, noop: true };

  const wpp = (Number.isFinite(numOr(wppOverride, NaN)) && intOr(wppOverride) > 0) ? intOr(wppOverride) : b.defaultWordsPerPage;
  const pageDelta = newPage - b.currentPage;
  b.progressEvents.push({
    id: bookUid('book_progress_'), kind: 'progress',
    fromPage: b.currentPage, toPage: newPage, pageDelta,
    wordsPerPageSnapshot: wpp, estimatedWords: pageDelta * wpp, createdAt: nowIso(),
  });
  b.currentPage = newPage;
  b.updatedAt = nowIso();
  const reached = evaluateGoals(b);
  const completed = maybeComplete(b);
  persist();
  return { ok: true, event: latestEvent(b), reached, completed, book: b };
}

// ---- correct a mistake (NOT new reading) ----------------------------------
// Edits the latest event's toPage (keeping its fromPage) so words are recounted,
// never added as fresh reading. Does not evaluate or un-reach goals.
export function correctCurrentPage(bookId, newPageRaw, wppOverride) {
  const b = getBook(bookId);
  if (!b) return { ok: false, error: 'Book not found.' };
  const newPage = intOr(newPageRaw, NaN);
  if (!Number.isFinite(newPage)) return { ok: false, error: 'Enter a valid page number.' };
  if (newPage < 0) return { ok: false, error: 'Page cannot be negative.' };
  if (newPage > b.totalPages) return { ok: false, error: `This book has ${b.totalPages} pages.` };

  const latest = latestEvent(b);
  if (latest) {
    if (newPage < latest.fromPage) return { ok: false, error: `The latest entry starts at page ${latest.fromPage}. Delete it first to go lower.` };
    latest.toPage = newPage;
    latest.pageDelta = Math.max(0, newPage - latest.fromPage);
    if (Number.isFinite(numOr(wppOverride, NaN)) && intOr(wppOverride) > 0) latest.wordsPerPageSnapshot = intOr(wppOverride);
    latest.estimatedWords = latest.pageDelta * latest.wordsPerPageSnapshot;
  } else {
    b.baselinePage = newPage; // no events yet — just move the baseline
  }
  b.currentPage = newPage;
  b.updatedAt = nowIso();
  // Reopen if a completed book was corrected below its last page; complete if a
  // correction happens to land exactly on the final page. Never toasts goals.
  if (b.status === 'completed' && newPage < b.totalPages) { b.status = 'active'; b.completedAt = null; }
  else maybeComplete(b);
  persist();
  return { ok: true };
}

// Delete the latest event: remove its word contribution, restore the page.
export function deleteLatestEvent(bookId) {
  const b = getBook(bookId);
  if (!b) return { ok: false, error: 'Book not found.' };
  if (!b.progressEvents.length) return { ok: false, error: 'No entries to delete.' };
  const removed = b.progressEvents.pop();
  b.currentPage = Math.max(0, removed.fromPage);
  b.updatedAt = nowIso();
  if (b.status === 'completed' && b.currentPage < b.totalPages) { b.status = 'active'; b.completedAt = null; }
  // reached goals stay reached (history) — never reactivated automatically
  persist();
  return { ok: true, restoredTo: b.currentPage };
}

// ---- goals ----------------------------------------------------------------

export function addGoal(bookId, input) {
  const b = getBook(bookId);
  if (!b) return { ok: false, error: 'Book not found.' };
  const type = input.type === 'page' ? 'page' : 'percentage';
  let target = intOr(input.targetValue, NaN);
  if (!Number.isFinite(target)) return { ok: false, error: 'Enter a target.' };
  if (type === 'percentage') {
    if (target < 1 || target > 100) return { ok: false, error: 'Percentage must be 1–100.' };
    if (b.goals.some(g => g.type === 'percentage' && g.targetValue === target && g.status !== 'disabled')) return { ok: false, error: `A ${target}% goal already exists.` };
  } else {
    if (target < 1 || target > b.totalPages) return { ok: false, error: `Page must be 1–${b.totalPages}.` };
    if (b.goals.some(g => g.type === 'page' && g.targetValue === target && g.status !== 'disabled')) return { ok: false, error: `A page ${target} goal already exists.` };
  }
  const goal = mkGoal({ type, targetValue: target, label: input.label }, nowIso());
  b.goals.push(goal);
  // If the book is already past this target, mark it reached silently on add.
  const pct = bookProgressPercent(b);
  const met = type === 'percentage' ? (pct >= target) : (b.currentPage >= target);
  if (met) { goal.status = 'reached'; goal.reachedAt = nowIso(); }
  persist();
  return { ok: true, goal, reachedNow: met };
}

export function editGoal(bookId, goalId, input) {
  const b = getBook(bookId);
  if (!b) return { ok: false, error: 'Book not found.' };
  const g = (b.goals || []).find(x => x.id === goalId);
  if (!g) return { ok: false, error: 'Goal not found.' };
  if (g.status === 'reached') return { ok: false, error: 'Reached goals cannot be edited — reset it first.' };
  let target = intOr(input.targetValue, g.targetValue);
  if (g.type === 'percentage') { if (target < 1 || target > 100) return { ok: false, error: 'Percentage must be 1–100.' }; }
  else { if (target < 1 || target > b.totalPages) return { ok: false, error: `Page must be 1–${b.totalPages}.` }; }
  g.targetValue = target;
  if (typeof input.label === 'string') g.label = input.label;
  // becoming already-satisfied after an edit → reach silently
  const pct = bookProgressPercent(b);
  const met = g.type === 'percentage' ? (pct >= g.targetValue) : (b.currentPage >= g.targetValue);
  if (met) { g.status = 'reached'; g.reachedAt = nowIso(); }
  persist();
  return { ok: true };
}

export function disableGoal(bookId, goalId) { return setGoal(bookId, goalId, g => { if (g.status !== 'reached') { g.status = 'disabled'; g.reachedAt = null; } }); }
export function deleteGoal(bookId, goalId) {
  const b = getBook(bookId);
  if (!b) return { ok: false, error: 'Book not found.' };
  const g = (b.goals || []).find(x => x.id === goalId);
  if (!g) return { ok: false, error: 'Goal not found.' };
  if (g.status === 'reached') return { ok: false, error: 'Reached goals are kept as history. Reset it first to remove.' };
  b.goals = b.goals.filter(x => x.id !== goalId);
  persist();
  return { ok: true };
}
export function resetGoal(bookId, goalId) { return setGoal(bookId, goalId, g => { g.status = 'active'; g.reachedAt = null; }); }
function setGoal(bookId, goalId, fn) {
  const b = getBook(bookId);
  if (!b) return { ok: false, error: 'Book not found.' };
  const g = (b.goals || []).find(x => x.id === goalId);
  if (!g) return { ok: false, error: 'Goal not found.' };
  fn(g);
  persist();
  return { ok: true };
}

// ---- lifecycle ------------------------------------------------------------

export function archiveBook(bookId) { return setBookStatus(bookId, 'archived'); }
export function reopenBook(bookId) {
  const b = getBook(bookId);
  if (!b) return { ok: false, error: 'Book not found.' };
  b.status = 'active';
  b.completedAt = null;
  b.updatedAt = nowIso();
  persist();
  return { ok: true };
}
function setBookStatus(bookId, status) {
  const b = getBook(bookId);
  if (!b) return { ok: false, error: 'Book not found.' };
  b.status = status;
  b.updatedAt = nowIso();
  persist();
  return { ok: true };
}

// ---- stats ----------------------------------------------------------------

export function bookStats() {
  const all = books();
  let pagesLogged = 0, goalsReached = 0, latestGoal = null;
  for (const b of all) {
    for (const e of (b.progressEvents || [])) pagesLogged += Math.max(0, numOr(e.pageDelta, 0));
    for (const g of (b.goals || [])) {
      if (g.status === 'reached') {
        goalsReached++;
        if (!latestGoal || (g.reachedAt || '') > (latestGoal.reachedAt || '')) latestGoal = { goal: g, book: b };
      }
    }
  }
  return {
    activeBooks: all.filter(b => b.status === 'active').length,
    completedBooks: all.filter(b => b.status === 'completed').length,
    archivedBooks: all.filter(b => b.status === 'archived').length,
    totalBooks: all.length,
    pagesLogged,
    bookWords: bookWordsTotal(),
    goalsReached,
    latestGoal,
  };
}

// Human label for a goal (used by toasts + detail view).
export function goalLabel(g) {
  const base = g.type === 'percentage' ? `${g.targetValue}%` : `page ${g.targetValue}`;
  return g.label && g.label !== base ? `${g.label} (${base})` : base;
}
