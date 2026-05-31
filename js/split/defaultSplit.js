// ============================================================
// DEFAULT SPLIT — the current hardcoded plan, migrated into the
// new editable/data-driven shape. This is only the SEED: once the
// app has loaded a split (from localStorage or Supabase) the UI
// reads from that copy, not from here.
// ============================================================

export const SPLIT_VERSION = 1;

// Volume-tag helper: a gym exercise contributes `count` sets of `type`
// (direct | indirect) volume to `muscle`.
const t = (muscle, type) => ({ muscle, type, count: true });

// Muscle groups used by the weekly-volume summary, with target ranges
// (min/max sets per week). Carried over from the old VOLUME_SUMMARY.
const MUSCLES = [
  { id: 'chest',       name: 'Chest',      min: 10, max: 20 },
  { id: 'back',        name: 'Back',       min: 10, max: 20 },
  { id: 'quads',       name: 'Quads',      min: 10, max: 20 },
  { id: 'hamstrings',  name: 'Hamstrings', min: 10, max: 20 },
  { id: 'glutes',      name: 'Glutes',     min: 6,  max: 10 },
  { id: 'calves',      name: 'Calves',     min: 6,  max: 12 },
  { id: 'biceps',      name: 'Biceps',     min: 6,  max: 14 },
  { id: 'triceps',     name: 'Triceps',    min: 6,  max: 14 },
  { id: 'lat_delts',   name: 'Lat delts',  min: 8,  max: 16 },
  { id: 'rear_delts',  name: 'Rear delts', min: 6,  max: 12 },
  { id: 'front_delts', name: 'Front',      min: 0,  max: 6  },
];

// Reusable gym exercise library. `sets` is just the default used when the
// exercise is first dropped onto a day; each day stores its own planned sets.
// Tags give reasonable defaults based on what each lift obviously trains.
const LIBRARY = [
  { id: 'pec_machine',          name: 'Pec machine',          sets: 3, tags: [t('chest','direct')] },
  { id: 'bench_press',          name: 'Bench press',          sets: 2, tags: [t('chest','direct'), t('triceps','indirect'), t('front_delts','indirect')] },
  { id: 'flat_bench',           name: 'Flat bench',           sets: 2, tags: [t('chest','direct'), t('triceps','indirect'), t('front_delts','indirect')] },
  { id: 'incline_bench_smith',  name: 'Incline bench (smith)',sets: 3, tags: [t('chest','direct'), t('front_delts','indirect'), t('triceps','indirect')] },
  { id: 'lat_pulldown',         name: 'Lat pulldown',         sets: 3, tags: [t('back','direct'), t('biceps','indirect')] },
  { id: 'seated_cable_row',     name: 'Seated cable row',     sets: 3, tags: [t('back','direct'), t('biceps','indirect'), t('rear_delts','indirect')] },
  { id: 'barbell_row',          name: 'Barbell row',          sets: 3, tags: [t('back','direct'), t('biceps','indirect'), t('rear_delts','indirect')] },
  { id: 'calf_raise',           name: 'Calf raise',           sets: 2, tags: [t('calves','direct')] },
  { id: 'standing_calf_raise',  name: 'Standing calf raise',  sets: 2, tags: [t('calves','direct')] },
  { id: 'cable_lateral_raise',  name: 'Cable lateral raise',  sets: 3, tags: [t('lat_delts','direct')] },
  { id: 'rear_delt_iso',        name: 'Rear-delt isolation',  sets: 3, tags: [t('rear_delts','direct')] },
  { id: 'triceps_generic',      name: 'Triceps',              sets: 3, tags: [t('triceps','direct')] },
  { id: 'pushdown',             name: 'Pushdown',             sets: 2, tags: [t('triceps','direct')] },
  { id: 'overhead_triceps',     name: 'Overhead triceps',     sets: 2, tags: [t('triceps','direct')] },
  { id: 'smith_squat',          name: 'Smith squat',          sets: 3, tags: [t('quads','direct'), t('glutes','indirect')] },
  { id: 'leg_press_quad',       name: 'Leg press (quad)',     sets: 2, tags: [t('quads','direct'), t('glutes','indirect')] },
  { id: 'leg_ext',              name: 'Leg ext',              sets: 2, tags: [t('quads','direct')] },
  { id: 'leg_extension',        name: 'Leg extension',        sets: 3, tags: [t('quads','direct')] },
  { id: 'lying_ham_curl',       name: 'Lying ham curl',       sets: 3, tags: [t('hamstrings','direct')] },
  { id: 'rdl',                  name: 'RDL',                  sets: 1, tags: [t('hamstrings','direct'), t('glutes','indirect')] },
  { id: 'barbell_rdl',          name: 'Barbell RDL',          sets: 4, tags: [t('hamstrings','direct'), t('glutes','indirect')] },
  { id: 'bulgarian_split_squat',name: 'Bulgarian split squat',sets: 2, tags: [t('glutes','direct'), t('quads','indirect')] },
  { id: 'leg_press_glute',      name: 'Leg press (glute)',    sets: 1, tags: [t('glutes','direct'), t('quads','indirect')] },
  { id: 'leg_press_glutes',     name: 'Leg press (glutes)',   sets: 1, tags: [t('glutes','direct'), t('quads','indirect')] },
  { id: 'bayesian_cable_curl',  name: 'Bayesian cable curl',  sets: 3, tags: [t('biceps','direct')] },
  { id: 'preacher_curl',        name: 'Preacher curl',        sets: 3, tags: [t('biceps','direct')] },
];

