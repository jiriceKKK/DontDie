// ============================================================
// MIND · TEXTS · BOOKS UI — the compact Books area inside the Texts dashboard
// plus every book modal (add / update / correct / detail / goals). All logic
// lives in books.js; this file is presentation + wiring only.
// ============================================================

import { openModal, closeModal } from '../../ui/modal.js';
import { showToast } from '../../ui/toast.js';
import {
  activeBooks, completedBooks, archivedBooks, listBooks, getBook, bookStats,
  bookProgressPercent, estimatedWordsForBook, nextGoal, latestEvent,
  addBook, updateProgress, correctCurrentPage, deleteLatestEvent,
  addGoal, editGoal, disableGoal, deleteGoal, resetGoal,
  archiveBook, reopenBook, goalLabel, STANDARD_MILESTONES,
} from './books.js';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtInt = n => Number(n || 0).toLocaleString('en-US');
const pct1 = n => (Math.round(n * 100) / 100).toFixed(2).replace(/\.?0+$/, '') + '%';
const shortDate = iso => { const d = iso ? new Date(iso) : null; if (!d || isNaN(d)) return ''; return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };

// ---- dashboard section ----------------------------------------------------

export function booksSectionHtml() {
  const active = activeBooks();
  const completed = completedBooks();
  const archived = archivedBooks();

  const head = `
    <div class="tx-books-head">
      <span class="tx-books-title">Books</span>
      <button class="tx-books-add" data-book-add>+ Add book</button>
    </div>`;

  if (!active.length && !completed.length && !archived.length) {
    return `<div class="card tx-books">
      ${head}
      <div class="tx-books-empty">Track a physical book — pages become estimated words toward your total.</div>
    </div>`;
  }

  const cards = active.map(activeCardHtml).join('');
  const activeBlock = active.length ? cards
    : `<div class="tx-books-empty">No active book. Add one, or reopen a finished book below.</div>`;

  const otherCount = completed.length + archived.length;
  const manage = otherCount
    ? `<button class="tx-books-manage" data-books-manage>${completed.length ? `${completed.length} completed` : ''}${completed.length && archived.length ? ' · ' : ''}${archived.length ? `${archived.length} archived` : ''} · manage</button>`
    : '';

  const bs = bookStats();
  const summary = (bs.goalsReached || bs.pagesLogged)
    ? `<div class="tx-books-summary">Book goals reached: ${bs.goalsReached} · pages logged: ${fmtInt(bs.pagesLogged)}</div>`
    : '';

  return `<div class="card tx-books">${head}${activeBlock}${manage}${summary}</div>`;
}

function activeCardHtml(b) {
  const p = bookProgressPercent(b);
  const words = estimatedWordsForBook(b);
  const ng = nextGoal(b);
  let ngText = '';
  if (ng) {
    ngText = ng.goal.type === 'percentage'
      ? `Next · ${ng.goal.targetValue}% · ${Math.max(0, Math.round(ng.pctLeft))}% left`
      : `Next · page ${ng.goal.targetValue} · ${ng.pagesLeft} left`;
  }
  return `
    <div class="bk-card" data-book-detail="${b.id}">
      <div class="bk-card-top">
        <div class="bk-title">${esc(b.title)}</div>
        ${b.author ? `<div class="bk-author">${esc(b.author)}</div>` : ''}
      </div>
      <div class="bk-bar"><div class="bk-bar-fill" style="width:${p}%"></div></div>
      <div class="bk-meta">
        <span>${b.currentPage} / ${b.totalPages} · ${pct1(p)}</span>
        <span class="bk-words">≈${fmtInt(words)} words</span>
      </div>
      ${ngText ? `<div class="bk-next">${esc(ngText)}</div>` : ''}
      <div class="bk-actions">
        <button class="btn btn-primary bk-btn" data-book-update="${b.id}">Update progress</button>
      </div>
    </div>`;
}

