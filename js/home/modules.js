// ============================================================
// HOME · MODULES — launcher into the deep, mode-specific pages. Every existing
// module stays exactly as it was; this is just a tidy, thumb-friendly entry
// point (the top-left mode switcher still works too).
// ============================================================

import { goTo } from '../modes/go.js';

const MODULES = [
  { id: 'physical',    name: 'Physical Health', tab: 'today',     desc: 'Habits, week, training split & stats',
    links: [['Week', 'week'], ['Split', 'split'], ['Stats', 'stats']] },
  { id: 'stimulation', name: 'Stimulation',     tab: 'dashboard', desc: 'Cheap-stim vs productive, logging & trends',
    links: [['Dashboard', 'dashboard'], ['Log', 'log'], ['Activities', 'activities']] },
  { id: 'school',      name: 'School',          tab: 'dashboard', desc: 'Study planner, tests, prompts & results',
    links: [['Plan', 'plan'], ['Tests', 'tests'], ['Results', 'results']] },
  { id: 'mental',      name: 'Mental',          tab: 'checkin',   desc: 'Daily check-in, tasks, journal & trends',
    links: [['Check-in', 'checkin'], ['Journal', 'journal'], ['Stats', 'stats']] },
];

export function renderHomeModules() {
  const panel = document.getElementById('tab-modules');
  if (!panel) return;

  const cards = MODULES.map(m => `
    <div class="home-mod-card">
      <button class="home-mod-main" data-mode="${m.id}" data-tab="${m.tab}">
        <span class="mode-dot" data-mode-dot="${m.id}"></span>
        <span class="home-mod-text">
          <span class="home-mod-name">${m.name}</span>
          <span class="home-mod-desc">${m.desc}</span>
        </span>
        <span class="home-mod-arrow">›</span>
      </button>
      <div class="home-mod-links">
        ${m.links.map(([label, tab]) => `<button class="home-mod-link" data-mode="${m.id}" data-tab="${tab}">${label}</button>`).join('')}
      </div>
    </div>`).join('');

  panel.innerHTML = `
    <div class="mh-header"><div class="mh-title">Modules</div><div class="mh-subtitle">Open a detailed area</div></div>
    ${cards}
    <div class="home-mod-card">
      <button class="home-mod-main" data-mode="physical" data-tab="settings">
        <span class="mode-dot" style="background:var(--text-muted)"></span>
        <span class="home-mod-text">
          <span class="home-mod-name">Settings &amp; Export</span>
          <span class="home-mod-desc">Backup, AI reflection export &amp; configuration</span>
        </span>
        <span class="home-mod-arrow">›</span>
      </button>
    </div>`;

  wire(panel);
}

function wire(panel) {
  if (panel.dataset.homeModBound) return;
  panel.dataset.homeModBound = '1';
  panel.addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (b) goTo(b.dataset.mode, b.dataset.tab);
  });
}
