// ============================================================
// MIND · TEXTS — dashboard. A calm, information-rich home for the guided
// reading system: the big words-read metric, the single primary reading
// action, import / prompt / feedback controls, compact stats, the Highlights
// entry point, and top-topics. Deliberately shows NO list of unread titles —
// the user reads what the queue serves, in order, one at a time.
// ============================================================

import { openModal, closeModal } from '../../ui/modal.js';
import { showToast } from '../../ui/toast.js';
import { copyToClipboard } from '../../school/util.js';
import {
  statsSummary, primaryAction, topTopics, startOrContinueReading,
  getCurrentText, unreadCount, commitTextsImport, markFeedbackExported,
} from '../texts/store.js';
import { parseTextsImport } from '../texts/parser.js';
import { GENERATION_PROMPT, buildFeedback, FEEDBACK_SCOPES } from '../texts/prompts.js';
import { openReader } from '../texts/reader.js';
import { openHighlightsViewer } from '../texts/highlights.js';
import { bookWordsTotal } from '../texts/books.js';
import { booksSectionHtml, wireBooks } from '../texts/booksUI.js';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtInt = n => Number(n || 0).toLocaleString('en-US');
const fmtAvg = n => (n == null ? '—' : (Math.round(n * 10) / 10).toFixed(1));