// Wire the books section (called after the dashboard renders). `rerender`
// re-renders the whole Texts tab so metrics + cards refresh.
export function wireBooks(panel, rerender) {
  const on = (sel, fn) => panel.querySelectorAll(sel).forEach(el => el.addEventListener('click', e => { e.stopPropagation(); fn(el); }));
  on('[data-book-add]', () => openAddBook(rerender));
  on('[data-book-update]', el => openUpdateProgress(el.dataset.bookUpdate, rerender));
  on('[data-book-detail]', el => openBookDetail(el.dataset.bookDetail, rerender));
  on('[data-books-manage]', () => openBooksManager(rerender));
}

// ---- add book -------------------------------------------------------------

function openAddBook(rerender) {
  openModal(`
    <div class="bk-form">
      <label class="bk-label">Title</label>
      <input class="form-input" id="bk-title" type="text" maxlength="200" placeholder="Book title">
      <label class="bk-label">Author <span class="bk-opt">optional</span></label>
      <input class="form-input" id="bk-author" type="text" maxlength="120" placeholder="Author">
      <div class="bk-row2">
        <div><label class="bk-label">Total pages</label><input class="form-input" id="bk-total" type="number" inputmode="numeric" min="1" placeholder="320"></div>
        <div><label class="bk-label">Words / page</label><input class="form-input" id="bk-wpp" type="number" inputmode="numeric" min="1" value="300"></div>
      </div>
      <label class="bk-label">Current page</label>
      <input class="form-input" id="bk-current" type="number" inputmode="numeric" min="0" value="0">
      <label class="bk-check"><input type="checkbox" id="bk-count"> Count pages already read toward total words</label>
      <div class="bk-estimate" id="bk-estimate" hidden></div>
      <label class="bk-check"><input type="checkbox" id="bk-milestones" checked> Add standard milestones (25 · 50 · 75 · 100%)</label>
      <div class="bk-err" id="bk-err" hidden></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="bk-cancel">Cancel</button>
      <button class="btn btn-primary" id="bk-save">Add book</button>
    </div>
  `, 'Add book');

  const $ = id => document.getElementById(id);
  const estimate = () => {
    const count = $('bk-count').checked;
    const cur = parseInt($('bk-current').value, 10) || 0;
    const wpp = parseInt($('bk-wpp').value, 10) || 0;
    const box = $('bk-estimate');
    if (count && cur > 0 && wpp > 0) { box.hidden = false; box.textContent = `≈ ${fmtInt(cur * wpp)} words will be counted now (pages 0–${cur}).`; }
    else if (count) { box.hidden = false; box.textContent = 'No words counted yet — set current page and words/page.'; }
    else { box.hidden = true; }
  };
  ['bk-count', 'bk-current', 'bk-wpp'].forEach(id => { $(id).addEventListener('input', estimate); $(id).addEventListener('change', estimate); });

  $('bk-cancel').addEventListener('click', closeModal);
  let busy = false;
  $('bk-save').addEventListener('click', () => {
    if (busy) return;
    const err = $('bk-err');
    const title = $('bk-title').value.trim();
    const total = parseInt($('bk-total').value, 10);
    const wpp = parseInt($('bk-wpp').value, 10);
    const cur = parseInt($('bk-current').value, 10);
    const fail = m => { err.hidden = false; err.textContent = m; };
    if (!title) return fail('Enter a title.');
    if (!Number.isFinite(total) || total < 1) return fail('Total pages must be a positive whole number.');
    if (!Number.isFinite(wpp) || wpp < 1) return fail('Words per page must be a positive whole number.');
    if (!Number.isFinite(cur) || cur < 0) return fail('Current page must be 0 or more.');
    if (cur > total) return fail(`Current page can't exceed ${total}.`);
    busy = true;
    addBook({
      title, author: $('bk-author').value.trim(),
      totalPages: total, defaultWordsPerPage: wpp, currentPage: cur,
      countExisting: $('bk-count').checked, standardMilestones: $('bk-milestones').checked,
    });
    closeModal();
    showToast(`Added "${title}"`, 'success');
    rerender();
  });
}

