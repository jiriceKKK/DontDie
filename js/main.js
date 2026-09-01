import { state } from './state.js';
import { formatDate, today, getNDaysAgo } from './utils/date.js';
import {
  dbGetLogsForRange, dbGetCustomHabits, dbCheckConnection,
  dbGetSplitConfig, dbGetMentalStore, dbGetStimulationStore, dbGetSchoolStore,
  dbGetHabitConfig, dbGetMindTextsStore,
} from './db.js';
import { initHabitConfig } from './habitConfig.js';
import { initSplit } from './split/store.js';
import { initMental } from './mental/store.js';
import { initMindTexts } from './mental/texts/store.js';
import { initStimulation } from './stimulation/store.js';
import { initSchool } from './school/store.js';
import { initSwipe } from './navigation.js';
import { initModes } from './modes/controller.js';
import { setOnline, startRetryInterval } from './sync.js';
import { loadHiddenBuiltins } from './tabs/settings.js';
import { initAuth, isConfigValid } from './auth.js';
import { escapeHtml } from './ui/dom.js';

// Last-resort visible error so a fatal startup failure never leaves a blank
// black screen. Uses inline styles so it works even if CSS failed to load.
function showFatal(err) {
  console.error('[startApp] fatal:', err);
  let box = document.getElementById('fatal-error');
  if (!box) {
    box = document.createElement('div');
    box.id = 'fatal-error';
    box.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#0d0d0f;color:#f0f0f4;padding:24px;font:14px/1.5 system-ui,sans-serif;overflow:auto;';
    document.body.appendChild(box);
  }
  box.innerHTML = `<h2 style="color:#f87171;margin-bottom:8px;">Something went wrong starting the app</h2>
    <p style="color:#8888a0;margin-bottom:12px;">This is usually a stale cache — try a hard refresh (Ctrl/Cmd+Shift+R) or an incognito window.</p>
    <pre style="color:#fbbf24;white-space:pre-wrap;font-size:12px;">${escapeHtml(String((err && err.stack) || err))}</pre>`;
}

async function startApp() {
 try {
  document.getElementById('app').classList.remove('hidden');

  // Load everything in parallel before rendering. Every call below is
  // owner-scoped and requires the authenticated session established by the
  // gate; none of them can run anonymously.
  const rangeEnd   = formatDate(today());
  const rangeStart = formatDate(getNDaysAgo(84)); // 12 weeks back

  const [logsRes, customRes, connRes, splitRes, mentalRes, stimRes, schoolRes, habitCfgRes, mindTextsRes] = await Promise.all([
    dbGetLogsForRange(rangeStart, rangeEnd),
    dbGetCustomHabits(),
    dbCheckConnection(),
    dbGetSplitConfig(),
    dbGetMentalStore(),
    dbGetStimulationStore(),
    dbGetSchoolStore(),
    dbGetHabitConfig(),
    dbGetMindTextsStore(),
  ]);

  state.logsByDate   = logsRes.data   || {};
  state.customHabits = customRes.data || [];
  state.connectionOk = connRes;
  state.initialized  = true;

  // Built-in overrides + custom-habit meta (cloud → local → empty). Must run
  // before any habit render so scheduling/labels reflect overrides.
  initHabitConfig(habitCfgRes.data);

  // Seed/load split + mental + stimulation + school data (cloud → local → default).
  initSplit(splitRes.data);
  initMental(mentalRes.data);
  initMindTexts(mindTextsRes.data);
  initStimulation(stimRes.data);
  initSchool(schoolRes.data);

  if (!connRes) {
    setOnline(false);
    startRetryInterval();
  }

  loadHiddenBuiltins();

  // The mode controller builds the nav + panels for the default mode,
  // registers its renderers, pre-renders, and positions the slider.
  initModes();

  // Touch swipe is mode-agnostic (reads state.modeTabs) — init once.
  initSwipe();

  window.addEventListener('online',  () => setOnline(true));
  window.addEventListener('offline', () => setOnline(false));
 } catch (err) {
  showFatal(err);
 }
}

async function main() {
  try {
    if (!isConfigValid()) {
      document.getElementById('setup-screen').classList.remove('hidden');
      return;
    }

    // The gate restores or establishes a real Supabase session first; startApp
    // only ever runs behind an authenticated owner.
    await initAuth(startApp);
  } catch (err) {
    showFatal(err);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
