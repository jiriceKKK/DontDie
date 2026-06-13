// ============================================================
// HOME · REVIEW — a data-based weekly review. Read-only: it summarizes the last
// 7 days from existing store APIs and generates SPECIFIC, data-driven reflection
// questions (only when the data supports them). No AI calls, no calc changes.
// ============================================================

import { formatDate, today, addDays } from '../utils/date.js';
import { MONTH_NAMES } from '../constants.js';
import { getDayStats } from '../habits.js';
import { recentCheckins, taskCompletion, patternSummary, getTasks } from '../mental/store.js';
import { dailyMetric, hasAnyEntries, baselineMetricDaily, metricTarget } from '../stimulation/store.js';
import { getSessions, missedSessions, getTests, decorateTest } from '../school/store.js';
import { goTo } from '../modes/go.js';

const r1 = n => Math.round(n * 10) / 10;
const pct = n => `${Math.round(n)}%`;
const safe = (fn, d) => { try { const v = fn(); return v == null ? d : v; } catch { return d; } };
const mean = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
const median = arr => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// Habit completion % over a 7-day window starting `offset` days ago.
function habitWindowPct(offset) {
  let sched = 0, comp = 0;
  for (let i = offset; i < offset + 7; i++) {
    const { total, completed } = getDayStats(addDays(today(), -i));
    sched += total; comp += completed;
  }
  return sched ? (comp / sched) * 100 : null;
}

// Per-day model for the last 7 days, joining habits + stim + tasks.
function days7() {
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const date = addDays(today(), -i);
    const ds = formatDate(date);
    const { total, completed } = getDayStats(date);
    const stimHas = safe(() => hasAnyEntries(ds), false);
    const cheap = safe(() => dailyMetric(ds, 'cheap'), 0);
    const recovery = safe(() => dailyMetric(ds, 'recovery'), 0);
    const tasks = safe(() => getTasks(ds), []);
    out.push({
      date: ds, dow: date.getDay(),
      habitTotal: total, habitDone: completed,
      habitPct: total ? completed / total : null,
      stimHas, cheap, recovery,
      taskTotal: tasks.length, taskDone: tasks.filter(t => t.done).length,
    });
  }
  return out;
}