// ---- update progress ------------------------------------------------------

function openUpdateProgress(bookId, rerender) {
  const b = getBook(bookId);
  if (!b) return;
  openModal(`
    <div class="bk-form">
      <div class="bk-up-head">${esc(b.title)}</div>
      <div class="bk-up-sub">Currently on page ${b.currentPage} of ${b.totalPages}</div>
      <label class="bk-label">New current page</label>
      <input class="form-input" id="bk-newpage" type="number" inputmode="numeric" min="${b.currentPage}" max="${b.totalPages}" placeholder="${b.currentPage}">
      <label class="bk-label">Words / page for this update <span class="bk-opt">optional override</span></label>
      <input class="form-input" id="bk-newwpp" type="number" inputmode="numeric" min="1" placeholder="${b.defaultWordsPerPage}">
      <div class="bk-estimate" id="bk-up-est" hidden></div>
      <div class="bk-err" id="bk-up-err" hidden></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="bk-up-correct">Correct instead</button>
      <button class="btn btn-primary" id="bk-up-save">Save progress</button>
    </div>
  `, 'Update progress');

  const $ = id => document.getElementById(id);
  const est = () => {
    const np = parseInt($('bk-newpage').value, 10);
    const wpp = parseInt($('bk-newwpp').value, 10) || b.defaultWordsPerPage;
    const box = $('bk-up-est');
    if (Number.isFinite(np) && np > b.currentPage && wpp > 0) { box.hidden = false; box.textContent = `+${np - b.currentPage} pages · ≈ ${fmtInt((np - b.currentPage) * wpp)} words`; }
    else box.hidden = true;
  };
  $('bk-newpage').addEventListener('input', est);
  $('bk-newwpp').addEventListener('input', est);
  $('bk-up-correct').addEventListener('click', () => { closeModal(); openCorrectPage(bookId, rerender); });

  let busy = false;
  $('bk-up-save').addEventListener('click', () => {
    if (busy) return;
    const err = $('bk-up-err');
    const np = parseInt($('bk-newpage').value, 10);
    const wppRaw = $('bk-newwpp').value.trim();
    const wpp = wppRaw === '' ? undefined : parseInt(wppRaw, 10);
    if (!Number.isFinite(np)) { err.hidden = false; err.textContent = 'Enter a page number.'; return; }
    const res = updateProgress(bookId, np, wpp);
    if (!res.ok) { err.hidden = false; err.textContent = res.error; return; }
    busy = true;
    closeModal();
    if (res.noop) showToast('No change — same page', 'default');
    else { announce(res, getBook(bookId)); }
    rerender();
  });
}

// ---- correct current page (NOT new reading) -------------------------------

function openCorrectPage(bookId, rerender) {
  const b = getBook(bookId);
  if (!b) return;
  const latest = latestEvent(b);
  const floor = latest ? latest.fromPage : 0;
  openModal(`
    <div class="bk-form">
      <div class="bk-correct-note">This is a <b>correction</b>, not new reading. It fixes your current page and the latest entry's estimate — it never adds words as fresh progress.</div>
      <div class="bk-up-sub">Current page ${b.currentPage} of ${b.totalPages}${latest ? ` · latest entry started at page ${latest.fromPage}` : ''}</div>
      <label class="bk-label">Correct current page to</label>
      <input class="form-input" id="bk-cp" type="number" inputmode="numeric" min="${floor}" max="${b.totalPages}" value="${b.currentPage}">
      <label class="bk-label">Words / page for the latest entry <span class="bk-opt">optional</span></label>
      <input class="form-input" id="bk-cp-wpp" type="number" inputmode="numeric" min="1" placeholder="${latest ? latest.wordsPerPageSnapshot : b.defaultWordsPerPage}">
      <div class="bk-err" id="bk-cp-err" hidden></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="bk-cp-cancel">Cancel</button>
      <button class="btn btn-primary" id="bk-cp-save">Save correction</button>
    </div>
  `, 'Correct current page');
  const $ = id => document.getElementById(id);
  $('bk-cp-cancel').addEventListener('click', closeModal);
  let busy = false;
  $('bk-cp-save').addEventListener('click', () => {
    if (busy) return;
    const np = parseInt($('bk-cp').value, 10);
    const wppRaw = $('bk-cp-wpp').value.trim();
    const res = correctCurrentPage(bookId, np, wppRaw === '' ? undefined : parseInt(wppRaw, 10));
    if (!res.ok) { const e = $('bk-cp-err'); e.hidden = false; e.textContent = res.error; return; }
    busy = true; closeModal(); showToast('Current page corrected', 'default'); rerender();
  });
}

