import {
  dailyMetricSeries, topActivitiesByMetric, stimMoodCrossover,
} from '../store.js';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const r1 = n => Math.round(n * 10) / 10;

// Upward bars for one non-negative metric series. Missing days = faint stub.
function metricBars(series, color) {
  const W = 300, H = 72, n = Math.max(series.length, 1);
  const bw = Math.max(4, Math.floor(W / n) - 3);
  const maxV = Math.max(1, ...series.map(s => Math.abs(s.load)));
  const baseY = H - 2;
  let bars = '';
  series.forEach((s, i) => {
    const x = i * (W / n);
    if (!s.has) { bars += `<rect x="${x}" y="${baseY - 1}" width="${bw}" height="2" fill="var(--border)"/>`; return; }
    const h = Math.max(2, (Math.abs(s.load) / maxV) * (H - 6));
    bars += `<rect x="${x}" y="${baseY - h}" width="${bw}" height="${h}" rx="2" fill="${color}"/>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block"><line x1="0" y1="${baseY}" x2="${W}" y2="${baseY}" stroke="var(--border-subtle)"/>${bars}</svg>`;
}

function topList(rows) {
  if (!rows.length) return `<div class="mh-empty" style="text-align:left;">None logged in this window.</div>`;
  return `<div class="stim-toplist">${rows.map(t =>
    `<div class="stim-toprow"><span class="stim-act-name">${esc(t.name)}</span><span class="stim-act-meta">${r1(t.load)} · ${t.minutes}m</span></div>`).join('')}</div>`;
}

export function renderStimStats() {
  const panel = document.getElementById('tab-stats');
  if (!panel) return;
  const header = `<div class="mh-header"><div class="mh-title">Stats</div><div class="mh-subtitle">Cheap stim vs productive activation</div></div>`;

  const cheapSeries = dailyMetricSeries(14, 'cheap');
  const prodSeries = dailyMetricSeries(14, 'productive');
  const loggedDays = cheapSeries.filter(s => s.has).length;
  if (loggedDays === 0) {
    panel.innerHTML = header + `<div class="mh-empty">No stimulation logged yet. Use the Log page to record a day.</div>`;
    return;
  }

  const topCheap = topActivitiesByMetric(14, 'cheap').slice(0, 6);
  const topProd = topActivitiesByMetric(14, 'productive').slice(0, 6);
  const cross = stimMoodCrossover(14);

  let crossHtml = '';
  if (cross.hiCount && cross.loCount) {
    crossHtml = `<div class="chart-card"><div class="chart-title">Cheap stim vs mood</div>
      <div class="mh-stat-line">On logged days above your cheap-stim baseline, average mood was <strong>${r1(cross.hiAvg)}/5</strong> vs <strong>${r1(cross.loAvg)}/5</strong> on lower cheap-stim days.</div></div>`;
  }

  panel.innerHTML = header + `
    <div class="chart-card">
      <div class="chart-title" style="color:var(--accent)">Cheap stim · last 14 days</div>
      ${metricBars(cheapSeries, 'var(--accent)')}
    </div>

    <div class="chart-card">
      <div class="chart-title" style="color:var(--stim-productive)">Productive activation · last 14 days</div>
      ${metricBars(prodSeries, 'var(--stim-productive)')}
    </div>

    <div class="chart-card"><div class="chart-title">Top cheap-stim activities</div>${topList(topCheap)}</div>
    <div class="chart-card"><div class="chart-title">Top productive activities</div>${topList(topProd)}</div>
    ${crossHtml}
  `;
}
