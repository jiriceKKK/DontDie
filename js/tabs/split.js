import { state } from '../state.js';
import { CATEGORY_COLORS } from '../constants.js';
import { today } from '../utils/date.js';

// ── Split / Mobility data ────────────────────────────────────────────────────

const MOBILITY_WARMUP = {
  title: 'Pre-workout Dynamic Warm-up',
  duration: '5 min — do before every gym session',
  exercises: [
    { name: 'Leg swing forward/back',       detail: '10 reps/side' },
    { name: 'Leg swing lateral',            detail: '10 reps/side' },
    { name: 'Hip circle',                   detail: '10 reps/side' },
    { name: "World's greatest stretch",     detail: '5 reps/side' },
    { name: 'Knee-to-wall ankle mob',       detail: '10 reps/side', priority: true },
    { name: 'Bodyweight squat hold',        detail: '10 slow reps' },
    { name: 'Cat-cow',                      detail: '8 reps' },
  ],
};

const MOBILITY_DATA = [
  {
    day: 1, name: 'Monday', label: 'Push A — post-workout · 6 min',
    exercises: [
      { name: 'Thread-the-needle',                               detail: '45 sec/side' },
      { name: 'Doorway chest stretch / band pull-apart',         detail: '30 sec' },
      { name: 'Shoulder CARs',                                   detail: '5 slow circles/side' },
      { name: 'Standing calf stretch (straight leg)',            detail: '45 sec/side' },
      { name: 'Standing calf stretch (bent knee / soleus)',      detail: '45 sec/side' },
    ],
  },
  {
    day: 2, name: 'Tuesday', label: 'Legs A — post-workout · 8 min',
    exercises: [
      { name: 'Elevated heel deep squat hold',   detail: '60 sec' },
      { name: 'Couch stretch',                   detail: '60 sec/side' },
      { name: '90/90 hip stretch',               detail: '45 sec/side' },
      { name: 'Standing calf stretch (straight leg)',  detail: '45 sec/side' },
      { name: 'Standing calf stretch (bent knee)',     detail: '45 sec/side' },
    ],
  },
  {
    day: 3, name: 'Wednesday', label: 'Pull A — post-workout · 6 min',
    exercises: [
      { name: 'Thread-the-needle',           detail: '45 sec/side' },
      { name: 'Shoulder CARs',               detail: '5 slow circles/side' },
      { name: 'Hip flexor lunge stretch',    detail: '45 sec/side' },
      { name: 'Standing calf stretch',       detail: '45 sec/side' },
    ],
  },
  {
    day: 4, name: 'Thursday', label: 'Push B — post-workout · 6 min',
    note: 'Same as Monday',
    exercises: [
      { name: 'Thread-the-needle',                               detail: '45 sec/side' },
      { name: 'Doorway chest stretch / band pull-apart',         detail: '30 sec' },
      { name: 'Shoulder CARs',                                   detail: '5 slow circles/side' },
      { name: 'Standing calf stretch (straight leg)',            detail: '45 sec/side' },
      { name: 'Standing calf stretch (bent knee)',               detail: '45 sec/side' },
    ],
  },
  {
    day: 5, name: 'Friday', label: 'Pull B / Legs posterior — post-workout · 8 min',
    note: 'Same as Tuesday (heavy leg work)',
    exercises: [
      { name: 'Elevated heel deep squat hold',   detail: '60 sec' },
      { name: 'Couch stretch',                   detail: '60 sec/side' },
      { name: '90/90 hip stretch',               detail: '45 sec/side' },
      { name: 'Standing calf stretch (straight leg)', detail: '45 sec/side' },
      { name: 'Standing calf stretch (bent knee)',    detail: '45 sec/side' },
    ],
  },
  {
    day: 6, name: 'Saturday', label: 'Cardio day — after Zone 2 · 8 min',
    note: 'Full body — more time available, no heavy lifting today',
    exercises: [
      { name: 'Couch stretch',                                       detail: '60 sec/side' },
      { name: '90/90 hip stretch',                                   detail: '45 sec/side' },
      { name: 'Elevated heel deep squat hold',                       detail: '60 sec' },
      { name: 'Thread-the-needle',                                   detail: '45 sec/side' },
      { name: 'Shoulder CARs',                                       detail: '5 circles/side' },
      { name: 'Standing calf stretch (straight + bent knee)',        detail: '45 sec/side each' },
    ],
  },
  {
    day: 0, name: 'Sunday', label: 'Dedicated session · 15–20 min',
    note: 'This is where real ROM change happens. Use PAILs/RAILs.',
    pails: true,
    pailsMethod: 'Get into the stretch → 10 sec push INTO the stretch (isometric) → 10 sec pull OUT of the stretch (active) → move deeper → repeat.',
    exercises: [
      { name: 'Couch stretch + PAILs/RAILs',                                    detail: '3 rounds/side', pails: true },
      { name: '90/90 + PAILs/RAILs',                                            detail: '3 rounds/side', pails: true },
      { name: 'Deep squat progressive hold (no heel elevation)',                 detail: '3 × 45 sec, go deeper each round' },
      { name: 'Thread-the-needle',                                               detail: '60 sec/side (passive, no PAILs)' },
      { name: 'Calf stretch (both variations)',                                  detail: '60 sec/side' },
    ],
  },
];