// gym group helper
const g = (name, items) => ({ name, items });
// gym item helper (ref into library + planned sets for THIS day)
const x = (ref, sets) => ({ ref, sets });
// mobility item helper
const m = (name, detail, extra = {}) => ({ name, detail, ...extra });

const DAYS = [
  {
    dow: 1, name: 'Monday', label: 'Push A + Skill',
    activities: [
      { cat: 'gym',      text: 'Push Session',    sub: 'Chest · Back · Deltas · Calves' },
      { cat: 'mobility', text: 'Mobility',         sub: '10 min' },
      { cat: 'skill',    text: 'OAH / Handstand',  sub: '15–20 min, before gym' },
    ],
    gym: {
      title: 'Monday — Push (Chest + Back + Deltas + Calves)',
      groups: [
        g('Chest',      [x('pec_machine', 3), x('bench_press', 2)]),
        g('Back',       [x('lat_pulldown', 3), x('seated_cable_row', 3)]),
        g('Calves',     [x('calf_raise', 2)]),
        g('Lateral',    [x('cable_lateral_raise', 3)]),
        g('Rear delts', [x('rear_delt_iso', 3)]),
        g('Triceps',    [x('triceps_generic', 3)]),
      ],
    },
    mobility: {
      label: 'Push A — post-workout · 6 min',
      items: [
        m('Thread-the-needle', '45 sec/side'),
        m('Doorway chest stretch / band pull-apart', '30 sec'),
        m('Shoulder CARs', '5 slow circles/side'),
        m('Standing calf stretch (straight leg)', '45 sec/side'),
        m('Standing calf stretch (bent knee / soleus)', '45 sec/side'),
      ],
    },
  },
  {
    dow: 2, name: 'Tuesday', label: 'Legs A + Skill',
    activities: [
      { cat: 'gym',      text: 'Legs Session',    sub: 'Quads bias + Glute bias' },
      { cat: 'mobility', text: 'Mobility',         sub: '10 min' },
      { cat: 'skill',    text: 'OAH / Handstand',  sub: '15–20 min, before gym' },
    ],
    gym: {
      title: 'Tuesday — Legs A (Quads bias + Glutes)',
      groups: [
        g('Quads',      [x('smith_squat', 3), x('leg_press_quad', 2), x('leg_ext', 2)]),
        g('Hamstrings', [x('lying_ham_curl', 3), x('rdl', 1)]),
        g('Glutes',     [x('bulgarian_split_squat', 2), x('leg_press_glute', 1)]),
        g('Calves',     [x('standing_calf_raise', 2)]),
        g('Lateral',    [x('cable_lateral_raise', 2)]),
        g('Triceps',    [x('pushdown', 2)]),
      ],
    },
    mobility: {
      label: 'Legs A — post-workout · 8 min',
      items: [
        m('Elevated heel deep squat hold', '60 sec'),
        m('Couch stretch', '60 sec/side'),
        m('90/90 hip stretch', '45 sec/side'),
        m('Standing calf stretch (straight leg)', '45 sec/side'),
        m('Standing calf stretch (bent knee)', '45 sec/side'),
      ],
    },
  },
  {
    dow: 3, name: 'Wednesday', label: 'Pull A',
    activities: [
      { cat: 'gym',      text: 'Pull Session', sub: 'Back + Biceps' },
      { cat: 'mobility', text: 'Mobility',      sub: '10 min' },
      { cat: 'skill',    text: 'OAH skipped',   sub: 'CNS rest from balance' },
    ],
    gym: {
      title: 'Wednesday — Pull (Back + Biceps)',
      groups: [
        g('Back',   [x('barbell_row', 3), x('lat_pulldown', 3), x('seated_cable_row', 2)]),
        g('Biceps', [x('bayesian_cable_curl', 3), x('preacher_curl', 3)]),
      ],
    },
    mobility: {
      label: 'Pull A — post-workout · 6 min',
      items: [
        m('Thread-the-needle', '45 sec/side'),
        m('Shoulder CARs', '5 slow circles/side'),
        m('Hip flexor lunge stretch', '45 sec/side'),
        m('Standing calf stretch', '45 sec/side'),
      ],
    },
  },
  {
    dow: 4, name: 'Thursday', label: 'Push B + Skill',
    activities: [
      { cat: 'gym',      text: 'Push Session',    sub: 'Chest + Triceps + Deltas + Calves' },
      { cat: 'mobility', text: 'Mobility',         sub: '10 min' },
      { cat: 'skill',    text: 'OAH / Handstand',  sub: '15–20 min, before gym' },
    ],
    gym: {
      title: 'Thursday — Push B (Chest + Triceps + Deltas + Calves)',
      groups: [
        g('Chest',      [x('incline_bench_smith', 3), x('flat_bench', 2), x('pec_machine', 2)]),
        g('Calves',     [x('calf_raise', 2)]),
        g('Triceps',    [x('overhead_triceps', 2), x('pushdown', 1)]),
        g('Lateral',    [x('cable_lateral_raise', 3)]),
        g('Rear delts', [x('rear_delt_iso', 3)]),
      ],
    },
    mobility: {
      label: 'Push B — post-workout · 6 min',
      note: 'Same as Monday',
      items: [
        m('Thread-the-needle', '45 sec/side'),
        m('Doorway chest stretch / band pull-apart', '30 sec'),
        m('Shoulder CARs', '5 slow circles/side'),
        m('Standing calf stretch (straight leg)', '45 sec/side'),
        m('Standing calf stretch (bent knee)', '45 sec/side'),
      ],
    },
  },
  {
    dow: 5, name: 'Friday', label: 'Pull B + Skill',
    activities: [
      { cat: 'gym',      text: 'Pull Session',    sub: 'Lower posterior bias + Biceps + Deltas' },
      { cat: 'mobility', text: 'Mobility',         sub: '10 min' },
      { cat: 'skill',    text: 'OAH / Handstand',  sub: '15–20 min, lighter' },
    ],
    gym: {
      title: 'Friday — Pull B (Posterior + Biceps + Deltas)',
      groups: [
        g('Hamstrings', [x('barbell_rdl', 4), x('lying_ham_curl', 2)]),
        g('Quads',      [x('smith_squat', 2), x('leg_extension', 3)]),
        g('Glutes',     [x('bulgarian_split_squat', 2), x('leg_press_glutes', 1)]),
        g('Calves',     [x('calf_raise', 2)]),
        g('Lateral',    [x('cable_lateral_raise', 2)]),
        g('Biceps',     [x('preacher_curl', 2)]),
      ],
    },
    mobility: {
      label: 'Pull B / Legs posterior — post-workout · 8 min',
      note: 'Same as Tuesday (heavy leg work)',
      items: [
        m('Elevated heel deep squat hold', '60 sec'),
        m('Couch stretch', '60 sec/side'),
        m('90/90 hip stretch', '45 sec/side'),
        m('Standing calf stretch (straight leg)', '45 sec/side'),
        m('Standing calf stretch (bent knee)', '45 sec/side'),
      ],
    },
  },
  {
    dow: 6, name: 'Saturday', label: 'Cardio + Skill',
    activities: [
      { cat: 'cardio',   text: 'HIIT: Norwegian 4×4', sub: '~38 min' },
      { cat: 'cardio',   text: 'Zone 2 Cardio',        sub: '60 min — bike/row/walk' },
      { cat: 'mobility', text: 'Mobility Flow',         sub: '15–20 min dedicated session' },
      { cat: 'skill',    text: 'OAH / Handstand',      sub: '20–30 min skill session' },
    ],
    gym: null,
    mobility: {
      label: 'Cardio day — after Zone 2 · 8 min',
      note: 'Full body — more time available, no heavy lifting today',
      items: [
        m('Couch stretch', '60 sec/side'),
        m('90/90 hip stretch', '45 sec/side'),
        m('Elevated heel deep squat hold', '60 sec'),
        m('Thread-the-needle', '45 sec/side'),
        m('Shoulder CARs', '5 circles/side'),
        m('Standing calf stretch (straight + bent knee)', '45 sec/side each'),
      ],
    },
  },
  {
    dow: 0, name: 'Sunday', label: 'Active Recovery',
    activities: [
      { cat: 'cardio',   text: 'Zone 2 Cardio', sub: '60 min — easy' },
      { cat: 'mobility', text: 'Mobility',       sub: 'light flow + foam rolling' },
    ],
    gym: null,
    mobility: {
      label: 'Dedicated session · 15–20 min',
      note: 'This is where real ROM change happens. Use PAILs/RAILs.',
      pails: true,
      pailsMethod: 'Get into the stretch → 10 sec push INTO the stretch (isometric) → 10 sec pull OUT of the stretch (active) → move deeper → repeat.',
      items: [
        m('Couch stretch + PAILs/RAILs', '3 rounds/side', { pails: true }),
        m('90/90 + PAILs/RAILs', '3 rounds/side', { pails: true }),
        m('Deep squat progressive hold (no heel elevation)', '3 × 45 sec, go deeper each round'),
        m('Thread-the-needle', '60 sec/side (passive, no PAILs)'),
        m('Calf stretch (both variations)', '60 sec/side'),
      ],
    },
  },
];

