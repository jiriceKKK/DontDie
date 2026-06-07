// ============================================================
// EXPORT — AI reflection report. Builds a Markdown document an AI can read
// without knowing the app: module explanations, computed factual summaries,
// cross-module pattern hints, a raw-data appendix, and a ready-to-paste
// analysis prompt. NOT medical/diagnostic; stimulation is behaviour-based,
// readiness is an estimate.
// ============================================================

import { state } from '../state.js';
import { formatDate, today, addDays, parseDate } from '../utils/date.js';
import { collectAll, rangeBounds, spanDays, APP_VERSION } from './collect.js';
import { getHabitsForDate, computeStreak, computeLongestStreak } from '../habits.js';
import { computeVolume, getMuscles } from '../split/store.js';
import {
  dailyMetric, hasAnyEntries, baselineMetricDaily, metricTarget,
  topActivitiesByMetric, blockMetric, dayBlocks,
} from '../stimulation/store.js';
import {
  getSubjects, getTests, decorateTest, sessionCounts, missedSessions, subjectName,
} from '../school/store.js';

// ---- formatting helpers ---------------------------------------------------
const r1 = n => Math.round(n * 10) / 10;
const num = x => (x == null || !Number.isFinite(x)) ? '—' : String(r1(x));
const pct = x => (x == null || !Number.isFinite(x)) ? '—' : `${Math.round(x)}%`;
const avg = arr => { const v = arr.filter(x => typeof x === 'number' && Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const safe = (fn, fallback) => { try { const v = fn(); return v == null ? fallback : v; } catch { return fallback; } };
const list = (arr, fmt, empty = 'None.') => (arr && arr.length) ? arr.map(fmt).join('\n') : `_${empty}_`;
const trendArrow = t => t == null ? '' : (t > 0.05 ? ` (▲ +${r1(t)})` : t < -0.05 ? ` (▼ ${r1(t)})` : ' (→ flat)');

// ---- per-module summaries (factual only) ----------------------------------

function physicalSummary(b, raw) {
  const logDates = Object.keys(raw.logsByDate).sort();
  const end = today();
  const start = b.days ? addDays(today(), -(b.days - 1)) : (logDates.length ? parseDate(logDates[0]) : today());

  let scheduled = 0, completed = 0;
  const per = {};
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    const ds = formatDate(d);
    const logs = state.logsByDate[ds] || {};
    for (const h of getHabitsForDate(d)) {
      scheduled++;
      (per[h.id] = per[h.id] || { name: h.name, scheduled: 0, completed: 0 }).scheduled++;
      if (logs[h.id]) { completed++; per[h.id].completed++; }
    }
  }
  const rows = Object.values(per).map(x => ({ name: x.name, scheduled: x.scheduled, completed: x.completed, pct: x.scheduled ? Math.round(x.completed / x.scheduled * 100) : 0 }));
  return {
    days: b.days || spanDays(b),
    loggedDays: logDates.length,
    scheduled, completed,
    rate: scheduled ? Math.round(completed / scheduled * 100) : null,
    perHabit: rows,
    mostMissed: [...rows].sort((a, c) => a.pct - c.pct).slice(0, 3),
    bestHabits: [...rows].sort((a, c) => c.pct - a.pct).slice(0, 3),
    customHabits: (raw.customHabits || []).map(h => h.name),
    hiddenBuiltins: raw.hiddenBuiltins || [],
    currentStreak: safe(() => computeStreak(), 0),
    longestStreak: safe(() => computeLongestStreak(), 0),
    volume: safe(() => { const v = computeVolume(); return getMuscles().map(m => ({ name: m.name, direct: (v[m.id] || {}).direct || 0, indirect: (v[m.id] || {}).indirect || 0, min: m.min })); }, []),
    hasSplit: !!raw.split,
  };
}

function mentalSummary(b, raw) {
  const checkins = Object.values(raw.checkins).sort((a, c) => (a.date || '').localeCompare(c.date || ''));
  const metrics = ['mood', 'stress', 'anxiety', 'energy', 'sleep', 'social'];
  const averages = {}, trend = {};
  const half = Math.floor(checkins.length / 2);
  for (const m of metrics) {
    averages[m] = avg(checkins.map(c => c[m]));
    const a = avg(checkins.slice(0, half).map(c => c[m]));
    const z = avg(checkins.slice(half).map(c => c[m]));
    trend[m] = (a != null && z != null) ? z - a : null;
  }
  const tagC = {};
  for (const c of checkins) for (const t of (c.tags || [])) tagC[t] = (tagC[t] || 0) + 1;
  const jType = {};
  for (const j of raw.journal) jType[j.type] = (jType[j.type] || 0) + 1;
  return {
    days: b.days || spanDays(b),
    coverage: checkins.length,
    averages, trend,
    tags: Object.entries(tagC).sort((a, c) => c[1] - a[1]).map(([tag, count]) => ({ tag, count })),
    taskDone: raw.tasks.filter(t => t.done).length,
    taskTotal: raw.tasks.length,
    journalCount: raw.journal.length,
    journalByType: jType,
  };
}

function stimulationSummary(b, raw) {
  const logDates = Object.keys(raw.logs).filter(ds => safe(() => hasAnyEntries(ds), false)).sort();
  const cheap = [], prod = [], rec = [];
  for (const ds of logDates) {
    cheap.push(safe(() => dailyMetric(ds, 'cheap'), 0));
    prod.push(safe(() => dailyMetric(ds, 'productive'), 0));
    rec.push(safe(() => dailyMetric(ds, 'recovery'), 0));
  }
  const n = b.days || 3650;
  const blocks = safe(() => dayBlocks(), []);
  const blockCheap = blocks.map(bl => {
    let s = 0, c = 0;
    for (const ds of logDates) { s += safe(() => blockMetric(ds, bl.index, 'cheap'), 0); c++; }
    return { label: bl.label, avg: c ? s / c : 0 };
  }).filter(x => x.avg > 1e-9).sort((a, c) => c.avg - a.avg);
  return {
    daysLogged: logDates.length,
    avgCheap: avg(cheap), avgProd: avg(prod), avgRec: avg(rec),
    baselineCheap: safe(() => baselineMetricDaily('cheap'), null),
    baselineProd: safe(() => baselineMetricDaily('productive'), null),
    targetCheap: safe(() => metricTarget('cheap'), null),
    targetProd: safe(() => metricTarget('productive'), null),
    topCheap: safe(() => topActivitiesByMetric(n, 'cheap'), []).slice(0, 5),
    topProd: safe(() => topActivitiesByMetric(n, 'productive'), []).slice(0, 5),
    topBlocksCheap: blockCheap.slice(0, 3),
    activityCount: (raw.activities || []).length,
  };
}

function schoolSummary(b, raw) {
  const subjects = safe(() => getSubjects(), []);
  const activeTests = safe(() => getTests('active').map(decorateTest), []);
  const counts = safe(() => sessionCounts(), { planned: 0, done: 0, skipped: 0 });
  const missed = safe(() => missedSessions().length, 0);
  const results = raw.results.slice().sort((a, c) => (c.createdAt || '').localeCompare(a.createdAt || ''));
  const scored = results.filter(r => typeof r.scorePercent === 'number');
  const weak = {}, strong = {};
  for (const t of activeTests) { for (const w of (t.weakTopics || [])) weak[w] = (weak[w] || 0) + 1; for (const s of (t.strongTopics || [])) strong[s] = (strong[s] || 0) + 1; }
  for (const r of results) { for (const w of (r.weakTopics || [])) weak[w] = (weak[w] || 0) + 1; for (const s of (r.strongTopics || [])) strong[s] = (strong[s] || 0) + 1; }
  return {
    subjects: subjects.map(s => s.name),
    activeTests: activeTests.map(t => ({ title: t.title, subject: safe(() => subjectName(t.subjectId), '?'), date: t.testDate, days: t._daysUntil, readiness: t._readiness, risk: t._risk, worst: t.worstAcceptableGrade })),
    planned: counts.planned, done: counts.done, skipped: counts.skipped, missed,
    resultsInRange: results.length,
    avgScore: scored.length ? avg(scored.map(r => r.scorePercent)) : null,
    latest: results.slice(0, 3).map(r => ({ subject: r.subject, type: r.sessionType, score: r.scorePercent, weak: r.weakTopics || [] })),
    weakTopics: Object.entries(weak).sort((a, c) => c[1] - a[1]).map(([topic, count]) => ({ topic, count })),
    strongTopics: Object.entries(strong).sort((a, c) => c[1] - a[1]).map(([topic, count]) => ({ topic, count })),
    highRisk: activeTests.filter(t => t._risk === 'high').map(t => t.title),
  };
}

// ---- markdown sections ----------------------------------------------------

const EXPLANATIONS = `## Module explanations

### Physical Health
- Habits are scheduled activities (built-in or custom) shown on specific weekdays.
- Completion logs are per date: a habit is either marked done or not for a given day.
- "Split" is the **planned** training program (gym sessions + mobility), not a record of completed workouts.
- Gym volume below is **planned** weekly volume (sets per muscle) derived from the split, not performed volume.

### Mental Health
- Check-ins are self-reported, at most once per day.
- mood / stress / anxiety / energy / sleep / social are subjective 1–5 ratings (mood may be shown as an emoji + score).
- Tags are user-selected context labels.
- Tasks are temporary, day-based to-dos — not recurring habits.
- Journal entries are free text written into guided templates.

### Stimulation
- This is a behaviour-based **estimate**, NOT a dopamine or biological measurement.
- **Cheap Stim** = fast / counterproductive stimulation (scrolling, short-video, porn, binge content, gaming…).
- **Productive Activation** = useful stimulation/effort (gym, focused study, coding, school work…).
- **Recovery** = calming activities expected to reduce cheap-stim pressure (reading, walks, journaling…).
- Values are duration-weighted sums of logged activities placed into time blocks across the day.
- Baseline = recent average; target range = an estimated practical band. Both are behaviour-based estimates.

### School
- Tests are planned school exams/deadlines with a date and a "worst acceptable grade" (1 = high pressure … 5 = low).
- Sessions are planned study sessions of a given type (diagnostic, active recall, flashcards, mixed quiz, weak-spots drill, etc.).
- APP_RESULT blocks are AI-generated quiz/session results pasted back into the app.
- Readiness is an **estimate** (0–100), not a grade guarantee.
- Weak/strong topics come from quiz results and AI feedback.`;

function executiveSummary(b, P, M, SC, ST) {
  return `## Executive summary

Only factual summaries from the available data — no interpretation here.

- Date range: ${b.label} (covers ${P.days} day${P.days === 1 ? '' : 's'}).
- Physical: ${P.scheduled ? `${P.completed}/${P.scheduled} scheduled habits completed (${pct(P.rate)}).` : 'no scheduled habits in range.'}
- Physical most-missed habits: ${P.mostMissed.length ? P.mostMissed.map(h => `${h.name} (${h.pct}%)`).join(', ') : '—'}.
- Mental: ${M.coverage}/${M.days} days had a check-in; avg mood ${num(M.averages.mood)}/5, avg stress ${num(M.averages.stress)}/5.
- Mental tasks: ${M.taskTotal ? `${M.taskDone}/${M.taskTotal} completed.` : 'none logged.'}
- Stimulation: ${ST.daysLogged ? `avg cheap stim ${num(ST.avgCheap)}, avg productive activation ${num(ST.avgProd)} over ${ST.daysLogged} logged day(s).` : 'no logs in range.'}
- Top cheap-stim activities: ${ST.topCheap.length ? ST.topCheap.slice(0, 3).map(a => a.name).join(', ') : '—'}.
- School: ${SC.activeTests.length} active test(s); avg quiz score ${SC.avgScore == null ? '—' : pct(SC.avgScore)}.
- Most common weak school topics: ${SC.weakTopics.length ? SC.weakTopics.slice(0, 3).map(w => w.topic).join(', ') : '—'}.`;
}

function physicalSection(P) {
  if (!P.scheduled && !P.customHabits.length && !P.hasSplit) return `## Physical Health summary\n\n_No physical data in this range._`;
  const vol = P.volume.filter(v => v.direct || v.indirect);
  return `## Physical Health summary

- Scheduled habit-instances: ${P.scheduled} · completed: ${P.completed} · completion rate: ${pct(P.rate)}.
- Days with any log: ${P.loggedDays}.
- Current streak: ${P.currentStreak} day(s) · longest (last 365d): ${P.longestStreak} day(s).
- Custom habits: ${P.customHabits.length ? P.customHabits.join(', ') : 'none'}.
- Hidden built-ins: ${P.hiddenBuiltins.length ? P.hiddenBuiltins.join(', ') : 'none'}.

**Completion by habit:**
${list(P.perHabit, h => `- ${h.name}: ${h.completed}/${h.scheduled} (${h.pct}%)`, 'No scheduled habits in range.')}

**Best-completed:** ${P.bestHabits.map(h => `${h.name} (${h.pct}%)`).join(', ') || '—'}
**Most missed:** ${P.mostMissed.map(h => `${h.name} (${h.pct}%)`).join(', ') || '—'}

**Planned weekly gym volume (direct sets, +indirect):**
${list(vol, v => `- ${v.name}: ${v.direct}${v.indirect ? ` (+${v.indirect})` : ''}${v.min ? ` · target ≥ ${v.min}` : ''}`, 'No split volume configured.')}`;
}

function mentalSection(M) {
  if (!M.coverage && !M.taskTotal && !M.journalCount) return `## Mental Health summary\n\n_No mental check-ins in this range._`;
  const ml = (label, key, suffix = '/5') => M.averages[key] == null ? `- ${label}: — (no data)` : `- ${label}: ${num(M.averages[key])}${suffix}${trendArrow(M.trend[key])}`;
  return `## Mental Health summary

- Check-in coverage: ${M.coverage}/${M.days} days.
${ml('Mood', 'mood')}
${ml('Stress', 'stress')}
${ml('Tension/anxiety', 'anxiety')}
${ml('Energy', 'energy')}
${ml('Sleep quality', 'sleep')}
${ml('Social', 'social')}
- Most common tags: ${M.tags.length ? M.tags.slice(0, 6).map(t => `${t.tag} (${t.count})`).join(', ') : 'none'}.
- Task completion: ${M.taskTotal ? `${M.taskDone}/${M.taskTotal} (${pct(M.taskTotal ? M.taskDone / M.taskTotal * 100 : 0)})` : 'no tasks'}.
- Journal entries: ${M.journalCount}${M.journalCount ? ` (${Object.entries(M.journalByType).map(([t, c]) => `${t}: ${c}`).join(', ')})` : ''}.

(Trend = second half of the range vs first half. Summaries only — no advice or diagnosis.)`;
}

function stimulationSection(ST) {
  if (!ST.daysLogged) return `## Stimulation summary\n\n_No stimulation logs in this range._`;
  const tgt = t => t ? `${r1(t.lo)}–${r1(t.hi)}` : '—';
  return `## Stimulation summary

- Days with logs: ${ST.daysLogged} · activity library size: ${ST.activityCount}.
- Average cheap stim load: ${num(ST.avgCheap)} · average productive activation: ${num(ST.avgProd)}.
- Average recovery effect: ${num(ST.avgRec)} (negative = more recovery logged).
- Cheap-stim baseline (recent): ${num(ST.baselineCheap)} · target range: ${tgt(ST.targetCheap)}.
- Productive average (recent): ${num(ST.baselineProd)} · target range: ${tgt(ST.targetProd)}.
- Cheap vs productive: ${ST.avgCheap != null && ST.avgProd != null ? (ST.avgCheap > ST.avgProd ? 'cheap stim averaged higher than productive activation' : ST.avgProd > ST.avgCheap ? 'productive activation averaged higher than cheap stim' : 'cheap stim and productive activation averaged about equal') : '—'}.

**Top cheap-stim activities:**
${list(ST.topCheap, a => `- ${a.name}: ${num(a.load)} over ${a.minutes} min`, 'None.')}

**Top productive activities:**
${list(ST.topProd, a => `- ${a.name}: ${num(a.load)} over ${a.minutes} min`, 'None.')}

**Highest cheap-stim time blocks:**
${list(ST.topBlocksCheap, x => `- ${x.label}: ${num(x.avg)} avg`, 'None.')}

(Behaviour-based estimate — not dopamine measurement.)`;
}

function schoolSection(SC) {
  if (!SC.subjects.length && !SC.activeTests.length && !SC.resultsInRange) return `## School summary\n\n_No school data yet._`;
  return `## School summary

- Subjects: ${SC.subjects.length ? SC.subjects.join(', ') : 'none'}.
- Active tests: ${SC.activeTests.length}.
- Sessions — planned: ${SC.planned} · done: ${SC.done} · skipped: ${SC.skipped} · missed (overdue): ${SC.missed}.
- Average quiz score (range): ${SC.avgScore == null ? '—' : pct(SC.avgScore)} from ${SC.resultsInRange} result(s).
- High-risk tests: ${SC.highRisk.length ? SC.highRisk.join(', ') : 'none'}.

**Upcoming tests:**
${list(SC.activeTests, t => `- ${t.subject} — ${t.title}: ${t.date || 'no date'}${t.days == null ? '' : ` (in ${t.days}d)`} · readiness ${t.readiness}% · ${t.risk} risk · worst-grade ${t.worst}`, 'No active tests.')}

**Latest results:**
${list(SC.latest, r => `- ${r.subject || '?'} · ${r.type} · ${r.score == null ? 'n/a' : r.score + '%'}${r.weak.length ? ` · weak: ${r.weak.slice(0, 4).join(', ')}` : ''}`, 'No results yet.')}

**Weak topics:** ${SC.weakTopics.length ? SC.weakTopics.slice(0, 8).map(w => `${w.topic} (${w.count})`).join(', ') : 'none recorded'}.
**Strong topics:** ${SC.strongTopics.length ? SC.strongTopics.slice(0, 8).map(s => `${s.topic} (${s.count})`).join(', ') : 'none recorded'}.

(Readiness is an estimate, not a grade prediction.)`;
}

const CROSS_MODULE = `## Cross-module pattern prompts

Please look for patterns such as (treat as **correlations only — never claim causation**):

- cheap stim vs next-day mood and next-day energy
- evening stimulation vs sleep quality
- productive activation vs mood / energy
- recovery activities vs stress
- mental task completion vs mood
- physical habit completion vs energy
- school study sessions completed vs quiz scores
- missed school sessions vs stress
- high-stimulation days before poor school performance

Also flag: missing/sparse data, inconsistencies, and the 2–3 strongest signals worth a small experiment next week.`;

const AI_PROMPT = `## Suggested prompt for AI

> Analyze this DontDie export. Find the strongest patterns across physical health, mental health, stimulation and school. Be direct and practical. Do not diagnose me. Do not give motivational filler. Do not claim causation. Focus on what the data actually suggests, what might be missing, and what experiments I should try next week.`;

const HOW_TO_READ = `## How to read this file

This file contains data from my personal tracking app (DontDie). It includes physical habits, a training split, mental check-ins, stimulation logs and school planning/results.

- Do not treat this as medical, psychological or diagnostic data.
- Do not claim causation.
- Stimulation values are behaviour-based estimates, not dopamine measurement.
- School "readiness" is an estimate, not a grade prediction.
- Look for patterns, correlations, inconsistencies, missing data and useful questions.
- Be direct and practical. Avoid motivational filler.`;

// ---- public builders ------------------------------------------------------

export function buildReflection(range = '30', { compact = false } = {}) {
  const b = rangeBounds(range);
  const raw = collectAll(b);
  const P = physicalSummary(b, raw.physical);
  const M = mentalSummary(b, raw.mental);
  const ST = stimulationSummary(b, raw.stimulation);
  const SC = schoolSummary(b, raw.school);

  const head = `# DontDie AI Reflection Export${compact ? ' (compact)' : ''}

Exported at: ${new Date().toISOString()}
Date range: ${b.label}
App version: ${APP_VERSION}
Export type: AI reflection report${compact ? ' · compact (no raw appendix)' : ''}`;

  const parts = [
    head,
    HOW_TO_READ,
    EXPLANATIONS,
    executiveSummary(b, P, M, SC, ST),
    physicalSection(P),
    mentalSection(M),
    stimulationSection(ST),
    schoolSection(SC),
    CROSS_MODULE,
  ];

  if (!compact) {
    parts.push(`## Raw data appendix

Raw, range-filtered data (config/non-date items are included in full). Convert as needed.

\`\`\`json
${JSON.stringify(raw, null, 2)}
\`\`\``);
  }

  parts.push(AI_PROMPT);
  return parts.join('\n\n');
}
