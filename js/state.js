// Shared mutable app state — import this object and mutate it in place.
// All modules share the same reference; mutations are visible everywhere.
export const state = {
  // ── modes ────────────────────────────────────────────────
  activeModeId: 'home',      // which mode is showing (global command center by default)
  modeTabs: [],              // ordered tab ids of the active mode (set by mode controller)
  modeLastTab: {},           // { modeId: lastTabId } — remembers your page per mode
  mental: null,              // mental-health data (loaded by js/mental/store.js)
  mindTexts: null,           // Mind · Texts reading library (loaded by js/mental/texts/store.js)
  stimulation: null,         // stimulation data (loaded by js/stimulation/store.js)
  stimDate: null,            // Log page: which day is being edited (set by the tab)
  stimBlock: 0,              // Log page: current block index in the stepper
  stimView: 'cheap',         // Dashboard metric toggle: 'cheap' | 'productive' (session only)
  school: null,              // school study-planner data (loaded by js/school/store.js)
  schoolTestFilter: 'active',// Tests page filter (transient)

  activeTab: 'today',
  activeTabIndex: 0,
  statsSection: 'overview',
  mentalStatsSection: 'trends',  // sub-view on the Mental Health stats page
  splitView: 'fullweek',
  splitEdit: false,    // Split tab edit mode on/off (transient, not persisted)
  split: null,         // the editable split plan (loaded by js/split/store.js)
  customHabits: [],
  hiddenBuiltins: new Set(),
  habitConfig: null,   // built-in overrides + custom meta (loaded by js/habitConfig.js)
  logsByDate: {},      // { "2024-05-20": { "gym_push_a": true, ... } }
  isOnline: true,
  initialized: false,
  connectionOk: false,
};

// NOTE (Phase 2): this object is an in-memory READ CACHE, not the persistence
// source of truth. Durable state lives in IndexedDB behind js/data/, and every
// mutation goes through a module action that writes there. Nothing here
// survives a reload on its own. The old `pendingQueue`/`retryInterval` fields
// are gone: pending writes are durable in the outbox, not in memory.
