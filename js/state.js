// Shared mutable app state — import this object and mutate it in place.
// All modules share the same reference; mutations are visible everywhere.
export const state = {
  // ── modes ────────────────────────────────────────────────
  activeModeId: 'physical',  // which mode is showing
  modeTabs: [],              // ordered tab ids of the active mode (set by mode controller)
  modeLastTab: {},           // { modeId: lastTabId } — remembers your page per mode
  mental: null,              // mental-health data (loaded by js/mental/store.js)
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
  logsByDate: {},      // { "2024-05-20": { "gym_push_a": true, ... } }
  pendingQueue: [],    // offline queue
  isOnline: true,
  retryInterval: null,
  initialized: false,
  connectionOk: false,
};