const MOBILITY_NOTES = [
  { priority: true,  text: 'Knee-to-wall is your #1 priority every day. Takes 2 min, fixes your squat.' },
  { priority: false, text: 'On leg days: put a small plate (~1–2 cm) under your heels on Smith squat while you build ankle mobility.' },
  { priority: false, text: 'Calf stretch: straight leg = gastrocnemius, bent knee = soleus. Do both — both are tight if your squat falls back.' },
  { priority: true,  text: "PAILs/RAILs on Sunday is where real ROM change happens. Don't skip it." },
];

const SPLIT_DATA = [
  {
    day: 1, name: 'Monday', label: 'Push A + Skill',
    activities: [
      { cat: 'gym',      text: 'Push Session',      sub: 'Chest · Back · Deltas · Calves' },
      { cat: 'mobility', text: 'Mobility',           sub: '10 min' },
      { cat: 'skill',    text: 'OAH / Handstand',   sub: '15–20 min, before gym' },
    ],
    gym: {
      title: 'Monday — Push (Chest + Back + Deltas + Calves)',
      groups: [
        { name: 'Chest',      exercises: ['Pec machine 3×', 'Bench press 2×'] },
        { name: 'Back',       exercises: ['Lat pulldown 3×', 'Seated cable row 3×'] },
        { name: 'Calves',     exercises: ['Calf raise 2×'] },
        { name: 'Lateral',    exercises: ['Cable lateral raise 3×'] },
        { name: 'Rear delts', exercises: ['Rear-delt isolation 3×'] },
        { name: 'Triceps',    exercises: ['3×'] },
      ],
    },
  },
  {
    day: 2, name: 'Tuesday', label: 'Legs A + Skill',
    activities: [
      { cat: 'gym',      text: 'Legs Session',      sub: 'Quads bias + Glute bias' },
      { cat: 'mobility', text: 'Mobility',           sub: '10 min' },
      { cat: 'skill',    text: 'OAH / Handstand',   sub: '15–20 min, before gym' },
    ],
    gym: {
      title: 'Tuesday — Legs A (Quads bias + Glutes)',
      groups: [
        { name: 'Quads',      exercises: ['Smith squat 3×', 'Leg press (quad) 2×', 'Leg ext 2×'] },
        { name: 'Hamstrings', exercises: ['Lying ham curl 3×', 'RDL 1×'] },
        { name: 'Glutes',     exercises: ['Bulgarian split squat 2×', 'Leg press (glute) 1×'] },
        { name: 'Calves',     exercises: ['Standing calf raise 2×'] },
        { name: 'Lateral',    exercises: ['Cable lateral raise 2×'] },
        { name: 'Triceps',    exercises: ['Pushdown 2×'] },
      ],
    },
  },
  {
    day: 3, name: 'Wednesday', label: 'Pull A',
    activities: [
      { cat: 'gym',      text: 'Pull Session',    sub: 'Back + Biceps' },
      { cat: 'mobility', text: 'Mobility',         sub: '10 min' },
      { cat: 'skill',    text: 'OAH skipped',      sub: 'CNS rest from balance' },
    ],
    gym: {
      title: 'Wednesday — Pull (Back + Biceps)',
      groups: [
        { name: 'Back',   exercises: ['Barbell row 3×', 'Lat pulldown 3×', 'Seated cable row 2×'] },
        { name: 'Biceps', exercises: ['Bayesian cable curl 3×', 'Preacher curl 3×'] },
      ],
    },
  },
  {
    day: 4, name: 'Thursday', label: 'Push B + Skill',
    activities: [
      { cat: 'gym',      text: 'Push Session',    sub: 'Chest + Triceps + Deltas + Calves' },
      { cat: 'mobility', text: 'Mobility',         sub: '10 min' },
      { cat: 'skill',    text: 'OAH / Handstand', sub: '15–20 min, before gym' },
    ],
    gym: {
      title: 'Thursday — Push B (Chest + Triceps + Deltas + Calves)',
      groups: [
        { name: 'Chest',      exercises: ['Incline bench (smith) 3×', 'Flat bench 2×', 'Pec machine 2×'] },
        { name: 'Calves',     exercises: ['Calf raise 2×'] },
        { name: 'Triceps',    exercises: ['Overhead triceps 2×', 'Pushdown 1×'] },
        { name: 'Lateral',    exercises: ['Cable lateral raise 3×'] },
        { name: 'Rear delts', exercises: ['Rear-delt isolation 3×'] },
      ],
    },
  },
  {
    day: 5, name: 'Friday', label: 'Pull B + Skill',
    activities: [
      { cat: 'gym',      text: 'Pull Session',    sub: 'Lower posterior bias + Biceps + Deltas' },
      { cat: 'mobility', text: 'Mobility',         sub: '10 min' },
      { cat: 'skill',    text: 'OAH / Handstand', sub: '15–20 min, lighter' },
    ],
    gym: {
      title: 'Friday — Pull B (Posterior + Biceps + Deltas)',
      groups: [
        { name: 'Hamstrings', exercises: ['Barbell RDL 4×', 'Lying ham curl 2×'] },
        { name: 'Quads',      exercises: ['Smith squat 2×', 'Leg extension 3×'] },
        { name: 'Glutes',     exercises: ['Bulgarian split squat 2×', 'Leg press (glutes) 1×'] },
        { name: 'Calves',     exercises: ['Calf raise 2×'] },
        { name: 'Lateral',    exercises: ['Cable lateral raise 2×'] },
        { name: 'Biceps',     exercises: ['Preacher curl 2×'] },
      ],
    },
  },
  {
    day: 6, name: 'Saturday', label: 'Cardio + Skill',
    activities: [
      { cat: 'cardio',   text: 'HIIT: Norwegian 4×4',  sub: '~38 min' },
      { cat: 'cardio',   text: 'Zone 2 Cardio',         sub: '60 min — bike/row/walk' },
      { cat: 'mobility', text: 'Mobility Flow',          sub: '15–20 min dedicated session' },
      { cat: 'skill',    text: 'OAH / Handstand',       sub: '20–30 min skill session' },
    ],
    gym: null,
  },
  {
    day: 0, name: 'Sunday', label: 'Active Recovery',
    activities: [
      { cat: 'cardio',   text: 'Zone 2 Cardio', sub: '60 min — easy' },
      { cat: 'mobility', text: 'Mobility',       sub: 'light flow + foam rolling' },
    ],
    gym: null,
  },
];

