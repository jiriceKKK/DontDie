export const BUILT_IN_HABITS = [
  { id: 'gym_push_a', name: 'Push Session',        days: [1],             category: 'gym',      icon: '🏋️', label: 'Chest · Back · Deltas · Calves' },
  { id: 'mobility',   name: 'Mobility',             days: [1,2,3,4,5,6,0],category: 'mobility', icon: '🧘', label: '10 min' },
  { id: 'oah',        name: 'OAH / Handstand',      days: [1,2,4,5,6],    category: 'skill',    icon: '🤸', label: '15–20 min' },
  { id: 'gym_legs_a', name: 'Legs Session',         days: [2],             category: 'gym',      icon: '🦵', label: 'Quads · Glutes · Hamstrings' },
  { id: 'gym_pull_a', name: 'Pull Session',         days: [3],             category: 'gym',      icon: '💪', label: 'Back · Biceps' },
  { id: 'gym_push_b', name: 'Push Session',         days: [4],             category: 'gym',      icon: '🏋️', label: 'Chest · Triceps · Deltas · Calves' },
  { id: 'gym_pull_b', name: 'Pull Session',         days: [5],             category: 'gym',      icon: '💪', label: 'Posterior · Biceps · Deltas' },
  { id: 'hiit',       name: 'HIIT / Norwegian 4×4', days: [6],             category: 'cardio',   icon: '⚡', label: '~38 min' },
  { id: 'zone2',      name: 'Zone 2 Cardio',        days: [6, 0],          category: 'cardio',   icon: '🚴', label: '60 min' },
];

export const CATEGORY_COLORS = {
  gym:      'var(--accent)',
  cardio:   'var(--warning)',
  mobility: 'var(--text-secondary)',
  skill:    'var(--purple)',
  custom:   'var(--blue)',
};

export const CATEGORY_LABELS = {
  gym:      'Gym',
  cardio:   'Cardio',
  mobility: 'Mobility',
  skill:    'Skill',
  custom:   'Custom',
};

export const PRESET_COLORS = [
  '#6ee7b7', // accent
  '#fbbf24', // warning
  '#f87171', // danger
  '#a78bfa', // purple
  '#60a5fa', // blue
  '#fb923c', // orange
];

export const TAB_ORDER   = ['today', 'week', 'stats', 'split', 'settings'];
export const DAY_NAMES   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
export const DAY_FULL    = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
export const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
