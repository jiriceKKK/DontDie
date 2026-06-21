import { formatDate, today } from '../../utils/date.js';
import { switchTab } from '../../navigation.js';
import { state } from '../../state.js';
import {
  metricCurve, baselineMetricPerBlock, baselineMetricDaily,
  dailyMetric, hasAnyEntries, metricTarget, targetStatus, blockDrivers,
  blockMetric, dailyGrossCheap, dailyRecoveryCredit,
} from '../store.js';

const r1 = n => Math.round(n * 10) / 10;
const rng = t => `${r1(t.lo)}–${r1(t.hi)}`;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const signed = n => (n >= 0 ? '+' : '') + r1(n);

// Selected chart BLOCK (index into curve). One block = one point at the block's
// centre time, so the selection always lines up with the visible peak and the
// tooltip's time range. Module-scoped session state: reset on every full
// dashboard re-render (view toggle, navigation, data/date change) and never
// persisted. `_ctx` carries what a tap needs so it doesn't rebuild the chart.
let _selectedBlock = null;
let _ctx = null;

// Two dashboard views. The toggle swaps which metric is the main chart; the
// other numbers still show as small context cards. Cheap = amber, Productive
// = green, so the two views never look the same.
const VIEWS = {
  cheap: {
    metric: 'cheap',
    color: 'var(--accent)',
    loadLabel: 'Cheap Stim Load',
    shortName: 'Cheap Stim',
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
    shortName: 'Productive',
    baseLabel: 'Productive Average',
    legendToday: 'Productive',
    emptyLine: 'No productive activity logged today yet.',
    relNoun: 'productive average',
    partLine: part => `${part} had your highest productive activation.`,
    targetWord: 'productive',
  },
};

const CHART_W = 320, CHART_H = 168;