const VOLUME_SUMMARY = [
  { name: 'Chest',      sets: 12, min: 10, max: 20 },
  { name: 'Back',       sets: 14, min: 10, max: 20 },
  { name: 'Quads',      sets: 12, min: 10, max: 20 },
  { name: 'Hamstrings', sets: 10, min: 10, max: 20 },
  { name: 'Glutes',     sets: 6,  min: 6,  max: 10 },
  { name: 'Calves',     sets: 8,  min: 6,  max: 12 },
  { name: 'Biceps',     sets: 8,  min: 6,  max: 14 },
  { name: 'Triceps',    sets: 8,  min: 6,  max: 14 },
  { name: 'Lat delts',  sets: 10, min: 8,  max: 16 },
  { name: 'Rear delts', sets: 6,  min: 6,  max: 12 },
  { name: 'Front',      sets: 0,  min: 0,  max: 6  },
];

// ── Render functions ─────────────────────────────────────────────────────────

export function renderSplit() {
  const panel    = document.getElementById('tab-split');
  const todayDow = today().getDay();

  panel.innerHTML = `
    <div class="pill-nav">
      <button class="pill-btn ${state.splitView === 'fullweek' ? 'active' : ''}" data-view="fullweek">Full Week</button>
      <button class="pill-btn ${state.splitView === 'gymonly'  ? 'active' : ''}" data-view="gymonly">Gym Only</button>
      <button class="pill-btn ${state.splitView === 'mobility' ? 'active' : ''}" data-view="mobility">Mobility</button>
    </div>
    <div id="split-content"></div>
  `;

  panel.querySelectorAll('.pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.splitView = btn.dataset.view;
      panel.querySelectorAll('.pill-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.view === state.splitView)
      );
      renderSplitContent(state.splitView, todayDow);
    });
  });

  renderSplitContent(state.splitView, todayDow);
}

