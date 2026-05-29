import { state } from './state.js';
import { TAB_ORDER } from './constants.js';
import { formatDate, today, getNDaysAgo } from './utils/date.js';
import { dbGetLogsForRange, dbGetCustomHabits, dbCheckConnection } from './db.js';
import { registerRenders, switchTab, initSwipe } from './navigation.js';
import { setOnline, startRetryInterval } from './sync.js';
import { renderToday } from './tabs/today.js';
import { renderWeek } from './tabs/week.js';
import { renderStats } from './tabs/stats.js';
import { renderSplit } from './tabs/split.js';
import { renderSettings, loadHiddenBuiltins } from './tabs/settings.js';
import { initPin, isConfigValid } from './auth.js';

// Centralised tab-render dispatcher — used both for initial pre-render and
// as the registered callback in switchTab so every navigation re-renders the
// active tab with fresh data.
function renderTab(tabName) {
  const renders = {
    today:    () => renderToday(today()),
    week:     renderWeek,
    stats:    renderStats,
    split:    renderSplit,
    settings: renderSettings,
  };
  if (renders[tabName]) renders[tabName]();
}

async function startApp() {
  const app = document.getElementById('app');
  app.classList.remove('hidden');

  // Wire up nav buttons
  document.querySelectorAll('.nav-item[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Load data in parallel before rendering anything
  const rangeEnd   = formatDate(today());
  const rangeStart = formatDate(getNDaysAgo(84)); // 12 weeks back

  const [logsRes, customRes, connRes] = await Promise.all([
    dbGetLogsForRange(rangeStart, rangeEnd),
    dbGetCustomHabits(),
    dbCheckConnection(),
  ]);

  state.logsByDate   = logsRes.data  || {};
  state.customHabits = customRes.data || [];
  state.connectionOk = connRes;
  state.initialized  = true;

  if (!connRes) {
    setOnline(false);
    startRetryInterval();
  }

  loadHiddenBuiltins();

  // Register the render dispatcher so switchTab knows what to call
  registerRenders(Object.fromEntries(TAB_ORDER.map(tab => [tab, () => renderTab(tab)])));

  // Pre-render ALL tabs so neighbouring panels have content before the user
  // starts swiping — this is the core fix for the empty-panel swipe bug.
  for (const tab of TAB_ORDER) {
    renderTab(tab);
  }

  // Now position the slider on Today (no animation on first load)
  switchTab('today', false);

  // Initialise touch swipe after panels are populated
  initSwipe();

  // Online / offline events
  window.addEventListener('online',  () => setOnline(true));
  window.addEventListener('offline', () => setOnline(false));
}

async function main() {
  if (!isConfigValid()) {
    document.getElementById('setup-screen').classList.remove('hidden');
    return;
  }

  if (sessionStorage.getItem('auth') === '1') {
    startApp();
  } else {
    initPin(startApp);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
