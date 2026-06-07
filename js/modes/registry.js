// ============================================================
// MODE REGISTRY — the list of app modes and their tabs.
//
// Adding a future mode (Sleep, Nutrition, Focus, …) = add one
// entry here with its tabs. Nothing else in the nav/swipe system
// is hardcoded to a specific mode.
// ============================================================

import { today } from '../utils/date.js';

// Physical Health (existing)
import { renderToday } from '../tabs/today.js';
import { renderWeek } from '../tabs/week.js';
import { renderStats } from '../tabs/stats.js';
import { renderSplit } from '../tabs/split.js';
import { renderSettings } from '../tabs/settings.js';

// Mental Health
import { renderCheckin } from '../mental/tabs/checkin.js';
import { renderTasks } from '../mental/tabs/tasks.js';
import { renderJournal } from '../mental/tabs/journal.js';
import { renderMentalStats } from '../mental/tabs/stats.js';

// Stimulation
import { renderStimDashboard } from '../stimulation/tabs/dashboard.js';
import { renderStimLog } from '../stimulation/tabs/log.js';
import { renderStimActivities } from '../stimulation/tabs/activities.js';
import { renderStimStats } from '../stimulation/tabs/stats.js';
import { renderStimSettings } from '../stimulation/tabs/settings.js';

// School
import { renderSchoolDashboard } from '../school/tabs/dashboard.js';
import { renderSchoolPlan } from '../school/tabs/plan.js';
import { renderSchoolTests } from '../school/tabs/tests.js';
import { renderSchoolResults } from '../school/tabs/results.js';
import { renderSchoolSettings } from '../school/tabs/settings.js';

// Icon inner-SVG (wrapped in <svg class="nav-icon"> by the nav builder).
const ICON = {
  today:    '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  week:     '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="3" y1="15" x2="21" y2="15"/>',
  bars:     '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  split:    '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  checkin:  '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>',
  tasks:    '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  journal:  '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  tools:    '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  edit:     '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>',
  list:     '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  home:     '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  book:     '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  award:    '<circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>',
};

export const MODES = [
  {
    id: 'physical',
    label: 'Physical Health',
    tabs: [
      { id: 'today',    label: 'Today',    icon: ICON.today,    render: () => renderToday(today()) },
      { id: 'week',     label: 'Week',     icon: ICON.week,     render: renderWeek },
      { id: 'stats',    label: 'Stats',    icon: ICON.bars,     render: renderStats },
      { id: 'split',    label: 'Split',    icon: ICON.split,    render: renderSplit },
      { id: 'settings', label: 'Settings', icon: ICON.settings, render: renderSettings },
    ],
  },
  {
    id: 'mental',
    label: 'Mental Health',
    tabs: [
      { id: 'checkin',  label: 'Check-in', icon: ICON.checkin,  render: renderCheckin },
      { id: 'tasks',    label: 'Tasks',    icon: ICON.tasks,    render: renderTasks },
      { id: 'journal',  label: 'Journal',  icon: ICON.journal,  render: renderJournal },
      { id: 'stats',    label: 'Stats',    icon: ICON.bars,     render: renderMentalStats },
    ],
  },
  {
    id: 'stimulation',
    label: 'Stimulation',
    tabs: [
      { id: 'dashboard',  label: 'Dashboard',  icon: ICON.activity, render: renderStimDashboard },
      { id: 'log',        label: 'Log',        icon: ICON.edit,     render: renderStimLog },
      { id: 'activities', label: 'Activities', icon: ICON.list,     render: renderStimActivities },
      { id: 'stats',      label: 'Stats',      icon: ICON.bars,     render: renderStimStats },
      { id: 'settings',   label: 'Settings',   icon: ICON.settings, render: renderStimSettings },
    ],
  },
  {
    id: 'school',
    label: 'School',
    tabs: [
      { id: 'dashboard', label: 'Today',    icon: ICON.home,     render: renderSchoolDashboard },
      { id: 'plan',      label: 'Plan',     icon: ICON.calendar, render: renderSchoolPlan },
      { id: 'tests',     label: 'Tests',    icon: ICON.book,     render: renderSchoolTests },
      { id: 'results',   label: 'Results',  icon: ICON.award,    render: renderSchoolResults },
      { id: 'settings',  label: 'Settings', icon: ICON.settings, render: renderSchoolSettings },
    ],
  },
];

export function getMode(id) {
  return MODES.find(m => m.id === id) || MODES[0];
}
