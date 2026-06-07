import { formatDate, today } from '../../utils/date.js';
import { switchTab } from '../../navigation.js';
import { state } from '../../state.js';
import {
  metricCurve, baselineMetricPerBlock, baselineMetricDaily,
  dailyMetric, hasAnyEntries, metricTarget, targetStatus, blockDrivers,
} from '../store.js';

const r1 = n => Math.round(n * 10) / 10;
const rng = t => `${r1(t.lo)}–${r1(t.hi)}`;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const signed = n => (n >= 0 ? '+' : '') + r1(n);

// Selected chart segment (index of the segment between curve[i] and curve[i+1]).
// Module-scoped session state: reset on every full dashboard re-render (view
// toggle, navigation, data/date change) and never persisted. `_ctx` carries the
// data the detail card needs so a tap doesn't rebuild the whole chart.
let _selectedSeg = null;
let _ctx = null;

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
    targetWord: 'cheap-stim',
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
    targetWord: 'productive',
  },
};

// SVG: subtle target band + dashed baseline + today's per-block curve, all in
// one Y domain (curve loads + baseline + band + 0) so a small today curve always
// stays visually below a larger baseline/target. `band` is per-block {lo, hi}.
function chartSvg(curve, basePerBlock, color, band) {
  const W = 320, H = 168, padL = 8, padR = 8, padT = 14, padB = 22;
  const n = curve.length || 1;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const loads = curve.map(c => c.load);
  const all = [...loads, basePerBlock, 0];
  if (band) { all.push(band.lo, band.hi); }
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

  // Target band drawn first (behind everything), kept subtle.
  let bandSvg = '';
  if (band) {
    const yHi = y(band.hi), yLo = y(band.lo);
    const top = Math.min(yHi, yLo), h = Math.max(1, Math.abs(yLo - yHi));
    bandSvg = `<rect x="${padL}" y="${top}" width="${innerW}" height="${h}" fill="${color}" opacity="0.10"/>
      <line x1="${padL}" y1="${yHi}" x2="${W - padR}" y2="${yHi}" stroke="${color}" stroke-width="1" opacity="0.3"/>`;
  }

  // Invisible fat hitboxes over each line segment (between consecutive points),
  // drawn LAST so they sit on top. pointer-events:stroke (set in CSS) means only
  // the ~26-unit-wide transparent stroke is tappable — easy on mobile without
  // thickening the visible 2.5-wide line. data-seg = index of the start point.
  let hits = '';
  for (let i = 0; i < curve.length - 1; i++) {
    hits += `<line class="stim-seg-hit" data-seg="${i}" x1="${x(i)}" y1="${y(curve[i].load)}" x2="${x(i + 1)}" y2="${y(curve[i + 1].load)}" stroke="transparent" stroke-width="26" stroke-linecap="round"/>`;
  }

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block">
    ${bandSvg}
    <line x1="${padL}" y1="${zeroY}" x2="${W - padR}" y2="${zeroY}" stroke="var(--border-subtle)" stroke-width="1"/>
    <line x1="${padL}" y1="${baseY}" x2="${W - padR}" y2="${baseY}" stroke="var(--text-muted)" stroke-width="1.5" stroke-dasharray="4 4"/>
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}${labels}
    ${hits}
  </svg>`;
}

// Drivers for one block, filtered/sorted for the active metric: metric-positive
// activities first, then any recovery activities as context.
function driversHtml(date, idx, metric) {
  const ds = blockDrivers(date, idx);
  const main = ds.filter(d => d[metric] > 1e-9).sort((a, b) => b[metric] - a[metric]);
  const rec = ds.filter(d => d.recovery < -1e-9).sort((a, b) => a.recovery - b.recovery);
  const noun = metric === 'cheap' ? 'cheap-stim' : 'productive';

  if (!main.length && !rec.length) {
    return `<div class="stim-seg-none">No ${noun} drivers</div>`;
  }
  const row = (name, mins, val, tag) =>
    `<div class="stim-seg-driver"><span class="stim-seg-dn">${esc(name)}</span><span class="stim-seg-dv">${mins} min · ${signed(val)}${tag ? ' ' + tag : ''}</span></div>`;
  return main.map(d => row(d.name, d.minutes, d[metric], '')).join('')
    + rec.map(d => row(d.name, d.minutes, d.recovery, 'recovery')).join('');
}

// Detail card for the selected segment. Renders into #stim-seg-detail only, so a
// tap never rebuilds the chart (keeps scroll + selection stable).
function renderDetail() {
  const host = document.getElementById('stim-seg-detail');
  if (!host) return;
  if (_selectedSeg === null || !_ctx) {
    host.innerHTML = `<div class="stim-seg-hint">Tap a line segment to see what drove the change.</div>`;
    return;
  }
  const { curve, metric, metricName, color, date } = _ctx;
  const A = curve[_selectedSeg], B = curve[_selectedSeg + 1];
  if (!A || !B) { host.innerHTML = ''; _selectedSeg = null; return; }

  const delta = B.load - A.load;
  const flat = Math.abs(delta) < 0.05;
  const label = flat ? 'Stable' : delta > 0 ? 'Increase' : 'Drop';
  const arrow = flat ? '→' : delta > 0 ? '↑' : '↓';
  const tagClass = flat ? 'stable' : delta > 0 ? 'increase' : 'drop';

  host.innerHTML = `
    <div class="stim-seg-card">
      <div class="stim-seg-head">
        <span class="stim-seg-range">${esc(A.label)} → ${esc(B.label)}</span>
        <button class="stim-seg-close" id="stim-seg-close" aria-label="Close">✕</button>
      </div>
      <div class="stim-seg-metric">
        <span style="color:${color}">${metricName} ${signed(delta)}</span>
        <span class="stim-seg-tag ${tagClass}">${arrow} ${label}</span>
        <span class="stim-seg-vals">${r1(A.load)} → ${r1(B.load)}</span>
      </div>
      <div class="stim-seg-block">
        <div class="stim-seg-bl">${esc(A.label)}</div>
        ${driversHtml(date, A.index, metric)}
      </div>
      <div class="stim-seg-block">
        <div class="stim-seg-bl">${esc(B.label)}</div>
        ${driversHtml(date, B.index, metric)}
      </div>
    </div>`;
}

function selectSegment(i) {
  _selectedSeg = i;
  renderDetail();
}

// Delegated tap handling, bound once per panel element (survives innerHTML
// rewrites; re-binds if the mode controller rebuilds the panel). Handles:
// segment tap → select, ✕ → close, tap outside the chart/detail → close.
function bindSegmentTaps(panel) {
  if (panel.dataset.stimSegBound) return;
  panel.dataset.stimSegBound = '1';
  panel.addEventListener('click', (e) => {
    const hit = e.target.closest('[data-seg]');
    if (hit) { selectSegment(parseInt(hit.dataset.seg, 10)); return; }
    if (e.target.closest('#stim-seg-close')) { _selectedSeg = null; renderDetail(); return; }
    // Tap anywhere that isn't the chart or the detail card closes the popup.
    if (_selectedSeg !== null && !e.target.closest('#stim-seg-detail') && !e.target.closest('.stim-chart-card')) {
      _selectedSeg = null; renderDetail();
    }
  });
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

// Plain-language status for the target card pill.
function statusText(view, status) {
  if (status === 'within') return 'On target';
  if (status === 'above') return view === 'cheap' ? 'Above target' : 'Above range';
  return view === 'cheap' ? 'Below target' : 'Below range';
}

export function renderStimDashboard() {
  const panel = document.getElementById('tab-dashboard');
  if (!panel) return;

  const view = state.stimView === 'productive' ? 'productive' : 'cheap';
  const cfg = VIEWS[view];
  const date = formatDate(today());
  const header = `<div class="mh-header"><div class="mh-title">Dashboard</div><div class="mh-subtitle">Estimated from logged activities · not a medical measurement</div></div>`;
  const seg = segmentedControl(view);

  // A full re-render resets the chart-segment selection (view/data/date change).
  _selectedSeg = null;
  _ctx = null;

  bindSegmentTaps(panel);

  const attach = () => {
    panel.querySelectorAll('.stim-seg-btn').forEach(b => b.addEventListener('click', () => {
      const v = b.dataset.view;
      if (v && v !== state.stimView) { state.stimView = v; renderStimDashboard(); }
    }));
    const lb = panel.querySelector('#stim-log-btn');
    if (lb) lb.addEventListener('click', () => switchTab('log'));
    renderDetail();
  };

  // No activity at all today → one shared empty card (toggle still works).
  if (!hasAnyEntries(date)) {
    panel.innerHTML = header + seg + `
      <div class="card mh-card" style="text-align:center;">
        <div class="mh-empty" style="padding:16px 8px;">No activities logged today yet.<br>Log your day to see your stimulation curves vs your baseline and target range.</div>
        <button class="btn btn-primary" id="stim-log-btn" style="width:100%;">Log today</button>
      </div>`;
    attach();
    return;
  }

  const curve = metricCurve(date, cfg.metric);
  // Data the segment popup needs (so a tap doesn't recompute the chart).
  _ctx = { date, metric: cfg.metric, metricName: cfg.loadLabel, color: cfg.color, curve };
  const blocks = curve.length || 1;
  const basePerBlock = baselineMetricPerBlock(cfg.metric);
  const todayLoad = dailyMetric(date, cfg.metric);
  const base = baselineMetricDaily(cfg.metric);
  const target = metricTarget(cfg.metric);
  const bandPerBlock = { lo: target.lo / blocks, hi: target.hi / blocks };
  const tStatus = targetStatus(todayLoad, target);

  const withData = curve.filter(c => Math.abs(c.load) > 1e-9);
  const highest = withData.length ? withData.reduce((a, b) => (b.load > a.load ? b : a)) : null;
  const lowest = curve.reduce((a, b) => (b.load < a.load ? b : a), curve[0]);

  // Context numbers from the OTHER metrics (smaller cards).
  const otherMetric = view === 'cheap' ? 'productive' : 'cheap';
  const otherLabel = view === 'cheap' ? 'Productive Activation' : 'Cheap Stim Load';
  const otherVal = dailyMetric(date, otherMetric);
  const recovery = dailyMetric(date, 'recovery'); // ≤ 0

  // Summary (factual; no advice/diagnosis): today vs target, then vs baseline.
  let summary;
  if (Math.abs(todayLoad) < 1e-9) {
    summary = cfg.emptyLine;
  } else {
    const tSentence = view === 'cheap'
      ? (tStatus === 'within' ? 'Today is within your cheap-stim target range.'
        : tStatus === 'above' ? 'Today is above your cheap-stim target range.'
        : 'Today is below your cheap-stim target range.')
      : (tStatus === 'within' ? 'Today is inside your productive target range.'
        : tStatus === 'above' ? 'Today is above your productive target range.'
        : 'Today is below your productive target range.');
    let baseClause = '';
    if (base >= 1e-9) {
      baseClause = todayLoad >= base
        ? ` That's above your recent ${cfg.relNoun} (${r1(todayLoad)} vs ${r1(base)}).`
        : ` That's below your recent ${cfg.relNoun} (${r1(todayLoad)} vs ${r1(base)}).`;
    }
    // Cheap-only insight: flag when your baseline itself sits above target.
    let baseTargetClause = '';
    if (view === 'cheap' && base >= 1e-9 && targetStatus(base, target) === 'above') {
      baseTargetClause = ' Your recent cheap-stim baseline is above target.';
    }
    summary = tSentence + baseClause + baseTargetClause;
  }

  panel.innerHTML = header + seg + `
    <div class="card stim-chart-card">
      ${chartSvg(curve, basePerBlock, cfg.color, bandPerBlock)}
      <div class="stim-legend">
        <span><span class="stim-key" style="border-top-color:${cfg.color}"></span>${cfg.legendToday}</span>
        <span><span class="stim-key stim-key-base"></span>Baseline</span>
        <span><span class="stim-key-band" style="background:${cfg.color}"></span>Target</span>
      </div>
    </div>

    <div id="stim-seg-detail"></div>

    <div class="stim-stat-grid">
      <div class="stim-stat"><div class="stim-stat-label">${cfg.loadLabel}</div><div class="stim-stat-num">${r1(todayLoad)}</div></div>
      <div class="stim-stat"><div class="stim-stat-label">${cfg.baseLabel}</div><div class="stim-stat-num">${r1(base)}</div></div>
      <div class="stim-stat"><div class="stim-stat-label">Highest block</div><div class="stim-stat-num">${highest ? r1(highest.load) : '–'}</div><div class="stim-stat-sub">${highest ? highest.label : ''}</div></div>
      <div class="stim-stat"><div class="stim-stat-label">${view === 'cheap' ? 'Calmest block' : 'Lowest block'}</div><div class="stim-stat-num">${lowest ? r1(lowest.load) : '–'}</div><div class="stim-stat-sub">${lowest ? lowest.label : ''}</div></div>
    </div>

    <div class="card stim-target-card">
      <div class="stim-target-row">
        <span class="stim-target-label">Target range</span>
        <span class="stim-target-range">${rng(target)}</span>
      </div>
      <div class="stim-target-meta">
        <span class="stim-target-status ${tStatus}">${statusText(view, tStatus)}</span>
        <span class="stim-target-src">${target.source === 'data' ? 'Based on your better days' : 'Estimated default range'}</span>
      </div>
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
