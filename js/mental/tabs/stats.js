import { DAY_FULL } from '../../constants.js';
import {
  recentCheckins, metricSeries, tagCounts, taskCompletion,
  weekdayMood, sleepVsMood, patternSummary,
} from '../store.js';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function miniBars(series, color) {
  const W = 280, H = 56, n = series.length;
  const bw = Math.max(3, Math.floor(W / n) - 3);
  let bars = '';
  series.forEach((pt, i) => {
    const x = i * (W / n);
    if (pt.value == null) { bars += `<rect x="${x}" y="${H - 3}" width="${bw}" height="3" rx="1.5" fill="var(--border)"/>`; return; }
    const h = Math.max(3, (pt.value / 5) * (H - 6));
    bars += `<rect x="${x}" y="${H - h}" width="${bw}" height="${h}" rx="2" fill="${color}"/>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block">${bars}</svg>`;
}

function trendCard(label, metric, color) {
  return `
    <div class="chart-card">
      <div class="chart-title">${label} · last 14 days</div>
      ${miniBars(metricSeries(metric, 14), color)}
    </div>`;
}

const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

export function renderMentalStats() {
  const panel = document.getElementById('tab-stats');
  if (!panel) return;

  const filled = recentCheckins(14).filter(c => c.has).length;
  if (filled < 2) {
    panel.innerHTML = `
      <div class="mh-header"><div class="mh-title">Stats</div><div class="mh-subtitle">Patterns from your check-ins</div></div>
      <div class="mh-empty">Not enough data yet. Check in for a couple of days to see patterns.</div>`;
    return;
  }

  // Recent-change summary (factual)
  const summary = patternSummary(3);
  const summaryText = summary.length ? `Last 3 days: ${summary.join(', ')}.` : 'Last 3 days: no clear change.';

  // Sleep vs mood
  const pairs = sleepVsMood(28);
  const good = avg(pairs.filter(p => p.sleep >= 4).map(p => p.mood));
  const poor = avg(pairs.filter(p => p.sleep <= 2).map(p => p.mood));
  let sleepLine = 'Not enough paired sleep/mood data yet.';
  if (good != null && poor != null) sleepLine = `Mood averages ${good.toFixed(1)}/5 after better sleep vs ${poor.toFixed(1)}/5 after poor sleep.`;
  else if (good != null) sleepLine = `Mood averages ${good.toFixed(1)}/5 on better-sleep days.`;

  // Tags
  const tags = tagCounts(14).slice(0, 6);
  const tagsHtml = tags.length
    ? `<div class="mh-tag-row">${tags.map(t => `<span class="mh-tag selected">${esc(t.tag)} · ${t.count}</span>`).join('')}</div>`
    : `<div class="mh-empty" style="text-align:left;">No tags logged yet.</div>`;

  // Tasks
  const tc = taskCompletion(14);
  const tcPct = tc.total ? Math.round((tc.done / tc.total) * 100) : 0;

  // Best / worst weekday
  const wd = weekdayMood(28).filter(d => d.avg != null);
  let wdLine = 'Not enough data for weekday patterns.';
  if (wd.length >= 2) {
    const best = wd.reduce((a, b) => (a.avg >= b.avg ? a : b));
    const worst = wd.reduce((a, b) => (a.avg <= b.avg ? a : b));
    wdLine = `Best: ${DAY_FULL[best.dow]} (${best.avg.toFixed(1)}/5) · Lowest: ${DAY_FULL[worst.dow]} (${worst.avg.toFixed(1)}/5)`;
  }

  panel.innerHTML = `
    <div class="mh-header"><div class="mh-title">Stats</div><div class="mh-subtitle">Patterns from your check-ins</div></div>

    <div class="card mh-summary-card">${summaryText}</div>

    ${trendCard('Mood', 'mood', 'var(--accent)')}
    ${trendCard('Stress', 'stress', 'var(--warning)')}
    ${trendCard('Energy', 'energy', 'var(--purple)')}

    <div class="chart-card">
      <div class="chart-title">Sleep vs mood</div>
      <div class="mh-stat-line">${sleepLine}</div>
    </div>

    <div class="chart-card">
      <div class="chart-title">Most common tags · last 14 days</div>
      ${tagsHtml}
    </div>

    <div class="chart-card">
      <div class="chart-title">Task completion · last 14 days</div>
      <div class="mh-stat-line">${tc.done}/${tc.total} done${tc.total ? ` · ${tcPct}%` : ''}</div>
    </div>

    <div class="chart-card">
      <div class="chart-title">Weekday mood · last 4 weeks</div>
      <div class="mh-stat-line">${wdLine}</div>
    </div>`;
}
