import { DAY_FULL } from '../../constants.js';
import {
  recentCheckins, metricSeries, tagCounts, taskCompletion, tasksByDay, taskMoodSplit,
  weekdayMood, sleepVsMood, patternSummary,
} from '../store.js';
import { barDayLabels } from '../../ui/chartLabels.js';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

// Simple value bars (1–5 metrics) with weekday + date labels. Missing days
// render as a faint baseline tick.
function miniBars(series, color) {
  const W = 280, H = 74, labelH = 18, n = Math.max(series.length, 1);
  const bottom = H - labelH;
  const bw = Math.max(3, Math.floor(W / n) - 3);
  let bars = '';
  series.forEach((pt, i) => {
    const x = i * (W / n);
    if (pt.value == null) { bars += `<rect x="${x}" y="${bottom - 3}" width="${bw}" height="3" rx="1.5" fill="var(--border)"/>`; return; }
    const h = Math.max(3, (pt.value / 5) * (bottom - 6));
    bars += `<rect x="${x}" y="${bottom - h}" width="${bw}" height="${h}" rx="2" fill="${color}"/>`;
  });
  const labels = barDayLabels(series.map(s => s.date), { W, n, y: bottom + 11 });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block">${bars}${labels}</svg>`;
}

// Per-day task bars: full bar = planned, filled portion = done. With labels.
function taskBars(series) {
  const W = 280, H = 74, labelH = 18, n = Math.max(series.length, 1);
  const bottom = H - labelH;
  const bw = Math.max(4, Math.floor(W / n) - 3);
  const maxTotal = Math.max(1, ...series.map(d => d.total));
  let bars = '';
  series.forEach((d, i) => {
    const x = i * (W / n);
    if (d.total === 0) { bars += `<rect x="${x}" y="${bottom - 3}" width="${bw}" height="3" rx="1.5" fill="var(--border)"/>`; return; }
    const totalH = Math.max(4, (d.total / maxTotal) * (bottom - 4));
    const doneH = (d.done / d.total) * totalH;
    bars += `<rect x="${x}" y="${bottom - totalH}" width="${bw}" height="${totalH}" rx="2" fill="var(--bg-elevated)"/>`;
    if (doneH > 0) bars += `<rect x="${x}" y="${bottom - doneH}" width="${bw}" height="${doneH}" rx="2" fill="var(--accent)"/>`;
  });
  const labels = barDayLabels(series.map(s => s.date), { W, n, y: bottom + 11 });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block">${bars}${labels}</svg>`;
}

// good / neutral / warning trend chip from a 1–5 metric series (recent vs older).
function metricTrendChip(metric, lowerBetter) {
  const vals = metricSeries(metric, 14).filter(p => p.value != null).map(p => p.value);
  if (vals.length < 4) return '<span class="stat-chip muted">need data</span>';
  const half = Math.floor(vals.length / 2);
  const older = avg(vals.slice(0, half)), newer = avg(vals.slice(half));
  if (older == null || newer == null) return '';
  const diff = newer - older;
  if (Math.abs(diff) < 0.4) return '<span class="stat-chip">steady</span>';
  const up = diff > 0, good = lowerBetter ? !up : up;
  return `<span class="stat-chip ${good ? 'good' : 'warn'}">${up ? '▲' : '▼'} ${avg([newer]).toFixed(1)}</span>`;
}

function trendCard(label, metric, color, lowerBetter) {
  return `<div class="chart-card"><div class="chart-title-row"><div class="chart-title">${label} · last 14 days</div>${metricTrendChip(metric, lowerBetter)}</div>${miniBars(metricSeries(metric, 14), color)}</div>`;
}

