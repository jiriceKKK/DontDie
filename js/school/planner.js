// ============================================================
// SCHOOL — study planner. A practical, rule-based scheduler built on
// evidence-based learning principles (retrieval practice, spaced/
// distributed practice, interleaving, weak-spot correction, final
// review). NOT pretend-science: every rule is explainable.
//
// Pure module: takes a plain description of a test + history and returns
// session specs ({ dayOffset, sessionType, minutes, reason, targetTopics }).
// The store turns offsets into dates and assigns ids. No store import →
// no cycle, and it's trivially unit-testable.
// ============================================================

// Lower worstAcceptableGrade (1 = need excellent) → more pressure → denser plan.
const PRESSURE = { 1: 1.0, 2: 0.85, 3: 0.65, 4: 0.45, 5: 0.35 };

// Readiness threshold per worst-acceptable-grade — used by the store for risk.
export const READINESS_THRESHOLD = { 1: 85, 2: 75, 3: 65, 4: 55, 5: 45 };

function scoreBand(score) {
  if (score == null || !Number.isFinite(score)) return 'unknown';
  if (score < 50) return 'low';
  if (score < 70) return 'midlow';
  if (score < 85) return 'mid';
  return 'high';
}

// Days-remaining-at-a-slot decides the slot's phase, so a single plan naturally
// progresses: spacing far out → retrieval mid → drills near → final review last.
function phaseFor(remaining) {
  if (remaining <= 2) return 'final';
  if (remaining <= 7) return 'near';
  if (remaining <= 20) return 'mid';
  return 'far';
}

function gapFor(remaining, pressure) {
  let g;
  if (remaining > 20) g = 3;       // far: spaced
  else if (remaining > 7) g = 2;   // mid: every 1–3 days
  else g = 1;                      // near/final: daily-ish
  if (pressure >= 0.85) g = Math.max(1, g - 1);       // grade 1–2: tighter
  else if (pressure <= 0.45) g = g + 1;               // grade 4–5: looser
  return Math.max(1, g);
}

// Ordered preference list to cycle through for a given phase + score band.
function pool(phase, band) {
  if (phase === 'final') return ['final_review', 'weak_spots_drill'];
  if (phase === 'near') {
    if (band === 'low' || band === 'midlow') return ['weak_spots_drill', 'active_recall', 'mixed_quiz', 'interleaved_practice'];
    return ['mixed_quiz', 'interleaved_practice', 'active_recall', 'weak_spots_drill'];
  }
  if (phase === 'mid') {
    if (band === 'low')    return ['active_reading', 'flashcards', 'active_recall', 'weak_spots_drill', 'mixed_quiz'];
    if (band === 'midlow') return ['active_recall', 'flashcards', 'weak_spots_drill', 'mixed_quiz', 'interleaved_practice'];
    if (band === 'mid')    return ['flashcards', 'active_recall', 'mixed_quiz', 'interleaved_practice'];
    if (band === 'high')   return ['mixed_quiz', 'interleaved_practice', 'active_recall'];
    return ['flashcards', 'active_recall', 'mixed_quiz', 'interleaved_practice']; // unknown
  }
  // far
  if (band === 'low')  return ['active_reading', 'flashcards', 'active_recall', 'flashcards', 'weak_spots_drill', 'mixed_quiz'];
  if (band === 'high') return ['active_recall', 'mixed_quiz', 'interleaved_practice', 'flashcards'];
  return ['active_reading', 'flashcards', 'active_recall', 'mixed_quiz', 'flashcards', 'interleaved_practice']; // unknown/mid/midlow
}

const MINUTES = {
  diagnostic_quiz: 25, active_reading: 20, active_recall: 25, flashcards: 20,
  mixed_quiz: 30, weak_spots_drill: 25, interleaved_practice: 30, final_review: 20,
  quick_review: 8,
};

const uniq = arr => [...new Set(arr.filter(Boolean))];

function targetsFor(type, weak, topics) {
  if (type === 'weak_spots_drill') return (weak.length ? weak : topics).slice(0, 6);
  if (['active_recall', 'mixed_quiz', 'interleaved_practice', 'final_review'].includes(type) && weak.length) {
    return uniq([...weak, ...topics]).slice(0, 6);
  }
  return topics.slice(0, 6);
}

function reasonFor(type, remaining, lastScore, weak) {
  const inDays = `test in ${remaining} day${remaining === 1 ? '' : 's'}`;
  switch (type) {
    case 'diagnostic_quiz':      return 'No data yet — find your baseline and weak topics.';
    case 'active_reading':       return remaining > 20 ? `New material; build active understanding (${inDays}).` : 'Shore up weak foundations before retrieval.';
    case 'flashcards':           return `Spaced recall of facts/definitions; ${inDays}.`;
    case 'active_recall':        return weak.length ? `Retrieve from memory (weak: ${weak.slice(0, 2).join(', ')}); ${inDays}.` : `Retrieve from memory; ${inDays}.`;
    case 'mixed_quiz':           return `Exam-like readiness check; ${inDays}.`;
    case 'weak_spots_drill':     return lastScore != null ? `Target weak topics after a ${lastScore}% quiz.` : 'Target your weak topics.';
    case 'interleaved_practice': return `Practice telling similar topics apart; ${inDays}.`;
    case 'final_review':         return `Final high-yield review — ${inDays}.`;
    case 'quick_review':         return 'Test day — short break-time review only, not a full study session.';
    default:                     return inDays;
  }
}

// Build a single session spec ({ sessionType, minutes, reason, targetTopics }).
function mkSpec(type, remaining, lastScore, weak, topics, reasonOverride) {
  return {
    sessionType: type,
    minutes: MINUTES[type] || 25,
    reason: reasonOverride || reasonFor(type, remaining, lastScore, weak),
    targetTopics: targetsFor(type, weak, topics),
  };
}