// SVG: subtle target band + dashed baseline + today's curve. Each time block is
// ONE point on a real time axis, placed at the block's CENTRE time — so a value
// logged in 11:00–13:00 peaks around 12:00 (between the 11 and 13 ticks) instead
// of sitting on the 11:00 boundary. Whole-block vertical hit columns make every
// tap map to exactly the block under the finger. One shared Y domain (loads +
// baseline + band + 0) keeps a small curve visually below a larger target.
function chartSvg(curve, basePerBlock, color, band) {
  const W = CHART_W, H = CHART_H, padL = 8, padR = 8, padT = 14, padB = 22;
  const n = curve.length || 1;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const loads = curve.map(c => c.load);
  const all = [...loads, basePerBlock, 0];
  if (band) { all.push(band.lo, band.hi); }
  let yMin = Math.min(...all), yMax = Math.max(...all);
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) { yMin = 0; yMax = 1; }
  if (yMax - yMin < 1) { yMax += 0.5; yMin -= 0.5; }
  const pad = (yMax - yMin) * 0.15; yMin -= pad; yMax += pad;

  // Real time axis from the first block's start to the last block's end; each
  // block's point is at its midpoint time, so points sit INSIDE their blocks.
  const startT = curve[0] ? curve[0].startMin : 0;
  const endT = curve[n - 1] ? curve[n - 1].endMin : startT + 60;
  const spanT = Math.max(1, endT - startT);
  const xT = t => padL + ((t - startT) / spanT) * innerW;
  const cx = b => xT((b.startMin + b.endMin) / 2);
  const y = v => padT + (1 - (v - yMin) / (yMax - yMin)) * innerH;

  const zeroY = y(0), baseY = y(basePerBlock);
  const PX = curve.map(cx), PY = curve.map(c => y(c.load));
  const pts = curve.map((c, i) => `${PX[i]},${PY[i]}`).join(' ');
  const dots = curve.map((c, i) => `<circle cx="${PX[i]}" cy="${PY[i]}" r="3" fill="${color}"/>`).join('');

  // Range labels ("07–09") centred under their points, thinned so the axis stays
  // clean for any block count.
  const step = Math.max(1, Math.round(n / 5));
  const hh = m => String(Math.floor(m / 60)).padStart(2, '0');
  const labels = curve.map((c, i) => (i % step === 0)
    ? `<text x="${PX[i]}" y="${H - 6}" text-anchor="middle" font-size="9" fill="var(--text-muted)" font-family="'DM Mono',monospace">${hh(c.startMin)}–${hh(c.endMin)}</text>` : '').join('');

  // Target band drawn first (behind everything), kept subtle.
  let bandSvg = '';
  if (band) {
    const yHi = y(band.hi), yLo = y(band.lo);
    const top = Math.min(yHi, yLo), h = Math.max(1, Math.abs(yLo - yHi));
    bandSvg = `<rect x="${padL}" y="${top}" width="${innerW}" height="${h}" fill="${color}" opacity="0.10"/>
      <line x1="${padL}" y1="${yHi}" x2="${W - padR}" y2="${yHi}" stroke="${color}" stroke-width="1" opacity="0.3"/>`;
  }

  // Selected-block COLUMN highlight (behind the line); coords set on tap.
  const colHl = `<rect id="stim-blk-hl" class="stim-blk-hl" x="0" y="${padT}" width="0" height="${innerH}" fill="${color}" style="opacity:0"/>`;

  // Whole-block vertical hit columns, drawn LAST so they sit on top. Tapping
  // anywhere in a block's column selects THAT block — large and unambiguous on
  // mobile. data-px/data-py carry the block's point so the popup anchors to the
  // peak it describes.
  let hits = '';
  for (let i = 0; i < curve.length; i++) {
    const hx = xT(curve[i].startMin);
    const hw = Math.max(1, xT(curve[i].endMin) - hx);
    hits += `<rect class="stim-blk-hit" data-block="${i}" data-px="${PX[i]}" data-py="${PY[i]}" x="${hx}" y="${padT}" width="${hw}" height="${innerH}" fill="transparent"/>`;
  }

  // Selected-POINT marker (on top); coords set on tap.
  const ptHl = `<circle id="stim-seg-hl" class="stim-seg-hl" cx="0" cy="0" r="0" fill="${color}" style="opacity:0"/>`;

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block">
    ${bandSvg}
    ${colHl}
    <line x1="${padL}" y1="${zeroY}" x2="${W - padR}" y2="${zeroY}" stroke="var(--border-subtle)" stroke-width="1"/>
    <line x1="${padL}" y1="${baseY}" x2="${W - padR}" y2="${baseY}" stroke="var(--text-muted)" stroke-width="1.5" stroke-dasharray="4 4"/>
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}
    ${ptHl}
    ${labels}
    ${hits}
  </svg>`;
}

// Compact driver lines for ONE block (the tapped block only — never two).
// Metric-positive activities first (top 3), then up to 2 recovery items.
const srcTag = src => src === 'habit_link' ? '<span class="stim-pop-src">habit</span>'
  : src === 'screen_time_import' ? '<span class="stim-pop-src">imported</span>' : '';
const popRow = (name, mins, val, tag, src) =>
  `<div class="stim-pop-driver"><span class="stim-pop-dn">${esc(name)}${srcTag(src)}</span><span class="stim-pop-dv">${mins} min · ${signed(val)}${tag ? ' ' + tag : ''}</span></div>`;

// Productive popup: top productive drivers (and recovery as context).
function driversCompact(date, idx, metric) {
  const ds = blockDrivers(date, idx);
  const main = ds.filter(d => d[metric] > 1e-9).sort((a, b) => b[metric] - a[metric]).slice(0, 3);
  const rec = ds.filter(d => d.recovery < -1e-9).sort((a, b) => a.recovery - b.recovery).slice(0, 2);
  if (!main.length && !rec.length) return `<div class="stim-pop-none">No productive drivers</div>`;
  return main.map(d => popRow(d.name, d.minutes, d[metric], '', d.source)).join('')
    + rec.map(d => popRow(d.name, d.minutes, d.recovery, 'rec', d.source)).join('');
}

// Cheap popup: the block's gross cheap drivers + any recovery in the block, then
// the block's cheap value (gross — recovery is NOT subtracted per block). If this
// block has recovery, it also shows the day's recovery credit and explains that
// recovery lowers the DAILY load even when the block itself is at 0.
function cheapBreakdown(date, idx) {
  const ds = blockDrivers(date, idx);
  const gross = ds.filter(d => d.cheap > 1e-9).sort((a, b) => b.cheap - a.cheap).slice(0, 3);
  const rec = ds.filter(d => d.recovery < -1e-9).sort((a, b) => a.recovery - b.recovery).slice(0, 3);
  const blockCheap = blockMetric(date, idx, 'cheap'); // gross for this block
  let html = `<div class="stim-pop-section">Gross cheap stim</div>`;
  html += gross.length ? gross.map(d => popRow(d.name, d.minutes, d.cheap, '', d.source)).join('') : `<div class="stim-pop-none">None</div>`;
  if (rec.length) {
    html += `<div class="stim-pop-section">Recovery</div>`;
    html += rec.map(d => popRow(d.name, d.minutes, d.recovery, 'rec', d.source)).join('');
  }
  html += `<div class="stim-pop-net">Block cheap stim<span>${r1(blockCheap)}</span></div>`;
  if (rec.length) {
    html += `<div class="stim-pop-credit">Daily recovery credit <span>${signed(-dailyRecoveryCredit(date))}</span></div>`;
    html += `<div class="stim-pop-recnote">Recovery lowers your daily load even when this block is already at 0.</div>`;
  }
  return html;
}

function hidePopup() {
  const pop = document.getElementById('stim-seg-pop');
  if (pop) { pop.hidden = true; pop.innerHTML = ''; }
  const pt = document.getElementById('stim-seg-hl');
  if (pt) { pt.setAttribute('r', '0'); pt.style.opacity = '0'; pt.style.filter = 'none'; }
  const col = document.getElementById('stim-blk-hl');
  if (col) { col.setAttribute('width', '0'); col.style.opacity = '0'; }
}

// Floating tooltip over the chart for ONE block. It describes only that block,
// labelled by its full time range, anchored at the block's own point (the peak)
// and clamped inside the plot. Highlights the block's column + its point so the
// visible selection always matches the tooltip's time range. Reads the tapped
// column's data-px/data-py/x/width (viewBox coords) — no chart math duplicated.
function showPopup(hitEl) {
  if (!_ctx) return;
  const pop = document.getElementById('stim-seg-pop');
  const pt = document.getElementById('stim-seg-hl');
  const col = document.getElementById('stim-blk-hl');
  if (!pop || !pt || !col) return;

  const i = parseInt(hitEl.dataset.block, 10);
  const { curve, metric, color, shortName, date } = _ctx;
  const B = curve[i];
  if (!B) return;

  const px = parseFloat(hitEl.dataset.px), py = parseFloat(hitEl.dataset.py);
  const hx = parseFloat(hitEl.getAttribute('x')), hw = parseFloat(hitEl.getAttribute('width'));

  // Highlight the block's column (behind the line) + its point (on top, glowing).
  col.setAttribute('x', hx); col.setAttribute('width', hw);
  col.setAttribute('fill', color); col.style.opacity = '0.12';
  pt.setAttribute('cx', px); pt.setAttribute('cy', py);
  pt.setAttribute('fill', color); pt.setAttribute('r', '5');
  pt.style.opacity = '1'; pt.style.filter = `drop-shadow(0 0 3px ${color})`;

  const body = metric === 'cheap' ? cheapBreakdown(date, B.index) : driversCompact(date, B.index, metric);
  pop.innerHTML = `
    <button class="stim-pop-close" id="stim-seg-close" aria-label="Close">✕</button>
    <div class="stim-pop-range">${esc(B.label)}</div>
    <div class="stim-pop-metric" style="color:${color}">${shortName} ${r1(B.load)}</div>
    ${body}`;
  pop.hidden = false;

  // Anchor at the block's point; clamp horizontally, flip below if the point sits
  // high in the plot so the tooltip never leaves the top.
  pop.style.marginLeft = '';
  pop.style.left = Math.min(82, Math.max(18, (px / CHART_W) * 100)) + '%';
  pop.style.top = ((py / CHART_H) * 100) + '%';
  pop.dataset.place = (py / CHART_H) < 0.42 ? 'below' : 'above';

  // After layout, nudge horizontally so the tooltip never spills off-screen.
  requestAnimationFrame(() => {
    if (pop.hidden) return;
    const m = 6, br = pop.getBoundingClientRect();
    let shift = 0;
    if (br.left < m) shift = m - br.left;
    else if (br.right > window.innerWidth - m) shift = (window.innerWidth - m) - br.right;
    if (shift) pop.style.marginLeft = shift + 'px';
  });
}

function selectBlock(hitEl) {
  const i = parseInt(hitEl.dataset.block, 10);
  if (_selectedBlock === i) { _selectedBlock = null; hidePopup(); return; } // tap same → close
  _selectedBlock = i;
  showPopup(hitEl);
}

// Delegated tap handling, bound once per panel element (survives innerHTML
// rewrites; re-binds if the mode controller rebuilds the panel). Handles:
// block tap → select/toggle, ✕ → close, tap outside chart/popup → close.
function bindSegmentTaps(panel) {
  if (panel.dataset.stimSegBound) return;
  panel.dataset.stimSegBound = '1';
  panel.addEventListener('click', (e) => {
    const hit = e.target.closest('[data-block]');
    if (hit) { selectBlock(hit); return; }
    if (e.target.closest('#stim-seg-close')) { _selectedBlock = null; hidePopup(); return; }
    if (_selectedBlock !== null && !e.target.closest('#stim-seg-pop') && !e.target.closest('.stim-chart-plot')) {
      _selectedBlock = null; hidePopup();
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

  // A full re-render resets the chart-block selection (view/data/date change).
  _selectedBlock = null;
  _ctx = null;

  bindSegmentTaps(panel);

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
        <div class="mh-empty" style="padding:16px 8px;">No activities logged today yet.<br>Log your day to see your stimulation curves vs your baseline and target range.</div>
        <button class="btn btn-primary" id="stim-log-btn" style="width:100%;">Log today</button>
      </div>`;
    attach();
    return;
  }

  const curve = metricCurve(date, cfg.metric);
  // Data the segment popup needs (so a tap doesn't recompute the chart).
  _ctx = { date, metric: cfg.metric, shortName: cfg.shortName, color: cfg.color, curve };
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
  const grossCheap = dailyGrossCheap(date);
  const recCredit = dailyRecoveryCredit(date); // ≥ 0 magnitude

  // Summary (factual; no advice/diagnosis): today vs target, then vs baseline.
  let summary;
  if (Math.abs(todayLoad) < 1e-9) {
    summary = (view === 'cheap' && dailyGrossCheap(date) > 1e-9)
      ? 'Your cheap stim today was fully offset by recovery activities.'
      : cfg.emptyLine;
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
    // Cheap-only: when recovery meaningfully lowered the day, say so explicitly.
    let recoveryClause = '';
    if (view === 'cheap' && recCredit > 1e-9 && grossCheap - todayLoad > 0.05) {
      recoveryClause = ` Recovery credit of ${r1(recCredit)} lowered today's load from ${r1(grossCheap)} gross to ${r1(todayLoad)}.`;
    }
    summary = tSentence + baseClause + baseTargetClause + recoveryClause;
  }

  panel.innerHTML = header + seg + `
    <div class="card stim-chart-card">
      <div class="stim-chart-plot">
        ${chartSvg(curve, basePerBlock, cfg.color, bandPerBlock)}
        <div id="stim-seg-pop" class="stim-seg-pop" hidden></div>
      </div>
      <div class="stim-legend">
        <span><span class="stim-key" style="border-top-color:${cfg.color}"></span>${cfg.legendToday}</span>
        <span><span class="stim-key stim-key-base"></span>Baseline</span>
        <span><span class="stim-key-band" style="background:${cfg.color}"></span>Target</span>
      </div>
    </div>

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
      ${view === 'cheap' ? `
        <div class="stim-sub"><span class="stim-sub-label">Gross cheap</span><span class="stim-sub-num">${r1(grossCheap)}</span></div>
        <div class="stim-sub"><span class="stim-sub-label">Recovery credit</span><span class="stim-sub-num">${recCredit > 1e-9 ? '−' + r1(recCredit) : '0'}</span></div>
        <div class="stim-sub"><span class="stim-sub-label">Productive</span><span class="stim-sub-num">${r1(otherVal)}</span></div>
      ` : `
        <div class="stim-sub"><span class="stim-sub-label">${otherLabel}</span><span class="stim-sub-num">${r1(otherVal)}</span></div>
        <div class="stim-sub"><span class="stim-sub-label">Recovery Effect</span><span class="stim-sub-num">${r1(recovery)}</span></div>
      `}
    </div>

    <div class="card mh-summary-card">${summary}</div>

    <button class="btn btn-primary" id="stim-log-btn" style="width:100%;">Log / edit today</button>
  `;
  attach();
}
