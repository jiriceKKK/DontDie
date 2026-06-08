// ============================================================
// SCHOOL — session-type metadata. Pure data, no imports, so both the
// planner and the tabs can depend on it without any cycle.
//
// Every planned study session is one of these evidence-based types. The
// planner decides WHICH type and WHEN; the prompt builder turns the type
// into a copy-paste prompt for Claude.
// ============================================================

export const SESSION_TYPES = [
  { id: 'diagnostic_quiz',     label: 'Diagnostic Quiz',     short: 'Find your baseline & weak topics',      minutes: 25, scored: true,  expectsResult: true, color: '#f59e0b' },
  { id: 'active_reading',      label: 'Active Reading',      short: 'Understand actively, not passive reread', minutes: 20, scored: false, expectsResult: true, color: '#60a5fa' },
  { id: 'active_recall',       label: 'Active Recall',       short: 'Answer from memory',                     minutes: 25, scored: true,  expectsResult: true, color: '#34d399' },
  { id: 'flashcards',          label: 'Flashcards',          short: 'Quick recall & spaced repetition',       minutes: 20, scored: false, expectsResult: true, color: '#a78bfa' },
  { id: 'mixed_quiz',          label: 'Mixed Quiz',          short: 'Exam-like readiness check',              minutes: 30, scored: true,  expectsResult: true, color: '#f472b6' },
  { id: 'weak_spots_drill',    label: 'Weak Spots Drill',    short: 'Target specific weak topics',            minutes: 25, scored: true,  expectsResult: true, color: '#fb923c' },
  { id: 'interleaved_practice',label: 'Interleaved Practice',short: 'Tell similar topics apart',              minutes: 30, scored: true,  expectsResult: true, color: '#22d3ee' },
  { id: 'final_review',        label: 'Final Review',        short: 'High-yield check before the test',       minutes: 20, scored: true,  expectsResult: true, color: '#facc15' },
  { id: 'quick_review',        label: 'Quick Review',        short: '5–10 min break-time review on test day',  minutes: 8,  scored: false, expectsResult: false, color: '#fcd34d' },
];

export const SESSION_TYPE_IDS = SESSION_TYPES.map(s => s.id);

const _byId = Object.fromEntries(SESSION_TYPES.map(s => [s.id, s]));

// Always returns a usable object — unknown ids fall back to mixed_quiz so a
// corrupt/old session can never blank a card.
export function sessionType(id) {
  return _byId[id] || _byId.mixed_quiz;
}
export function sessionLabel(id) { return sessionType(id).label; }
export function sessionColor(id) { return sessionType(id).color; }
export function isScored(id) { return !!sessionType(id).scored; }
export function isValidSessionType(id) { return Object.prototype.hasOwnProperty.call(_byId, id); }
