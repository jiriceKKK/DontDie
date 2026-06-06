import { formatDate, today } from '../../utils/date.js';
import { switchTab } from '../../navigation.js';
import { state } from '../../state.js';
import {
  metricCurve, baselineMetricPerBlock, baselineMetricDaily,
  dailyMetric, hasAnyEntries,
} from '../store.js';

const r1 = n => Math.round(n * 10) / 10;

// Two dashboard views. The toggle swaps which metric is the main chart; the
// other numbers still show as small context cards. Cheap = amber, Productive
// = green, so the two views never look the same.
const VIEWS = {
  cheap: {
    metric: 'cheap',
    color: 'var(--accent)',
    loadLabel: 'Cheap Stim Load',
    baseLabel: 'Cheap Stim Baseline',
    legendToday: 'Cheap stim',
    emptyLine: 'No cheap-stim activity logged today.',
    relNoun: 'cheap-stim baseline',
    partLine: part => `${part} has the highest cheap-stim load.`,
  },
  productive: {
    metric: 'productive',
    color: 'var(--stim-productive)',
    loadLabel: 'Productive Activation',
    baseLabel: 'Productive Average',
    legendToday: 'Productive',
    emptyLine: 'No productive activity logged today yet.',
    relNoun: 'productive average',
    partLine: part => `${part} had your highest productive activation.`,
  },
};

