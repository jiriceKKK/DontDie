import { formatDate, today } from '../../utils/date.js';
import { switchTab } from '../../navigation.js';
import {
  todayCurve, baselinePerBlock, baselineDaily, dailyLoad, hasAnyEntries,
} from '../store.js';

const r1 = n => Math.round(n * 10) / 10;

// SVG: a muted dashed baseline reference + today's per-block load curve (amber).
function chartSvg(curve, basePerBlock) {
  const W = 320, H = 168, padL = 8, padR = 8, padT = 14, padB = 22;
  const n = curve.length || 1;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const loads = curve.map(c => c.load);
  const all = [...loads, basePerBlock, 0];
  let yMin = Math.min(...all), yMax = Math.max(...all);
  if (yMax - yMin < 1) { yMax += 0.5; yMin -= 0.5; }
  const pad = (yMax - yMin) * 0.15; yMin -= pad; yMax += pad;
  const x = i => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = v => padT + (1 - (v - yMin) / (yMax - yMin)) * innerH;

  const zeroY = y(0), baseY = y(basePerBlock);
  const pts = curve.map((c, i) => `${x(i)},${y(c.load)}`).join(' ');
  const dots = curve.map((c, i) => `<circle cx="${x(i)}" cy="${y(c.load)}" r="3" fill="var(--accent)"/>`).join('');
  // x labels: block start hour, every other block to avoid crowding
  const labels = curve.map((c, i) => (i % 2 === 0)
    ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" font-size="9" fill="var(--text-muted)" font-family="'DM Mono',monospace">${c.label.slice(0, 5)}</text>` : '').join('');

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block">
    <line x1="${padL}" y1="${zeroY}" x2="${W - padR}" y2="${zeroY}" stroke="var(--border-subtle)" stroke-width="1"/>
    <line x1="${padL}" y1="${baseY}" x2="${W - padR}" y2="${baseY}" stroke="var(--text-muted)" stroke-width="1.5" stroke-dasharray="4 4"/>
    <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}${labels}
  </svg>`;
}

function partOfDaySummary(curve) {
  const parts = { Morning: 0, Afternoon: 0, Evening: 0 };
  for (const b of curve) {
    if (b.startMin < 12 * 60) parts.Morning += b.load;
    else if (b.startMin < 17 * 60) parts.Afternoon += b.load;
    else parts.Evening += b.load;
  }
  const entries = Object.entries(parts);
  const top = entries.reduce((a, b) => (b[1] > a[1] ? b : a));
  return top[1] > 0 ? `${top[0]} is the highest-stimulation part of the day so far.` : null;
}

export function renderStimDashboard() {
  const panel = document.getElementById('tab-dashboard');
  if (!panel) return;
  const date = formatDate(today());
  const header = `<div class="mh-header"><div class="mh-title">Dashboard</div><div class="mh-subtitle">Estimated stimulation load · from logged activities</div></div>`;

  if (!hasAnyEntries(date)) {
    panel.innerHTML = header + `
      <div class="card mh-card" style="text-align:center;">
        <div class="mh-empty" style="padding:16px 8px;">No activities logged today yet.<br>Log your day to see your stimulation curve vs your recent baseline.</div>
        <button class="btn btn-primary" id="stim-log-btn" style="width:100%;">Log today</button>
      </div>`;
    const b = panel.querySelector('#stim-log-btn');
    if (b) b.addEventListener('click', () => switchTab('log'));
    return;
  }

  const curve = todayCurve(date);
  const basePerBlock = baselinePerBlock();
  const todayTotal = dailyLoad(date);
  const base = baselineDaily();
  const withData = curve.filter(c => c.load !== 0);
  const highest = withData.length ? withData.reduce((a, b) => (b.load > a.load ? b : a)) : null;
  const lowest = withData.length ? withData.reduce((a, b) => (b.load < a.load ? b : a)) : null;

  const rel = base === 0 ? 'No baseline yet (need a few earlier days).'
    : todayTotal >= base ? `Today is above your recent baseline (${r1(todayTotal)} vs ${r1(base)}).`
    : `Today is below your recent baseline (${r1(todayTotal)} vs ${r1(base)}).`;
  const partLine = partOfDaySummary(curve);

  panel.innerHTML = header + `
    <div class="card stim-chart-card">
      ${chartSvg(curve, basePerBlock)}
      <div class="stim-legend">
        <span><span class="stim-key stim-key-curve"></span>Today</span>
        <span><span class="stim-key stim-key-base"></span>Baseline</span>
      </div>
    </div>

    <div class="stim-stat-grid">
      <div class="stim-stat"><div class="stim-stat-label">Today's load</div><div class="stim-stat-num">${r1(todayTotal)}</div></div>
      <div class="stim-stat"><div class="stim-stat-label">Baseline</div><div class="stim-stat-num">${r1(base)}</div></div>
      <div class="stim-stat"><div class="stim-stat-label">Highest block</div><div class="stim-stat-num">${highest ? r1(highest.load) : '–'}</div><div class="stim-stat-sub">${highest ? highest.label : ''}</div></div>
      <div class="stim-stat"><div class="stim-stat-label">Calmest block</div><div class="stim-stat-num">${lowest ? r1(lowest.load) : '–'}</div><div class="stim-stat-sub">${lowest ? lowest.label : ''}</div></div>
    </div>

    <div class="card mh-summary-card">${rel}${partLine ? ' ' + partLine : ''}</div>

    <button class="btn btn-primary" id="stim-log-btn" style="width:100%;">Log / edit today</button>
  `;
  const b = panel.querySelector('#stim-log-btn');
  if (b) b.addEventListener('click', () => switchTab('log'));
}