// ---- book detail (history + goals + lifecycle) ----------------------------

function openBookDetail(bookId, rerender) {
  const b = getBook(bookId);
  if (!b) return;
  const p = bookProgressPercent(b);
  const words = estimatedWordsForBook(b);
  const events = (b.progressEvents || []).slice().reverse();
  const active = (b.goals || []).filter(g => g.status === 'active');
  const disabled = (b.goals || []).filter(g => g.status === 'disabled');
  const reached = (b.goals || []).filter(g => g.status === 'reached').sort((a, c) => (c.reachedAt || '').localeCompare(a.reachedAt || ''));

  const histHtml = events.length ? events.map((e, i) => {
    const isLatest = i === 0;
    return `<div class="bk-ev">
      <div class="bk-ev-main">
        <span class="bk-ev-date">${shortDate(e.createdAt)}</span>
        <span class="bk-ev-pages">Page ${e.fromPage} → ${e.toPage}</span>
        <span class="bk-ev-delta">${e.pageDelta} pages · ≈${fmtInt(e.estimatedWords)} words${e.kind === 'initial' ? ' · initial' : ''}</span>
        <span class="bk-ev-wpp">${e.wordsPerPageSnapshot} w/pg</span>
      </div>
      ${isLatest ? `<button class="bk-ev-del" data-ev-del="${b.id}">Delete latest</button>` : ''}
    </div>`;
  }).join('') : `<div class="bk-books-empty">No reading logged yet.</div>`;

  const goalRow = g => {
    const base = g.type === 'percentage' ? `${g.targetValue}%` : `page ${g.targetValue}`;
    if (g.status === 'reached') return `<div class="bk-goal reached"><span class="bk-goal-check">✓</span><span class="bk-goal-t">${esc(goalLabel(g))}</span><span class="bk-goal-when">${shortDate(g.reachedAt)}</span><button class="bk-goal-act" data-goal-reset="${g.id}">Reset</button></div>`;
    if (g.status === 'disabled') return `<div class="bk-goal disabled"><span class="bk-goal-t">${esc(base)} · off</span><button class="bk-goal-act" data-goal-enable="${g.id}">Enable</button><button class="bk-goal-act" data-goal-del="${g.id}">Delete</button></div>`;
    return `<div class="bk-goal"><span class="bk-goal-t">${esc(base)}</span><button class="bk-goal-act" data-goal-disable="${g.id}">Disable</button><button class="bk-goal-act" data-goal-del="${g.id}">Delete</button></div>`;
  };

  const goalsHtml = `
    ${active.map(goalRow).join('')}
    ${disabled.map(goalRow).join('')}
    ${reached.length ? `<div class="bk-goal-sub">Reached</div>${reached.map(goalRow).join('')}` : ''}
    ${(!active.length && !disabled.length && !reached.length) ? `<div class="bk-books-empty">No goals yet.</div>` : ''}
    <button class="bk-add-goal" data-goal-add="${b.id}">+ Add goal</button>`;

  const lifecycle = b.status === 'completed'
    ? `<button class="btn btn-ghost bk-life" data-book-reopen="${b.id}">Reopen</button><button class="btn btn-ghost bk-life" data-book-archive="${b.id}">Archive</button>`
    : b.status === 'archived'
      ? `<button class="btn btn-ghost bk-life" data-book-reopen="${b.id}">Restore</button>`
      : `<button class="btn btn-ghost bk-life" data-book-archive="${b.id}">Archive</button>`;

  openModal(`
    <div class="bk-detail">
      <div class="bk-detail-head">
        <div class="bk-detail-title">${esc(b.title)}</div>
        ${b.author ? `<div class="bk-detail-author">${esc(b.author)}</div>` : ''}
        <div class="bk-detail-status bk-status-${b.status}">${b.status}</div>
      </div>
      <div class="bk-bar bk-bar-lg"><div class="bk-bar-fill" style="width:${p}%"></div></div>
      <div class="bk-detail-stats">
        <div><span class="bk-ds-n">${b.currentPage}/${b.totalPages}</span><span class="bk-ds-l">pages</span></div>
        <div><span class="bk-ds-n">${pct1(p)}</span><span class="bk-ds-l">complete</span></div>
        <div><span class="bk-ds-n">≈${fmtInt(words)}</span><span class="bk-ds-l">words</span></div>
      </div>
      <div class="bk-detail-actions">
        ${b.status !== 'archived' ? `<button class="btn btn-primary" data-book-update="${b.id}">Update progress</button>` : ''}
        <button class="btn btn-ghost" data-book-correct="${b.id}">Correct page</button>
      </div>

      <div class="bk-section-t">Goals</div>
      <div class="bk-goals">${goalsHtml}</div>

      <div class="bk-section-t">History</div>
      <div class="bk-hist">${histHtml}</div>

      <div class="bk-detail-life">${lifecycle}</div>
    </div>
  `, 'Book');

  // wire (re-open detail after sub-actions so it stays in sync)
  const reopen = () => { closeModal(); rerender(); setTimeout(() => openBookDetail(bookId, rerender), 60); };
  const q = sel => document.querySelectorAll(sel);
  q('[data-book-update]').forEach(el => el.addEventListener('click', () => { closeModal(); openUpdateProgress(bookId, () => { rerender(); }); }));
  q('[data-book-correct]').forEach(el => el.addEventListener('click', () => { closeModal(); openCorrectPage(bookId, () => { rerender(); }); }));
  q('[data-goal-add]').forEach(el => el.addEventListener('click', () => { closeModal(); openAddGoal(bookId, rerender); }));
  q('[data-goal-disable]').forEach(el => el.addEventListener('click', () => { disableGoal(bookId, el.dataset.goalDisable); reopen(); }));
  q('[data-goal-enable]').forEach(el => el.addEventListener('click', () => { resetGoal(bookId, el.dataset.goalEnable); reopen(); }));
  q('[data-goal-reset]').forEach(el => el.addEventListener('click', () => { resetGoal(bookId, el.dataset.goalReset); reopen(); }));
  q('[data-goal-del]').forEach(el => el.addEventListener('click', () => { const r = deleteGoal(bookId, el.dataset.goalDel); if (!r.ok) showToast(r.error, 'warning'); reopen(); }));
  q('[data-ev-del]').forEach(el => el.addEventListener('click', () => {
    if (!confirm('Delete the latest reading entry? Its estimated words will be removed and your page restored.')) return;
    const r = deleteLatestEvent(bookId); if (!r.ok) showToast(r.error, 'warning'); else showToast('Latest entry deleted', 'default'); reopen();
  }));
  q('[data-book-archive]').forEach(el => el.addEventListener('click', () => { archiveBook(bookId); showToast('Book archived', 'default'); closeModal(); rerender(); }));
  q('[data-book-reopen]').forEach(el => el.addEventListener('click', () => { reopenBook(bookId); showToast('Book reopened', 'default'); reopen(); }));
}