// Main entry. `input`:
//   daysUntilTest (int >= 0), worstAcceptableGrade (1–5), lastScore (0–100|null),
//   weakTopics (string[]), topics (string[]), hasData (bool)
// Returns session specs sorted by dayOffset. Empty array for past/invalid dates.
export function generatePlan(input) {
  const days = Number(input && input.daysUntilTest);
  if (!Number.isFinite(days) || days < 0) return [];
  // No normal study session is scheduled ON the test day — on the real test day
  // I'm already at school. If the test is today there are no main study days left.
  if (days === 0) return [];

  const grade = [1, 2, 3, 4, 5].includes(input.worstAcceptableGrade) ? input.worstAcceptableGrade : 3;
  const pressure = PRESSURE[grade];
  const band = scoreBand(input.lastScore);
  const weak = uniq(input.weakTopics || []);
  const topics = uniq(input.topics || []);
  const hasData = !!input.hasData;

  // The last valid main study day is the day BEFORE the test (offset days-1).
  const lastStudyOff = days - 1;

  // Build slot offsets from today (0) up to (not past) the last study day, then
  // guarantee a final-review slot on that last study day.
  const offsets = new Map(); // off → remaining (dedupe by day)
  let off = 0, guard = 0;
  while (off <= lastStudyOff && guard++ < 80) {
    offsets.set(off, days - off);
    off += gapFor(days - off, pressure);
  }
  if (!offsets.has(lastStudyOff)) offsets.set(lastStudyOff, days - lastStudyOff);

  const slots = [...offsets.entries()]
    .map(([o, remaining]) => ({ off: o, remaining, phase: phaseFor(remaining) }))
    .sort((a, b) => a.off - b.off);

  const counters = {};
  let diagnosticPlaced = hasData;
  const out = [];

  for (const slot of slots) {
    let type;
    if (slot.phase === 'final') {
      const c = counters.final || 0;
      type = (weak.length && pressure >= 0.65 && c % 2 === 1) ? 'weak_spots_drill' : 'final_review';
      counters.final = c + 1;
    } else if (!diagnosticPlaced && slot.remaining >= 3) {
      type = 'diagnostic_quiz';
      diagnosticPlaced = true;
    } else {
      const p = pool(slot.phase, band);
      const ci = counters[slot.phase] || 0;
      type = p[ci % p.length];
      counters[slot.phase] = ci + 1;
      // Low/mid-low score with known weak topics → bias every other slot to a drill.
      if ((band === 'low' || band === 'midlow') && weak.length && ci % 2 === 1 && slot.phase !== 'far') {
        type = 'weak_spots_drill';
      }
    }
    out.push({
      dayOffset: slot.off,
      sessionType: type,
      minutes: MINUTES[type] || 25,
      reason: reasonFor(type, slot.remaining, input.lastScore, weak),
      targetTopics: targetsFor(type, weak, topics),
    });
  }
  return out;
}

// Pick the single best NEXT session for a manually-added extra session on a
// specific day. Same evidence-based rules as the planner, but context-aware so
// repeated extras on one free day progress logically instead of repeating.
//
// `input`:
//   remaining (int): days from the chosen day to the test (0 = test day)
//   worstAcceptableGrade (1–5), lastScore (0–100|null)
//   weakTopics[], topics[], hasData (bool)
//   recentTypes (string[]): session types already done/planned up to & including
//     the chosen day, oldest→newest (so same-day extras don't repeat)
//   isTestDay (bool): chosen day IS the test date → only a short quick review
//
// Returns { sessionType, minutes, reason, targetTopics } or null when invalid
// (chosen day is after the test).
export function suggestSession(input) {
  const remaining = Number(input && input.remaining);
  const grade = [1, 2, 3, 4, 5].includes(input.worstAcceptableGrade) ? input.worstAcceptableGrade : 3;
  const pressure = PRESSURE[grade];
  const band = scoreBand(input.lastScore);
  const weak = uniq(input.weakTopics || []);
  const topics = uniq(input.topics || []);
  const hasData = !!input.hasData;
  const recent = (input.recentTypes || []).filter(Boolean);
  const last = recent[recent.length - 1] || null;

  // Test day → only a short break-time review, never a full session.
  if (input.isTestDay) return mkSpec('quick_review', remaining, input.lastScore, weak, topics);

  if (!Number.isFinite(remaining) || remaining < 0) return null; // after the test

  const phase = phaseFor(remaining);

  // No data yet: diagnose first when there's time, otherwise read in (very new
  // material / very close). Only once — don't keep proposing diagnostics.
  if (!hasData && !recent.includes('diagnostic_quiz')) {
    return remaining >= 3
      ? mkSpec('diagnostic_quiz', remaining, input.lastScore, weak, topics)
      : mkSpec('active_reading', remaining, input.lastScore, weak, topics);
  }

  // Otherwise choose from the phase/band pool, biased to weak spots when scoring
  // low, avoiding an immediate repeat and preferring the least-used type so a run
  // of extras spreads across types instead of stacking four identical quizzes.
  let candidates = pool(phase, band).slice();
  if ((band === 'low' || band === 'midlow') && weak.length && !candidates.includes('weak_spots_drill')) {
    candidates.unshift('weak_spots_drill');
  }
  const usage = t => recent.filter(x => x === t).length;
  let pick = candidates.filter(t => t !== last);
  if (!pick.length) pick = candidates;
  pick.sort((a, b) => usage(a) - usage(b) || candidates.indexOf(a) - candidates.indexOf(b));
  return mkSpec(pick[0], remaining, input.lastScore, weak, topics);
}
