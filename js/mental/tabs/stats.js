import { DAY_FULL } from '../../constants.js';
import {
  recentCheckins, metricSeries, tagCounts, taskCompletion, tasksByDay, taskMoodSplit,
  weekdayMood, sleepVsMood, patternSummary,
} from '../store.js';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

// Simple value bars (1–5 metrics). Missing days render as a faint baseline tick.
function miniBars(series, color) {
  const W = 280, H = 56, n = Math.max(series.length, 1);
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

// Per-day task bars: full bar = planned, filled portion = done.
function taskBars(series) {
  const W = 280, H = 56, n = Math.max(series.length, 1);
  const bw = Math.max(4, Math.floor(W / n) - 3);
  const maxTotal = Math.max(1, ...series.map(d => d.total));
  let bars = '';
  series.forEach((d, i) => {
    const x = i * (W / n);
    if (d.total === 0) { bars += `<rect x="${x}" y="${H - 3}" width="${bw}" height="3" rx="1.5" fill="var(--border)"/>`; return; }
    const totalH = Math.max(4, (d.total / maxTotal) * (H - 4));
    const doneH = (d.done / d.total) * totalH;
    bars += `<rect x="${x}" y="${H - totalH}" width="${bw}" height="${totalH}" rx="2" fill="var(--bg-elevated)"/>`;
    if (doneH > 0) bars += `<rect x="${x}" y="${H - doneH}" width="${bw}" height="${doneH}" rx="2" fill="var(--accent)"/>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block">${bars}</svg>`;
}

function trendCard(label, metric, color) {
  return `<div class="chart-card"><div class="chart-title">${label} · last 14 days</div>${miniBars(metricSeries(metric, 14), color)}</div>`;
}

export function renderMentalStats() {
  const panel = document.getElementById('tab-stats');
  if (!panel) return;

  const header = `<div class="mh-header"><div class="mh-title">Stats</div><div class="mh-subtitle">Patterns from your data</div></div>`;
  const checkins = recentCheckins(14).filter(c => c.has).length;

  // ---- Task completion (works even with no check-ins) ----
  const tc7 = taskCompletion(7);
  const tcPct7 = tc7.total ? Math.round((tc7.done / tc7.total) * 100) : 0;
  const byDay = tasksByDay(14);
  const anyTasks = byDay.some(d => d.total > 0);
  const taskSection = `
    <div class="chart-card">
      <div class="chart-title">Task completion · last 14 days</div>
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
    panel.innerHTML = header + taskSection + taskMoodSection +
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
    trendCard('Mood', 'mood', 'var(--accent)') +
    trendCard('Stress', 'stress', 'var(--warning)') +
    trendCard('Energy', 'energy', 'var(--purple)') +
    taskSection +
    taskMoodSection +
    `<div class="chart-card"><div class="chart-title">Sleep vs mood</div><div class="mh-stat-line">${sleepLine}</div></div>` +
    `<div class="chart-card"><div class="chart-title">Most common tags · last 14 days</div>${tagsHtml}</div>` +
    `<div class="chart-card"><div class="chart-title">Weekday mood · last 4 weeks</div><div class="mh-stat-line">${wdLine}</div></div>`;
}