const WARMUP = {
  title: 'Pre-workout Dynamic Warm-up',
  duration: '5 min — do before every gym session',
  items: [
    m('Leg swing forward/back', '10 reps/side'),
    m('Leg swing lateral', '10 reps/side'),
    m('Hip circle', '10 reps/side'),
    m("World's greatest stretch", '5 reps/side'),
    m('Knee-to-wall ankle mob', '10 reps/side', { priority: true }),
    m('Bodyweight squat hold', '10 slow reps'),
    m('Cat-cow', '8 reps'),
  ],
};

const NOTES = [
  { priority: true,  text: 'Knee-to-wall is your #1 priority every day. Takes 2 min, fixes your squat.' },
  { priority: false, text: 'On leg days: put a small plate (~1–2 cm) under your heels on Smith squat while you build ankle mobility.' },
  { priority: false, text: 'Calf stretch: straight leg = gastrocnemius, bent knee = soleus. Do both — both are tight if your squat falls back.' },
  { priority: true,  text: "PAILs/RAILs on Sunday is where real ROM change happens. Don't skip it." },
];

// Returns a fresh deep copy so callers can mutate freely without touching the seed.
export function buildDefaultSplit() {
  return JSON.parse(JSON.stringify({
    version: SPLIT_VERSION,
    updatedAt: null,
    muscles: MUSCLES,
    library: LIBRARY,
    days: DAYS,
    warmup: WARMUP,
    notes: NOTES,
  }));
}
