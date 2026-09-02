/* eslint-env browser */
import { state } from './state.js';
import { formatDate, today, getNDaysAgo } from './utils/date.js';
import { initHabitConfig, adoptHabitConfig, normalizeHabitConfigDocument } from './habitConfig.js';
import { initSplit, adoptSplit, normalizeSplitDocument } from './split/store.js';
import { initMental, adoptMental, normalizeMentalDocument } from './mental/store.js';
import { initMindTexts, adoptMindTexts, normalizeMindTextsDocument } from './mental/texts/store.js';
import { initStimulation, adoptStimulation, normalizeStimulationDocument } from './stimulation/store.js';
import { initSchool, adoptSchool, normalizeSchoolDocument } from './school/store.js';
import { initSwipe } from './navigation.js';
import { initModes } from './modes/controller.js';
import { watchConnectivity } from './sync.js';
import { loadHiddenBuiltins } from './tabs/settings.js';
import { initAuth, isConfigValid } from './auth.js';
import { escapeHtml } from './ui/dom.js';
import { requireUserId } from './session.js';
import {
  initRepositories, loadLocalDocuments, loadLocalLogs, loadLocalCustomHabits,
  hydrateFromRemote, onRemoteAdopted, flush, localStoreReady,
} from './data/repository.js';
import { initSyncStatus } from './ui/syncStatus.js';
import { reconcileHabitStimLinks } from './habitStimLink.js';
import { saveStimulation } from './stimulation/store.js';

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

/** Per-store normalisers handed to the legacy localStorage migration. */
const NORMALIZERS = {
  split: normalizeSplitDocument,
  mental: normalizeMentalDocument,
  mindTexts: normalizeMindTextsDocument,
  stimulation: normalizeStimulationDocument,
  school: normalizeSchoolDocument,
  habitConfig: normalizeHabitConfigDocument,
};

/** Re-seed an in-memory store after the reconciler adopted a cloud copy. */
const ADOPTERS = {
  split: adoptSplit,
  mental: adoptMental,
  mindTexts: adoptMindTexts,
  stimulation: adoptStimulation,
  school: adoptSchool,
  habitConfig: adoptHabitConfig,
};

async function startApp() {
 try {
  document.getElementById('app').classList.remove('hidden');

  const userId = requireUserId();

  // 1. Local first. Open IndexedDB, migrate the legacy localStorage documents
  //    non-destructively, and read back whatever this device already holds.
  //    No network call blocks anything below this point.
  await initRepositories(userId, NORMALIZERS);

  const [documents, logs, customHabits] = await Promise.all([
    loadLocalDocuments(),
    loadLocalLogs(),
    loadLocalCustomHabits(),
  ]);

  state.logsByDate = logs || {};
  state.customHabits = customHabits || [];
  state.initialized = true;

  // Built-in overrides + custom-habit meta must exist before any habit render.
  initHabitConfig(documents.habitConfig);
  initSplit(documents.split);
  initMental(documents.mental);
  initMindTexts(documents.mindTexts);
  initStimulation(documents.stimulation);
  initSchool(documents.school);

  loadHiddenBuiltins();

  // 2. Build the shell against local state. Cloud latency cannot delay this.
  initModes();
  initSwipe();
  initSyncStatus();
  watchConnectivity();

  // 3. Reconcile with the cloud in the background, then drain the outbox.
  //    Failures here are reported by the sync chip, never by a blank screen.
  reconcileInBackground(userId);
 } catch (err) {
  showFatal(err);
 }
}

function reconcileInBackground(userId) {
  onRemoteAdopted((storeId, data) => {
    const adopt = ADOPTERS[storeId];
    if (!adopt) return;
    try {
      adopt(data);
      // Re-render the visible tab so an adopted cloud copy is not invisible
      // until the next navigation.
      document.dispatchEvent(new CustomEvent('app:store-adopted', { detail: { storeId } }));
    } catch (err) {
      console.error(`[sync] adopting ${storeId} failed:`, err);
    }
  });

  const rangeEnd = formatDate(today());
  const rangeStart = formatDate(getNDaysAgo(84)); // 12 weeks back, as before

  Promise.resolve()
    .then(() => flush())
    .then(() => hydrateFromRemote({ rangeStart, rangeEnd }))
    .then(async () => {
      if (!localStoreReady()) return;
      state.logsByDate = await loadLocalLogs();
      state.customHabits = await loadLocalCustomHabits();
      state.connectionOk = true;
      // Derive the linked stimulation entries from the durable habit state, so
      // a toggle whose two halves were separated by a failure converges.
      if (reconcileHabitStimLinks(state.logsByDate)) saveStimulation();
      document.dispatchEvent(new CustomEvent('app:store-adopted', { detail: { storeId: 'habits' } }));
    })
    .catch(err => console.warn('[sync] background reconciliation failed:', err && err.message));

  void userId;
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