export function renderMentalStats() {
  const panel = document.getElementById('tab-stats');
  if (!panel) return;

  const header = `<div class="mh-header"><div class="mh-title">Stats</div><div class="mh-subtitle">Patterns from your data</div></div>`;
  const all14 = recentCheckins(14);
  const checkins = all14.filter(c => c.has).length;

  // ---- Check-in consistency + data quality (always shown) ----
  const consPct = Math.round((checkins / 14) * 100);
  const consChip = checkins >= 10 ? '<span class="stat-chip good">consistent</span>'
    : checkins >= 5 ? '<span class="stat-chip">building</span>'
    : '<span class="stat-chip warn">sparse</span>';
  const dq = checkins < 5 ? `<div class="stat-note warn">Only ${checkins}/14 days logged — mood patterns below are weak. A daily check-in sharpens them.</div>` : '';
  const consSection = `
    <div class="chart-card">
      <div class="chart-title-row"><div class="chart-title">Check-in consistency · 14 days</div>${consChip}</div>
      <div class="stat-bar"><div class="stat-bar-fill" style="width:${consPct}%;background:${checkins >= 10 ? '#34d399' : checkins >= 5 ? 'var(--accent)' : 'var(--warning)'}"></div></div>
      <div class="chart-foot">${checkins}/14 days checked in</div>
      ${dq}
    </div>`;

  // ---- Task completion (works even with no check-ins) ----
  const tc7 = taskCompletion(7);
  const tcPct7 = tc7.total ? Math.round((tc7.done / tc7.total) * 100) : 0;
  const taskChip = !tc7.total ? '' : tcPct7 >= 70 ? '<span class="stat-chip good">on top</span>' : tcPct7 >= 40 ? '<span class="stat-chip">partial</span>' : '<span class="stat-chip warn">low</span>';
  const byDay = tasksByDay(14);
  const anyTasks = byDay.some(d => d.total > 0);
  const taskSection = `
    <div class="chart-card">
      <div class="chart-title-row"><div class="chart-title">Task completion · last 14 days</div>${taskChip}</div>
      ${anyTasks ? `
        ${taskBars(byDay)}
        <div class="mh-stat-line" style="margin-top:10px;">This week: <strong>${tc7.done}/${tc7.total}</strong>${tc7.total ? ` · ${tcPct7}%` : ''}</div>
        <div class="volume-legend" style="text-align:left;margin-top:4px;">Bar height = planned · <span style="color:var(--accent)">filled</span> = done</div>
      ` : `<div class="mh-empty" style="text-align:left;padding:8px 0;">No tasks logged in this period.</div>`}
    </div>`;

  // ---- Tasks vs mood (only if enough paired data) ----
  const split = taskMoodSplit(14);
  let taskMoodSection = '';
  if (split.doneCount && split.unfCount) {
    taskMoodSection = `
      <div class="chart-card">
        <div class="chart-title">Tasks vs mood</div>
        <div class="mh-stat-line">Days with all tasks done: avg mood <strong>${split.doneAvg.toFixed(1)}/5</strong> · days with unfinished tasks: <strong>${split.unfAvg.toFixed(1)}/5</strong></div>
      </div>`;
  }

  // ---- Check-in dependent sections ----
  if (checkins < 2) {
    panel.innerHTML = header + consSection + taskSection + taskMoodSection +
      `<div class="mh-empty">Not enough check-in data yet. Check in for a couple of days to see mood patterns.</div>`;
    return;
  }

  const summary = patternSummary(3);
  const summaryText = summary.length ? `Last 3 days: ${summary.join(', ')}.` : 'Last 3 days: no clear change.';

  const pairs = sleepVsMood(28);
  const good = avg(pairs.filter(p => p.sleep >= 4).map(p => p.mood));
  const poor = avg(pairs.filter(p => p.sleep <= 2).map(p => p.mood));
  let sleepLine = 'Not enough paired sleep/mood data yet.';
  if (good != null && poor != null) sleepLine = `Mood averages ${good.toFixed(1)}/5 after better sleep vs ${poor.toFixed(1)}/5 after poor sleep.`;
  else if (good != null) sleepLine = `Mood averages ${good.toFixed(1)}/5 on better-sleep days.`;

  // ---- Sleep score vs energy (uses the 1–100 sleepScore when present) ----
  const sePairs = all14.filter(c => c.has && typeof c.energy === 'number' && (typeof c.sleepScore === 'number' || typeof c.sleep === 'number'))
    .map(c => ({ s: typeof c.sleepScore === 'number' ? c.sleepScore : c.sleep * 20, e: c.energy }));
  let sleepEnergyLine = 'Add a sleep score on your check-ins to compare it with energy.';
  if (sePairs.length >= 3) {
    const hiE = avg(sePairs.filter(p => p.s >= 70).map(p => p.e));
    const loE = avg(sePairs.filter(p => p.s < 70).map(p => p.e));
    if (hiE != null && loE != null) sleepEnergyLine = `Energy averages ${hiE.toFixed(1)}/5 after sleep ≥70 vs ${loE.toFixed(1)}/5 below 70.`;
    else if (hiE != null) sleepEnergyLine = `Energy averages ${hiE.toFixed(1)}/5 on good-sleep days.`;
    else sleepEnergyLine = 'Not enough varied sleep data yet to compare with energy.';
  }

  const tags = tagCounts(14).slice(0, 6);
  const tagsHtml = tags.length
    ? `<div class="mh-tag-row">${tags.map(t => `<span class="mh-tag selected">${esc(t.tag)} · ${t.count}</span>`).join('')}</div>`
    : `<div class="mh-empty" style="text-align:left;">No tags logged yet.</div>`;

  const wd = weekdayMood(28).filter(d => d.avg != null);
  let wdLine = 'Not enough data for weekday patterns.';
  if (wd.length >= 2) {
    const best = wd.reduce((a, b) => (a.avg >= b.avg ? a : b));
    const worst = wd.reduce((a, b) => (a.avg <= b.avg ? a : b));
    wdLine = `Best: ${DAY_FULL[best.dow]} (${best.avg.toFixed(1)}/5) · Lowest: ${DAY_FULL[worst.dow]} (${worst.avg.toFixed(1)}/5)`;
  }

  panel.innerHTML = header +
    `<div class="card mh-summary-card">${summaryText}</div>` +
    consSection +
    trendCard('Mood', 'mood', 'var(--accent)', false) +
    trendCard('Stress', 'stress', 'var(--warning)', true) +
    trendCard('Energy', 'energy', 'var(--purple)', false) +
    taskSection +
    taskMoodSection +
    `<div class="chart-card"><div class="chart-title">Sleep vs mood</div><div class="mh-stat-line">${sleepLine}</div></div>` +
    `<div class="chart-card"><div class="chart-title">Sleep vs energy</div><div class="mh-stat-line">${sleepEnergyLine}</div></div>` +
    `<div class="chart-card"><div class="chart-title">Most common tags · last 14 days</div>${tagsHtml}</div>` +
    `<div class="chart-card"><div class="chart-title">Weekday mood · last 4 weeks</div><div class="mh-stat-line">${wdLine}</div></div>`;
}