// SVG: dashed baseline reference + today's per-block curve, in the view colour.
// Both lines share one Y domain (curve loads + baseline + 0) so a small today
// curve always stays visually below a larger baseline.
function chartSvg(curve, basePerBlock, color) {
  const W = 320, H = 168, padL = 8, padR = 8, padT = 14, padB = 22;
  const n = curve.length || 1;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const loads = curve.map(c => c.load);
  const all = [...loads, basePerBlock, 0];
  let yMin = Math.min(...all), yMax = Math.max(...all);
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) { yMin = 0; yMax = 1; }
  if (yMax - yMin < 1) { yMax += 0.5; yMin -= 0.5; }
  const pad = (yMax - yMin) * 0.15; yMin -= pad; yMax += pad;
  const x = i => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = v => padT + (1 - (v - yMin) / (yMax - yMin)) * innerH;

  const zeroY = y(0), baseY = y(basePerBlock);
  const pts = curve.map((c, i) => `${x(i)},${y(c.load)}`).join(' ');
  const dots = curve.map((c, i) => `<circle cx="${x(i)}" cy="${y(c.load)}" r="3" fill="${color}"/>`).join('');
  const labels = curve.map((c, i) => (i % 2 === 0)
    ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" font-size="9" fill="var(--text-muted)" font-family="'DM Mono',monospace">${c.label.slice(0, 5)}</text>` : '').join('');

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block">
    <line x1="${padL}" y1="${zeroY}" x2="${W - padR}" y2="${zeroY}" stroke="var(--border-subtle)" stroke-width="1"/>
    <line x1="${padL}" y1="${baseY}" x2="${W - padR}" y2="${baseY}" stroke="var(--text-muted)" stroke-width="1.5" stroke-dasharray="4 4"/>
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}${labels}
  </svg>`;
}

// Which third of the day carries the most of this metric.
function topPartOfDay(curve) {
  const parts = { Morning: 0, Afternoon: 0, Evening: 0 };
  for (const b of curve) {
    if (b.startMin < 12 * 60) parts.Morning += b.load;
    else if (b.startMin < 17 * 60) parts.Afternoon += b.load;
    else parts.Evening += b.load;
  }
  const top = Object.entries(parts).reduce((a, b) => (b[1] > a[1] ? b : a));
  return top[1] > 1e-9 ? top[0] : null;
}

function segmentedControl(active) {
  const btn = (id, label) =>
    `<button class="stim-seg-btn ${id === active ? 'active' : ''}" data-view="${id}">${label}</button>`;
  return `<div class="stim-seg" role="tablist">${btn('cheap', 'Cheap Stim')}${btn('productive', 'Productive')}</div>`;
}

export function renderStimDashboard() {
  const panel = document.getElementById('tab-dashboard');
  if (!panel) return;

  const view = state.stimView === 'productive' ? 'productive' : 'cheap';
  const cfg = VIEWS[view];
  const date = formatDate(today());
  const header = `<div class="mh-header"><div class="mh-title">Dashboard</div><div class="mh-subtitle">Estimated from logged activities · not a medical measurement</div></div>`;
  const seg = segmentedControl(view);

  const attach = () => {
    panel.querySelectorAll('.stim-seg-btn').forEach(b => b.addEventListener('click', () => {
      const v = b.dataset.view;
      if (v && v !== state.stimView) { state.stimView = v; renderStimDashboard(); }
    }));
    const lb = panel.querySelector('#stim-log-btn');
    if (lb) lb.addEventListener('click', () => switchTab('log'));
  };

  // No activity at all today → one shared empty card (toggle still works).
  if (!hasAnyEntries(date)) {
    panel.innerHTML = header + seg + `
      <div class="card mh-card" style="text-align:center;">
        <div class="mh-empty" style="padding:16px 8px;">No activities logged today yet.<br>Log your day to see your stimulation curves vs your recent baselines.</div>
        <button class="btn btn-primary" id="stim-log-btn" style="width:100%;">Log today</button>
      </div>`;
    attach();
    return;
  }

  const curve = metricCurve(date, cfg.metric);
  const basePerBlock = baselineMetricPerBlock(cfg.metric);
  const todayLoad = dailyMetric(date, cfg.metric);
  const base = baselineMetricDaily(cfg.metric);
  const withData = curve.filter(c => Math.abs(c.load) > 1e-9);
  const highest = withData.length ? withData.reduce((a, b) => (b.load > a.load ? b : a)) : null;
  const lowest = curve.reduce((a, b) => (b.load < a.load ? b : a), curve[0]);

  // Context numbers from the OTHER metrics (smaller cards).
  const otherMetric = view === 'cheap' ? 'productive' : 'cheap';
  const otherLabel = view === 'cheap' ? 'Productive Activation' : 'Cheap Stim Load';
  const otherVal = dailyMetric(date, otherMetric);
  const recovery = dailyMetric(date, 'recovery'); // ≤ 0

  // Summary (factual; no advice/diagnosis).
  let summary;
  if (Math.abs(todayLoad) < 1e-9) {
    summary = cfg.emptyLine;
  } else {
    const rel = base < 1e-9 ? 'Not enough earlier days yet to compare.'
      : todayLoad >= base ? `Today is above your recent ${cfg.relNoun} (${r1(todayLoad)} vs ${r1(base)}).`
      : `Today is below your recent ${cfg.relNoun} (${r1(todayLoad)} vs ${r1(base)}).`;
    const part = topPartOfDay(curve);
    summary = rel + (part ? ' ' + cfg.partLine(part) : '');
  }

  panel.innerHTML = header + seg + `
    <div class="card stim-chart-card">
      ${chartSvg(curve, basePerBlock, cfg.color)}
      <div class="stim-legend">
        <span><span class="stim-key" style="border-top-color:${cfg.color}"></span>${cfg.legendToday}</span>
        <span><span class="stim-key stim-key-base"></span>Baseline</span>
      </div>
    </div>

    <div class="stim-stat-grid">
      <div class="stim-stat"><div class="stim-stat-label">${cfg.loadLabel}</div><div class="stim-stat-num">${r1(todayLoad)}</div></div>
      <div class="stim-stat"><div class="stim-stat-label">${cfg.baseLabel}</div><div class="stim-stat-num">${r1(base)}</div></div>
      <div class="stim-stat"><div class="stim-stat-label">Highest block</div><div class="stim-stat-num">${highest ? r1(highest.load) : '–'}</div><div class="stim-stat-sub">${highest ? highest.label : ''}</div></div>
      <div class="stim-stat"><div class="stim-stat-label">${view === 'cheap' ? 'Calmest block' : 'Lowest block'}</div><div class="stim-stat-num">${lowest ? r1(lowest.load) : '–'}</div><div class="stim-stat-sub">${lowest ? lowest.label : ''}</div></div>
    </div>

    <div class="stim-sub-grid">
      <div class="stim-sub"><span class="stim-sub-label">${otherLabel}</span><span class="stim-sub-num">${r1(otherVal)}</span></div>
      <div class="stim-sub"><span class="stim-sub-label">Recovery Effect</span><span class="stim-sub-num">${r1(recovery)}</span></div>
    </div>

    <div class="card mh-summary-card">${summary}</div>

    <button class="btn btn-primary" id="stim-log-btn" style="width:100%;">Log / edit today</button>
  `;
  attach();
}