// ---- add goal -------------------------------------------------------------

function openAddGoal(bookId, rerender) {
  const b = getBook(bookId);
  if (!b) return;
  let type = 'percentage';
  openModal(`
    <div class="bk-form">
      <label class="bk-label">Goal type</label>
      <div class="bk-goaltype">
        <button type="button" class="bk-gt active" data-gt="percentage">Percentage</button>
        <button type="button" class="bk-gt" data-gt="page">Page</button>
      </div>
      <label class="bk-label" id="bk-gt-label">Target percentage (1–100)</label>
      <input class="form-input" id="bk-gt-val" type="number" inputmode="numeric" min="1" placeholder="50">
      <label class="bk-label">Label <span class="bk-opt">optional</span></label>
      <input class="form-input" id="bk-gt-lbl" type="text" maxlength="60" placeholder="e.g. Halfway through">
      <div class="bk-err" id="bk-gt-err" hidden></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="bk-gt-cancel">Cancel</button>
      <button class="btn btn-primary" id="bk-gt-save">Add goal</button>
    </div>
  `, 'Add goal');
  const $ = id => document.getElementById(id);
  document.querySelectorAll('.bk-gt').forEach(btn => btn.addEventListener('click', () => {
    type = btn.dataset.gt;
    document.querySelectorAll('.bk-gt').forEach(x => x.classList.toggle('active', x === btn));
    $('bk-gt-label').textContent = type === 'percentage' ? 'Target percentage (1–100)' : `Target page (1–${b.totalPages})`;
  }));
  $('bk-gt-cancel').addEventListener('click', () => { closeModal(); openBookDetail(bookId, rerender); });
  $('bk-gt-save').addEventListener('click', () => {
    const val = parseInt($('bk-gt-val').value, 10);
    const res = addGoal(bookId, { type, targetValue: val, label: $('bk-gt-lbl').value.trim() });
    if (!res.ok) { const e = $('bk-gt-err'); e.hidden = false; e.textContent = res.error; return; }
    closeModal();
    showToast(res.reachedNow ? 'Goal added — already reached' : 'Goal added', 'success');
    rerender();
    setTimeout(() => openBookDetail(bookId, rerender), 60);
  });
}

