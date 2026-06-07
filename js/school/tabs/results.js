import { esc } from '../util.js';
import { sessionLabel } from '../sessionTypes.js';
import {
  getResults, getTests, decorateTest, subjectName, findTest,
  sessionCounts, minutesStudied, scoreSeriesForTest,
} from '../store.js';
import { openResultModal, RISK_LABEL } from './_shared.js';

const r0 = n => Math.round(n);

// Tiny inline sparkline of scores (0–100) for one test.
function sparkline(series, color) {
  if (series.length < 2) return '';
  const W = 120, H = 28, n = series.length;
  const x = i => (n <= 1 ? W / 2 : (i / (n - 1)) * W);
  const y = v => H - 2 - (v / 100) * (H - 4);
  const pts = series.map((s, i) => `${x(i).toFixed(1)},${y(s.score).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="display:block">
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}

export function renderSchoolResults() {
  const panel = document.getElementById('tab-results');
  if (!panel) return;

  const header = `<div class="mh-header"><div class="mh-title">Results</div><div class="mh-subtitle">Scores, readiness & weak topics</div></div>`;
  const counts = sessionCounts();
  const results = getResults();
  const activeTests = getTests('active').map(decorateTest)
    .sort((a, b) => (a._daysUntil ?? 9999) - (b._daysUntil ?? 9999));

  const pasteBtn = `<button class="btn btn-primary" id="res-paste" style="width:100%;margin-bottom:14px;">Paste APP_RESULT</button>`;

  const summary = `<div class="stim-sub-grid">
      <div class="stim-sub"><span class="stim-sub-label">Done</span><span class="stim-sub-num">${counts.done}</span></div>
      <div class="stim-sub"><span class="stim-sub-label">Planned</span><span class="stim-sub-num">${counts.planned}</span></div>
      <div class="stim-sub"><span class="stim-sub-label">Minutes</span><span class="stim-sub-num">${minutesStudied()}</span></div>
    </div>`;

  // Readiness by active test.
  const readinessHtml = activeTests.length ? `
    <div class="section-title">Readiness by test</div>
    ${activeTests.map(t => {
      const series = scoreSeriesForTest(t.id);
      const last = series.length ? series[series.length - 1] : null;
      const weak = t.weakTopics && t.weakTopics.length ? `weak topics: ${esc(t.weakTopics.slice(0, 4).join(', '))}` : 'no weak topics recorded';
      const nextHint = last ? ` · last ${last.type ? sessionLabel(last.type) : 'quiz'}: ${last.score}%` : '';
      return `<div class="card school-result-test">
        <div class="school-result-test-top">
          <div>
            <div class="school-result-name">${esc(subjectName(t.subjectId))} — ${esc(t.title)}</div>
            <div class="school-result-sub">readiness ${t._readiness}% · ${RISK_LABEL[t._risk].toLowerCase()}${nextHint}</div>
          </div>
          ${sparkline(series, 'var(--accent)')}
        </div>
        <div class="school-result-weak">${weak}.</div>
      </div>`;
    }).join('')}` : '';

  // Recent parsed results.
  const recentHtml = results.length ? `
    <div class="section-title">Recent results</div>
    <div class="school-result-list">
      ${results.slice(0, 12).map(r => {
        const test = r.testId ? findTest(r.testId) : null;
        const where = test ? `${subjectName(test.subjectId)} — ${test.title}` : (r.subject || 'Unlinked');
        const score = r.scorePercent == null ? 'n/a' : `${r0(r.scorePercent)}%`;
        const next = r.recommendedNextSession && r.recommendedNextSession !== 'none' ? ` · next: ${esc(sessionLabel(r.recommendedNextSession))}` : '';
        return `<div class="school-result-row">
          <div class="school-result-row-top"><span>${esc(where)}</span><span class="school-result-score">${score}</span></div>
          <div class="school-result-row-sub">${esc(sessionLabel(r.sessionType))}${next}</div>
          ${r.weakTopics.length ? `<div class="school-result-row-weak">weak: ${esc(r.weakTopics.slice(0, 5).join(', '))}</div>` : ''}
        </div>`;
      }).join('')}
    </div>` : `<div class="mh-empty" style="text-align:left;">No results yet. Run a scored session in Claude and paste its APP_RESULT.</div>`;

  panel.innerHTML = header + pasteBtn + summary + readinessHtml + recentHtml;

  const pb = panel.querySelector('#res-paste');
  if (pb) pb.addEventListener('click', () => openResultModal({ onDone: renderSchoolResults }));
}
