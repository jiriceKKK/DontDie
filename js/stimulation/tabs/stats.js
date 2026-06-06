import {
  dailyLoadSeries, topActivities, blockAverages, highVsRecovery,
  stimMoodCrossover,
} from '../store.js';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const r1 = n => Math.round(n * 10) / 10;
const sign = n => (n > 0 ? `+${r1(n)}` : `${r1(n)}`);

// Signed daily-load bars around a zero line (amber up = stim, blue down = recovery).
function loadBars(series) {
  const W = 300, H = 84, n = Math.max(series.length, 1);
  const bw = Math.max(4, Math.floor(W / n) - 3);
  const maxAbs = Math.max(1, ...series.map(s => Math.abs(s.load)));
  const zeroY = H / 2;
  let bars = '';
  series.forEach((s, i) => {
    const x = i * (W / n);
    if (!s.has) { bars += `<rect x="${x}" y="${zeroY - 1}" width="${bw}" height="2" fill="var(--border)"/>`; return; }
    const h = Math.max(2, (Math.abs(s.load) / maxAbs) * (H / 2 - 2));
    const y = s.load >= 0 ? zeroY - h : zeroY;
    bars += `<rect x="${x}" y="${y}" width="${bw}" height="${h}" rx="2" fill="${s.load >= 0 ? 'var(--accent)' : 'var(--blue)'}"/>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block"><line x1="0" y1="${zeroY}" x2="${W}" y2="${zeroY}" stroke="var(--border-subtle)"/>${bars}</svg>`;
}

export function renderStimStats() {
  const panel = document.getElementById('tab-stats');
  if (!panel) return;
  const header = `<div class="mh-header"><div class="mh-title">Stats</div><div class="mh-subtitle">Estimated stimulation patterns</div></div>`;

  const series = dailyLoadSeries(14);
  const loggedDays = series.filter(s => s.has).length;
  if (loggedDays === 0) {
    panel.innerHTML = header + `<div class="mh-empty">No stimulation logged yet. Use the Log page to record a day.</div>`;
    return;
  }

  const top = topActivities(14).slice(0, 6);
  const blocks = blockAverages(14).sort((a, b) => b.avg - a.avg);
  const hi = highVsRecovery(14);
  const cross = stimMoodCrossover(14);

  const topHtml = top.length
    ? `<div class="stim-toplist">${top.map(t => `<div class="stim-toprow"><span class="stim-act-name">${esc(t.name)}</span><span class="stim-act-meta">${sign(t.load)} · ${t.minutes}m</span></div>`).join('')}</div>`
    : `<div class="mh-empty" style="text-align:left;">No activities logged.</div>`;

  const blocksHtml = blocks.length
    ? `<div class="stim-toplist">${blocks.slice(0, 3).map(b => `<div class="stim-toprow"><span class="stim-act-name">${b.label}</span><span class="stim-act-meta">${sign(b.avg)}</span></div>`).join('')}</div>`
    : '';

  let crossHtml = '';
  if (cross.hiCount && cross.loCount) {
    crossHtml = `<div class="chart-card"><div class="chart-title">Stimulation vs mood</div>
      <div class="mh-stat-line">On logged days above baseline, average mood was <strong>${r1(cross.hiAvg)}/5</strong> vs <strong>${r1(cross.loAvg)}/5</strong> on lower-stim days.</div></div>`;
  }

  panel.innerHTML = header + `
    <div class="chart-card">
      <div class="chart-title">Daily load · last 14 days</div>
      ${loadBars(series)}
      <div class="volume-legend" style="text-align:left;margin-top:6px;"><span style="color:var(--accent)">up</span> = stimulation · <span style="color:var(--blue)">down</span> = recovery</div>
    </div>

    <div class="chart-card">
      <div class="chart-title">High-stim vs recovery · last 14 days</div>
      <div class="mh-stat-line">High-stim total: <strong>${r1(hi.high)}</strong> · recovery total: <strong>${r1(hi.recovery)}</strong></div>
    </div>

    <div class="chart-card"><div class="chart-title">Top activities · last 14 days</div>${topHtml}</div>
    ${blocks.length ? `<div class="chart-card"><div class="chart-title">Highest-stim time blocks</div>${blocksHtml}</div>` : ''}
    ${crossHtml}
  `;
}
