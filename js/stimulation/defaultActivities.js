// ============================================================
// STIMULATION — default activity library + category metadata.
//
// This is a behaviour-based ESTIMATE, not a biological/medical
// measurement. `stimulationScore` is a simple intensity weight:
//   +5/+6 very high · +4 high · +2/+3 medium · 0/+1 light
//   -1..-3 low-stim / recovery / calming
// ============================================================

// Ordered categories with display labels and an accent var for chips.
export const CATEGORIES = [
  { id: 'high_stim',       label: 'High stim',       color: 'var(--danger)' },
  { id: 'medium_stim',     label: 'Medium stim',     color: 'var(--warning)' },
  { id: 'productive_stim', label: 'Productive stim', color: 'var(--blue)' },
  { id: 'low_stim',        label: 'Low stim',        color: 'var(--text-secondary)' },
  { id: 'recovery',        label: 'Recovery',        color: 'var(--accent)' },
];

export const CATEGORY_IDS = CATEGORIES.map(c => c.id);
export function categoryLabel(id) { const c = CATEGORIES.find(x => x.id === id); return c ? c.label : id; }
export function categoryColor(id) { const c = CATEGORIES.find(x => x.id === id); return c ? c.color : 'var(--text-muted)'; }

export const DEFAULT_SETTINGS = {
  dayStartHour: 7,
  dayEndHour: 23,
  blockMinutes: 120,
  baselineWindowDays: 7,
};

const a = (id, name, category, stimulationScore, defaultDurationMinutes, tags) =>
  ({ id, name, category, stimulationScore, defaultDurationMinutes, tags, active: true });

export const DEFAULT_ACTIVITIES = [
  // High stim
  a('instagram',     'Instagram',          'high_stim', 5, 15, ['scrolling', 'social']),
  a('tiktok',        'TikTok / Shorts',    'high_stim', 5, 15, ['scrolling', 'short-video']),
  a('porn',          'Porn',               'high_stim', 6, 15, ['sexual']),
  a('masturbation',  'Masturbation',       'high_stim', 4, 10, ['sexual']),
  a('gaming',        'Gaming',             'high_stim', 4, 60, ['entertainment']),
  a('binge_youtube', 'Binge YouTube',      'high_stim', 4, 45, ['video']),
  a('scrolling',     'Endless scrolling',  'high_stim', 5, 20, ['scrolling']),
  // Medium stim
  a('music',         'Music',              'medium_stim', 2, 30, ['audio']),
  a('youtube',       'YouTube (normal)',   'medium_stim', 3, 30, ['video']),
  a('chatting',      'Chatting / messaging','medium_stim', 2, 20, ['social']),
  a('tv',            'TV / streaming',     'medium_stim', 3, 45, ['video']),
  // Productive stim
  a('gym',           'Gym',                'productive_stim', 2, 60, ['exercise']),
  a('study',         'Focused study',      'productive_stim', 1, 45, ['school', 'focus']),
  a('coding',        'Coding',             'productive_stim', 2, 60, ['work', 'focus']),
  a('schoolwork',    'School work',        'productive_stim', 1, 45, ['school']),
  // Low stim
  a('cleaning',      'Cleaning',           'low_stim', -1, 20, ['chores']),
  a('basic_tasks',   'Basic tasks',        'low_stim', 0, 20, ['chores']),
  a('commute',       'Calm commute',       'low_stim', 0, 30, ['transit']),
  a('eating_nophone','Eating (no phone)',  'low_stim', 0, 20, ['meal']),
  // Recovery
  a('walk_nophone',  'Walk (no phone)',    'recovery', -3, 30, ['outside', 'calm']),
  a('reading',       'Reading',            'recovery', -2, 30, ['calm', 'focus']),
  a('sitting_bored', 'Sitting bored',      'recovery', -2, 15, ['calm']),
  a('journaling',    'Journaling',         'recovery', -2, 15, ['calm', 'reflect']),
  a('nap',           'Nap / sleep',        'recovery', -3, 30, ['rest']),
  a('quiet',         'Quiet room',         'recovery', -3, 15, ['calm']),
  a('nophone_break', 'No-phone break',     'recovery', -2, 15, ['calm']),
];

export function buildDefaultStimulation() {
  return JSON.parse(JSON.stringify({
    version: 1,
    updatedAt: null,
    settings: DEFAULT_SETTINGS,
    activities: DEFAULT_ACTIVITIES,
    logs: {},
  }));
}