export function renderHomeReview() {
  const panel = document.getElementById('tab-review');
  if (!panel) return;

  const D = days7();
  const from = D[0].date, to = D[D.length - 1].date;
  const fromD = new Date(from + 'T00:00:00');
  const range = `${MONTH_NAMES[fromD.getMonth()]} ${fromD.getDate()} – ${MONTH_NAMES[today().getMonth()]} ${today().getDate()}`;

  // ---- data quality ----
  const habitDays = D.filter(d => d.habitDone > 0).length;
  const stimDays = D.filter(d => d.stimHas).length;
  const checkins = safe(() => recentCheckins(7), []);
  const checkinDays = checkins.filter(c => c.has).length;
  const taskDays = D.filter(d => d.taskTotal > 0).length;
  const doneSessions = safe(() => getSessions(s => s.status === 'done' && s.date >= from && s.date <= to), []).length;

  const quality = `
    <div class="card rev-quality">
      <div class="rev-quality-title">Data this week</div>
      <div class="rev-chips">
        ${qChip('Habits', habitDays)}
        ${qChip('Check-ins', checkinDays)}
        ${qChip('Stim', stimDays)}
        ${qChip('Task days', taskDays)}
        <span class="rev-chip"><b>${doneSessions}</b> sessions</span>
      </div>
    </div>`;

  // ---- module lines ----
  const hNow = habitWindowPct(0), hPrev = habitWindowPct(7);
  const task7 = safe(() => taskCompletion(7), { done: 0, total: 0 });
  const cheapVals = D.filter(d => d.stimHas).map(d => d.cheap);
  const avgCheap = mean(cheapVals);
  const baseCheap = safe(() => baselineMetricDaily('cheap'), null);
  const target = safe(() => metricTarget('cheap'), null);
  const daysAbove = target ? D.filter(d => d.stimHas && d.cheap > target.hi).length : 0;
  const moodVals = checkins.filter(c => c.has && typeof c.mood === 'number').map(c => c.mood);
  const avgMood = mean(moodVals);
  const trend = safe(() => patternSummary(3), []);
  const missed = safe(() => missedSessions(), []).length;
  const upcomingSessions = safe(() => getSessions(s => s.status === 'planned' && s.date >= to), []).length;
  const nextTest = safe(() => getTests('active').map(decorateTest).filter(t => t._daysUntil != null && t._daysUntil >= 0).sort((a, b) => a._daysUntil - b._daysUntil)[0], null);

  const modules = `
    <div class="rev-section-title">How the week went</div>
    ${statLine('Habits', hNow == null ? 'no scheduled habits' : `${pct(hNow)} completed`, deltaTag(hNow, hPrev))}
    ${statLine('Tasks', task7.total ? `${task7.done}/${task7.total} done` : 'none added', task7.total ? pctTag(task7.done / task7.total * 100) : '')}
    ${statLine('Cheap stim', avgCheap == null ? 'no logs' : `avg ${r1(avgCheap)}/day`, baseCheap ? compareTag(avgCheap, baseCheap, true) : '')}
    ${statLine('Mental', avgMood == null ? 'no check-ins' : `mood ${r1(avgMood)}/5`, trend.length ? `<span class="rev-tag">${trend.slice(0, 2).join(', ')}</span>` : '')}
    ${statLine('School', `${doneSessions} done${upcomingSessions ? ` · ${upcomingSessions} upcoming` : ''}`, missed ? `<span class="rev-tag bad">${missed} missed</span>` : (nextTest ? `<span class="rev-tag">next ${nextTest._daysUntil}d</span>` : ''))}`;

  // ---- highlights ----
  const highlights = buildHighlights({ hNow, hPrev, avgCheap, baseCheap, daysAbove, trend, missed, D });

  // ---- reflection questions ----
  const questions = buildQuestions({ D, checkinDays, missed, hNow, hPrev, avgCheap });
  const qHtml = questions.length
    ? questions.map(q => `<div class="rev-q">${q}</div>`).join('')
    : `<div class="home-empty-line">Not enough logged data yet this week — a few more days of logging will unlock sharper questions.</div>`;

  panel.innerHTML = `
    <div class="mh-header"><div class="mh-title">Weekly Review</div><div class="mh-subtitle">${range}</div></div>
    ${quality}
    ${highlights}
    <div class="card rev-card">${modules}</div>
    <div class="rev-section-title">Reflect</div>
    <div class="card rev-card">${qHtml}</div>
    <button class="btn btn-ghost rev-export" data-rev-export style="width:100%;margin-top:6px;">Export full AI reflection →</button>
    <div class="rev-note">The AI reflection export (in Settings) builds a longer, shareable report from this data.</div>
  `;

  wire(panel);
}

function qChip(label, n) {
  const cls = n >= 6 ? 'good' : n >= 3 ? '' : 'low';
  return `<span class="rev-chip ${cls}"><b>${n}</b>/7 ${label}</span>`;
}
function statLine(label, value, tag) {
  return `<div class="rev-stat"><span class="rev-stat-label">${label}</span><span class="rev-stat-val">${value}</span>${tag || ''}</div>`;
}
function deltaTag(now, prev) {
  if (now == null || prev == null) return '';
  const d = Math.round(now - prev);
  if (Math.abs(d) < 3) return '<span class="rev-tag">steady</span>';
  return `<span class="rev-tag ${d > 0 ? 'good' : 'bad'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d)}%</span>`;
}
function pctTag(p) { return `<span class="rev-tag ${p >= 70 ? 'good' : p >= 40 ? '' : 'bad'}">${pct(p)}</span>`; }
function compareTag(v, base, lowerBetter) {
  if (v == null || base == null) return '';
  const up = v > base;
  const good = lowerBetter ? !up : up;
  if (Math.abs(v - base) < 0.1) return '<span class="rev-tag">≈ baseline</span>';
  return `<span class="rev-tag ${good ? 'good' : 'bad'}">${up ? '▲' : '▼'} vs base</span>`;
}

