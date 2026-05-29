// Shared mutable app state — import this object and mutate it in place.
// All modules share the same reference; mutations are visible everywhere.
export const state = {
  activeTab: 'today',
  activeTabIndex: 0,
  statsSection: 'overview',
  splitView: 'fullweek',
  customHabits: [],
  hiddenBuiltins: new Set(),
  logsByDate: {},      // { "2024-05-20": { "gym_push_a": true, ... } }
  pendingQueue: [],    // offline queue
  isOnline: true,
  retryInterval: null,
  initialized: false,
  connectionOk: false,
};