function renderSplitContent(view, todayDow) {
  const container = document.getElementById('split-content');
  if (!container) return;

  if (view === 'fullweek') {
    let html = '';
    for (const day of SPLIT_DATA) {
      const isToday   = day.day === todayDow;
      const isMobile  = window.innerWidth < 768;
      const openClass = (isToday || !isMobile) ? ' open' : '';

      html += `
        <div class="split-day-card${isToday ? ' today-card' : ''}${openClass}" data-day="${day.day}">
          <div class="split-day-header">
            <div>
              <div class="split-day-title">${day.name}</div>
              <div class="split-day-subtitle">${day.label}</div>
            </div>
            <svg class="split-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </div>
          <div class="split-day-body">
            <div class="split-activity-list">
              ${day.activities.map(a => `
                <div class="split-activity-item">
                  <div class="cat-dot" style="background:${CATEGORY_COLORS[a.cat]}"></div>
                  <div>${a.text}${a.sub ? ` <span>${a.sub}</span>` : ''}</div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `;
    }
    container.innerHTML = html;
    container.querySelectorAll('.split-day-header').forEach(h =>
      h.addEventListener('click', () => h.closest('.split-day-card').classList.toggle('open'))
    );

  } else if (view === 'gymonly') {
    const gymDays = SPLIT_DATA.filter(d => d.gym);
    let html = '';

    for (const day of gymDays) {
      const isToday   = day.day === todayDow;
      const isMobile  = window.innerWidth < 768;
      const openClass = (isToday || !isMobile) ? ' open' : '';

      html += `
        <div class="split-day-card${isToday ? ' today-card' : ''}${openClass}" data-day="${day.day}">
          <div class="split-day-header">
            <div>
              <div class="split-day-title">${day.gym.title}</div>
            </div>
            <svg class="split-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </div>
          <div class="split-day-body">
            <div class="gym-exercises">
              ${day.gym.groups.map(g => `
                <div class="gym-muscle-group">
                  <div class="gym-muscle-label">${g.name}</div>
                  <div class="gym-exercise-list">
                    ${g.exercises.map(e => `<div class="gym-exercise-chip">${e}</div>`).join('')}
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `;
    }

    const volHtml = VOLUME_SUMMARY.map(v => {
      const cls = v.sets >= v.min ? 'good' : (v.sets >= v.min * 0.7 ? 'ok' : '');
      return `
        <div class="volume-chip ${cls}">
          <div class="volume-label">${v.name}</div>
          <div class="volume-num">${v.sets}</div>
        </div>
      `;
    }).join('');

    html += `
      <div class="collapsible-header" id="volume-toggle">
        Weekly Volume
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>
      <div class="collapsible-body" id="volume-body">
        <div class="volume-grid">${volHtml}</div>
      </div>
    `;

    container.innerHTML = html;
    container.querySelectorAll('.split-day-header').forEach(h =>
      h.addEventListener('click', () => h.closest('.split-day-card').classList.toggle('open'))
    );
    const volToggle = document.getElementById('volume-toggle');
    if (volToggle) {
      volToggle.addEventListener('click', () =>
        document.getElementById('volume-body').classList.toggle('open')
      );
    }

  } else if (view === 'mobility') {
    renderMobilitySplit(container, todayDow);
  }
}

function renderMobilitySplit(container, todayDow) {
  const isMobile = window.innerWidth < 768;

  let html = `
    <div class="split-day-card open" style="margin-bottom:10px;">
      <div class="split-day-header">
        <div>
          <div class="split-day-title">Every Day — Pre-workout Warm-up</div>
          <div class="split-day-subtitle">${MOBILITY_WARMUP.duration}</div>
        </div>
        <svg class="split-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>
      <div class="split-day-body">
        <div class="mobility-exercise-list">
          ${MOBILITY_WARMUP.exercises.map(ex => `
            <div class="mobility-exercise-row ${ex.priority ? 'priority' : ''}">
              ${ex.priority ? '<div class="mobility-priority-dot"></div>' : '<div class="mobility-dot"></div>'}
              <div class="mobility-exercise-name">${ex.name}${ex.priority ? ' ★' : ''}</div>
              <div class="mobility-exercise-detail">${ex.detail}</div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;

  for (const day of MOBILITY_DATA) {
    const isToday    = day.day === todayDow;
    const openClass  = (isToday || !isMobile) ? ' open' : '';
    const pailsBadge = day.pails ? `<span class="mobility-pails-badge">PAILs/RAILs</span>` : '';
    const pailsExplainer = day.pails && day.pailsMethod
      ? `<div class="mobility-pails-explainer">${day.pailsMethod}</div>` : '';
    const noteHtml = day.note ? `<div class="mobility-day-note">${day.note}</div>` : '';

    html += `
      <div class="split-day-card${isToday ? ' today-card' : ''}${openClass}" data-day="${day.day}">
        <div class="split-day-header">
          <div>
            <div class="split-day-title" style="display:flex;align-items:center;gap:8px;">
              ${day.name} ${pailsBadge}
            </div>
            <div class="split-day-subtitle">${day.label}</div>
          </div>
          <svg class="split-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
        <div class="split-day-body">
          ${noteHtml}
          ${pailsExplainer}
          <div class="mobility-exercise-list">
            ${day.exercises.map(ex => `
              <div class="mobility-exercise-row ${ex.pails ? 'has-pails' : ''}">
                <div class="mobility-dot"></div>
                <div class="mobility-exercise-name">${ex.name}</div>
                <div class="mobility-exercise-detail">${ex.detail}</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }

  const notesHtml = MOBILITY_NOTES.map(n => `
    <div class="mobility-note-item ${n.priority ? 'priority' : ''}">
      <div class="mobility-note-dot"></div>
      <div>${n.text}</div>
    </div>
  `).join('');

  html += `
    <div class="collapsible-header" id="mobility-notes-toggle">
      Notes & Cues
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    </div>
    <div class="collapsible-body" id="mobility-notes-body">
      <div class="mobility-notes-list">${notesHtml}</div>
    </div>
  `;

  container.innerHTML = html;
  container.querySelectorAll('.split-day-header').forEach(h =>
    h.addEventListener('click', () => h.closest('.split-day-card').classList.toggle('open'))
  );
  const mobNotesToggle = document.getElementById('mobility-notes-toggle');
  if (mobNotesToggle) {
    mobNotesToggle.addEventListener('click', () =>
      document.getElementById('mobility-notes-body').classList.toggle('open')
    );
  }
}