function fmtReadTime(sec) {
  sec = Math.round(sec || 0);
  if (sec < 60) return sec ? `${sec} sec` : '0 min';
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

let topicsExpanded = false;

export function renderTexts() {
  const panel = document.getElementById('tab-texts');
  if (!panel) return;

  const s = statsSummary();
  const action = primaryAction();
  const cur = getCurrentText();
  const topics = topTopics();
  const totallyEmpty = s.textsCompleted === 0 && s.unread === 0 && !cur;

  // queue line — never reveals titles
  let queueLine;
  if (cur && cur.status === 'reflection') queueLine = 'A reflection is waiting to be finished.';
  else if (cur) queueLine = `Reading in progress${s.unread ? ` · ${s.unread} more waiting` : ''}.`;
  else if (s.unread > 0) queueLine = `${s.unread} text${s.unread > 1 ? 's' : ''} ready to read.`;
  else queueLine = 'Queue empty — generate and import a new batch.';

  const header = `
    <div class="mh-header">
      <div class="mh-title">Texts</div>
      <div class="mh-subtitle">Read one, reflect, repeat</div>
    </div>`;

  // Combined words-read = exact generated-text words + estimated physical-book
  // words. Book words are clearly marked estimated (≈). Reading time stays
  // generated-text-only and is labelled so it never implies book time.
  const genWords = s.wordsRead;
  const bookWords = bookWordsTotal();
  const combined = genWords + bookWords;
  const breakdown = bookWords > 0
    ? `<div class="tx-breakdown">${fmtInt(genWords)} generated texts · ≈${fmtInt(bookWords)} books</div>`
    : '';
  const hero = `
    <div class="card tx-hero">
      <div class="tx-words">${fmtInt(combined)}</div>
      <div class="tx-words-label">words read</div>
      ${breakdown}
      <div class="tx-time">${fmtReadTime(s.readingSeconds)} in-app reading</div>
    </div>`;

  const intro = totallyEmpty ? `
    <div class="card tx-intro">
      <div class="tx-intro-title">A quiet reading habit</div>
      <ol class="tx-intro-steps">
        <li>Copy the generation prompt into your AI chat.</li>
        <li>Paste the five texts it returns back here.</li>
        <li>Read one, tap what stands out, add a short reflection.</li>
      </ol>
    </div>` : '';

  const queue = `
    <div class="card tx-queue">
      <div class="tx-queue-line">${esc(queueLine)}</div>
      <button class="btn btn-primary tx-primary" id="tx-primary" ${action.kind === 'empty' ? 'disabled' : ''}>${esc(action.label)}</button>
      <div class="tx-secondary">
        <button class="btn btn-ghost" id="tx-prompt">Copy generation prompt</button>
        <button class="btn btn-ghost" id="tx-import">Import texts</button>
      </div>
    </div>`;

  const stats = `
    <div class="card tx-stats">
      <div class="tx-stat"><div class="tx-stat-n">${s.textsCompleted}</div><div class="tx-stat-l">completed</div></div>
      <div class="tx-stat"><div class="tx-stat-n">${fmtAvg(s.avgEngagement)}</div><div class="tx-stat-l">engagement</div></div>
      <div class="tx-stat"><div class="tx-stat-n">${fmtAvg(s.avgLearning)}</div><div class="tx-stat-l">learning</div></div>
      <div class="tx-stat"><div class="tx-stat-n">${fmtAvg(s.avgRelevance)}</div><div class="tx-stat-l">relevance</div></div>
      <div class="tx-stat"><div class="tx-stat-n">${s.highlightsSaved}</div><div class="tx-stat-l">highlights</div></div>
      <div class="tx-stat"><div class="tx-stat-n">${s.unread}</div><div class="tx-stat-l">in queue</div></div>
    </div>`;

  const tools = `
    <div class="tx-tools">
      <button class="btn btn-ghost tx-tool" id="tx-highlights">Highlights · ${s.highlightsSaved}</button>
      <button class="btn btn-ghost tx-tool" id="tx-feedback" ${s.textsCompleted === 0 ? 'disabled' : ''}>Copy feedback for AI</button>
    </div>`;

  const topicsCard = topicsSection(topics);
  const books = booksSectionHtml();

  panel.innerHTML = header + hero + intro + queue + stats + books + tools + topicsCard;
  wire(panel);
  wireBooks(panel, () => renderTexts());
}

function topicsSection(topics) {
  if (!topics.length) {
    return `<div class="card tx-topics">
      <div class="tx-topics-head">Top topics</div>
      <div class="tx-topics-empty">Complete a few texts to see which topics land best.</div>
    </div>`;
  }
  const show = topicsExpanded ? topics : topics.slice(0, 4);
  const rows = show.map(t => {
    const lowSample = t.count < 2;
    const more = t.more;
    const moreBits = (more.yes || more.maybe || more.no)
      ? `<span class="tx-topic-more">more: ${more.yes}·${more.maybe}·${more.no}</span>` : '';
    return `
      <div class="tx-topic">
        <div class="tx-topic-main">
          <span class="tx-topic-name">${esc(t.topic)}</span>
          <span class="tx-topic-count">${t.count} text${t.count > 1 ? 's' : ''}${lowSample ? ' · low sample' : ''}</span>
        </div>
        <div class="tx-topic-metrics">
          <span title="engagement">E ${fmtAvg(t.avgEngagement)}</span>
          <span title="learning">L ${fmtAvg(t.avgLearning)}</span>
          <span title="relevance">R ${fmtAvg(t.avgRelevance)}</span>
          ${moreBits}
        </div>
      </div>`;
  }).join('');
  const toggle = topics.length > 4
    ? `<button class="tx-topics-toggle" id="tx-topics-toggle">${topicsExpanded ? 'Show less' : `Show all ${topics.length}`}</button>` : '';
  return `<div class="card tx-topics">
    <div class="tx-topics-head">Top topics</div>
    ${rows}${toggle}
  </div>`;
}

function wire(panel) {
  const rerender = () => renderTexts();

  const primary = panel.querySelector('#tx-primary');
  if (primary) primary.addEventListener('click', () => {
    const action = primaryAction();
    if (action.kind === 'empty') return;
    const t = startOrContinueReading();
    if (t) openReader(t, rerender);
  });

  const prompt = panel.querySelector('#tx-prompt');
  if (prompt) prompt.addEventListener('click', async () => {
    const ok = await copyToClipboard(GENERATION_PROMPT);
    showToast(ok ? 'Generation prompt copied — paste it into your AI chat' : 'Copy failed — select & copy manually', ok ? 'success' : 'error');
  });

  const importBtn = panel.querySelector('#tx-import');
  if (importBtn) importBtn.addEventListener('click', () => openImportModal(rerender));

  const hl = panel.querySelector('#tx-highlights');
  if (hl) hl.addEventListener('click', () => openHighlightsViewer());

  const fb = panel.querySelector('#tx-feedback');
  if (fb) fb.addEventListener('click', () => openFeedbackModal());

  const toggle = panel.querySelector('#tx-topics-toggle');
  if (toggle) toggle.addEventListener('click', () => { topicsExpanded = !topicsExpanded; renderTexts(); });
}

// ---- import modal ---------------------------------------------------------

function openImportModal(rerender) {
  openModal(`
    <div class="tx-imp-intro">Paste the <code>DONTDIE_TEXTS_IMPORT_V1</code> block your AI produced. Any prose around it is fine.</div>
    <textarea class="form-input tx-imp-text" id="tx-imp-text" rows="8" placeholder="DONTDIE_TEXTS_IMPORT_V1&#10;{ &quot;version&quot;: 1, ... }"></textarea>
    <div class="tx-imp-err" id="tx-imp-err" hidden></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="tx-imp-cancel">Cancel</button>
      <button class="btn btn-primary" id="tx-imp-go">Import</button>
    </div>
  `, 'Import texts');

  const err = document.getElementById('tx-imp-err');
  document.getElementById('tx-imp-cancel').addEventListener('click', closeModal);
  document.getElementById('tx-imp-go').addEventListener('click', () => {
    const raw = document.getElementById('tx-imp-text').value;
    const parsed = parseTextsImport(raw);
    if (!parsed.ok) { err.hidden = false; err.textContent = parsed.error; return; }
    const res = commitTextsImport(parsed.texts, { language: parsed.language, generatedAt: parsed.generatedAt });
    closeModal();
    // Summary only — never reveals imported titles.
    let msg;
    if (res.imported && res.skipped) msg = `Imported ${res.imported} · skipped ${res.skipped} duplicate${res.skipped > 1 ? 's' : ''} · ${res.queueSize} in queue`;
    else if (res.imported) msg = `Imported ${res.imported} text${res.imported > 1 ? 's' : ''} · ${res.queueSize} in queue`;
    else msg = 'Nothing new — these were already imported';
    showToast(msg, res.imported ? 'success' : 'default');
    if (parsed.warnings && parsed.warnings.length) setTimeout(() => showToast(parsed.warnings[0], 'warning'), 400);
    rerender();
  });
}

// ---- feedback modal -------------------------------------------------------

function openFeedbackModal() {
  let scope = 'unexported';
  openModal(`
    <div class="tx-fb-intro">Copies your reading results as a <code>DONTDIE_TEXTS_FEEDBACK_V1</code> block — paste it back into the AI chat that made these texts so the next batch adapts to you.</div>
    <div class="tx-fb-scopes">
      ${FEEDBACK_SCOPES.map((sc, i) => `
        <button class="tx-fb-scope ${i === 0 ? 'active' : ''}" data-scope="${sc.id}">
          <span class="tx-fb-scope-l">${esc(sc.label)}</span>
          <span class="tx-fb-scope-h">${esc(sc.hint)}</span>
        </button>`).join('')}
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="tx-fb-cancel">Cancel</button>
      <button class="btn btn-primary" id="tx-fb-go">Copy feedback</button>
    </div>
  `, 'Copy feedback for AI');

  document.querySelectorAll('.tx-fb-scope').forEach(b => b.addEventListener('click', () => {
    scope = b.dataset.scope;
    document.querySelectorAll('.tx-fb-scope').forEach(x => x.classList.toggle('active', x === b));
  }));
  document.getElementById('tx-fb-cancel').addEventListener('click', closeModal);
  document.getElementById('tx-fb-go').addEventListener('click', async () => {
    const { count, text } = buildFeedback(scope);
    if (!count) { showToast('Nothing to export in that scope yet', 'warning'); return; }
    const ok = await copyToClipboard(text);
    if (ok) { markFeedbackExported(); closeModal(); showToast(`Feedback for ${count} text${count > 1 ? 's' : ''} copied`, 'success'); }
    else showToast('Copy failed — select & copy manually', 'error');
  });
}