function buildHighlights({ hNow, hPrev, avgCheap, baseCheap, daysAbove, trend, missed, D }) {
  const up = [], down = [];
  if (hNow != null && hPrev != null) {
    if (hNow - hPrev >= 5) up.push(`Habit completion rose to ${pct(hNow)}.`);
    else if (hPrev - hNow >= 5) down.push(`Habit completion slipped to ${pct(hNow)}.`);
  }
  if (avgCheap != null && baseCheap) {
    if (avgCheap < baseCheap - 0.1) up.push(`Cheap stim ran below your baseline.`);
    else if (avgCheap > baseCheap + 0.1) down.push(`Cheap stim ran above your baseline.`);
  }
  if (trend.includes('mood higher')) up.push('Mood trended up.');
  if (trend.includes('mood lower')) down.push('Mood trended down.');
  if (trend.includes('energy lower')) down.push('Energy trended down.');
  if (missed) down.push(`${missed} study session${missed === 1 ? '' : 's'} missed.`);
  const zeroDays = D.filter(d => d.habitTotal > 0 && d.habitDone === 0).length;
  if (zeroDays) down.push(`${zeroDays} day${zeroDays === 1 ? '' : 's'} with no habits done.`);

  if (!up.length && !down.length) return '';
  return `<div class="rev-highlights">
    ${up.map(t => `<div class="rev-hl good">▲ ${t}</div>`).join('')}
    ${down.map(t => `<div class="rev-hl bad">▼ ${t}</div>`).join('')}
  </div>`;
}

// Specific, data-driven questions. Each generator returns a string or null and
// only fires when the data genuinely supports it. Capped at 4.
function buildQuestions({ D, checkinDays, missed, hNow, hPrev, avgCheap }) {
  const out = [];

  // 1) Cheap stim vs same-day task completion.
  const both = D.filter(d => d.stimHas && d.taskTotal > 0).map(d => ({ cheap: d.cheap, ratio: d.taskDone / d.taskTotal }));
  if (both.length >= 3) {
    const med = median(both.map(b => b.cheap));
    const high = both.filter(b => b.cheap >= med && b.cheap > 0);
    const low = both.filter(b => !(b.cheap >= med && b.cheap > 0));
    const hi = mean(high.map(b => b.ratio)), lo = mean(low.map(b => b.ratio));
    if (high.length >= 2 && hi != null && lo != null && hi < lo - 0.15) {
      out.push(`Cheap stim was highest on ${high.length} day${high.length === 1 ? '' : 's'} where you finished fewer tasks (${pct(hi * 100)} vs ${pct(lo * 100)} done). What usually happens right before those blocks?`);
    }
  }

  // 2) Missing check-ins.
  const missingCheckins = 7 - checkinDays;
  if (missingCheckins >= 4) {
    out.push(`Check-ins are missing on ${missingCheckins}/7 days, so the mood picture is thin. What would make a 20-second check-in easier to remember?`);
  }

  // 3) Missed school sessions.
  if (missed >= 1) {
    out.push(`${missed} planned study session${missed === 1 ? ' was' : 's were'} not completed. Was the plan too ambitious, or was the timing wrong?`);
  }

  // 4) Consistent habits but little recovery.
  const recDays = D.filter(d => d.stimHas);
  const avgRec = mean(recDays.map(d => Math.abs(d.recovery)));
  if (hNow != null && hNow >= 80 && recDays.length >= 3 && (avgRec == null || avgRec < 0.1)) {
    out.push(`Your habits were consistent (${pct(hNow)}) but you logged almost no recovery activities. Is that pace sustainable for you?`);
  }

  // 5) Habit completion dropped week-over-week.
  if (out.length < 4 && hNow != null && hPrev != null && hNow <= hPrev - 15) {
    out.push(`Habit completion fell from ${pct(hPrev)} to ${pct(hNow)} this week. Which specific habit slipped first, and what got in the way?`);
  }

  return out.slice(0, 4);
}

function wire(panel) {
  if (panel.dataset.homeRevBound) return;
  panel.dataset.homeRevBound = '1';
  panel.addEventListener('click', (e) => {
    if (e.target.closest('[data-rev-export]')) goTo('physical', 'settings');
  });
}