// ---- books manager (completed / archived) ---------------------------------

function openBooksManager(rerender) {
  const all = listBooks().slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  const row = b => {
    const p = bookProgressPercent(b);
    return `<button class="bk-mrow" data-book-detail="${b.id}">
      <span class="bk-mrow-title">${esc(b.title)}</span>
      <span class="bk-mrow-meta">${b.status} · ${pct1(p)} · ≈${fmtInt(estimatedWordsForBook(b))} w</span>
    </button>`;
  };
  openModal(`<div class="bk-manager">${all.length ? all.map(row).join('') : '<div class="bk-books-empty">No books yet.</div>'}</div>`, 'Books');
  document.querySelectorAll('.bk-mrow').forEach(el => el.addEventListener('click', () => { closeModal(); openBookDetail(el.dataset.bookDetail, rerender); }));
}

// ---- notifications (restrained, grouped) ----------------------------------

function announce(res, book) {
  if (!res) return;
  if (res.completed) {
    showToast(`Book completed · you finished "${book ? book.title : ''}" (100%)`, 'success');
    return; // one combined message — never also announce the 100% goal
  }
  const reached = res.reached || [];
  if (!reached.length) {
    const e = res.event;
    showToast(e ? `Updated · +${e.pageDelta} pages · ≈${fmtInt(e.estimatedWords)} words` : 'Progress saved', 'success');
    return;
  }
  const text = g => g.type === 'percentage' ? `Completed ${g.targetValue}%` : `Reached page ${g.targetValue}`;
  if (reached.length === 1) showToast(`Goal reached · ${text(reached[0])}`, 'success');
  else showToast(`${reached.length} goals reached · ${reached.map(text).join(' · ')}`, 'success');
}
