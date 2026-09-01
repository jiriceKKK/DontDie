/* eslint-env browser */
// ============================================================================
// Deterministic fake Supabase client for the E2E suite.
//
// It is installed with page.addInitScript BEFORE any application code runs, so
// window.supabase is already the fake by the time js/supabaseClient.js asks for
// it. The real vendored library is therefore never used and NO REQUEST EVER
// LEAVES THE BROWSER — the suite cannot touch the production project even by
// accident. (tests/e2e/fixtures/seed.js additionally hard-blocks the real host.)
//
// Behaviour is driven by window.__DONTDIE_FAKE__, seeded per test:
//   scenario : 'signed-out' | 'signed-in' | 'expired' | 'offline'
//   user     : { id, email }
//   password : the password signIn() accepts
//   rows     : { <table>: [ ...rows ] }
//
// Every query records itself into window.__DONTDIE_QUERIES__ so a test can
// assert that requests were owner-scoped (or that none were made at all).
// ============================================================================
(() => {
  const config = window.__DONTDIE_FAKE__ || {};
  const scenario = config.scenario || 'signed-out';
  const user = config.user || { id: 'e2e-owner-0000-4000-8000-000000000001', email: 'owner@example.invalid' };
  const password = config.password || 'correct horse battery';
  const tables = config.rows || {};

  window.__DONTDIE_QUERIES__ = [];

  const session = () => ({
    access_token: 'fake-access-token',
    refresh_token: 'fake-refresh-token',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user,
  });

  // The real client persists its session in localStorage, so a sign-out
  // survives a reload. Model that, otherwise `signOut()` followed by the app's
  // reload would silently sign the fake back in.
  const SIGNED_OUT_KEY = '__dontdie_fake_signed_out';
  const wasSignedOut = (() => {
    try { return localStorage.getItem(SIGNED_OUT_KEY) === '1'; } catch { return false; }
  })();

  let currentSession = scenario === 'signed-in' && !wasSignedOut ? session() : null;
  const authListeners = [];

  function emit(event, value) {
    for (const listener of authListeners) {
      try { listener(event, value); } catch { /* a listener must not break the fake */ }
    }
  }

  function matches(row, filters) {
    return filters.every(([op, column, value]) => {
      const cell = row[column];
      if (op === 'eq') return String(cell) === String(value);
      if (op === 'gte') return String(cell) >= String(value);
      if (op === 'lte') return String(cell) <= String(value);
      return true;
    });
  }

  function from(table) {
    const record = { table, filters: [], op: null, payload: null };
    window.__DONTDIE_QUERIES__.push(record);
    const rows = () => (tables[table] || []);

    const result = () => {
      if (scenario === 'offline') {
        return { data: null, error: { message: 'Failed to fetch', name: 'TypeError' } };
      }
      if (!currentSession) {
        // What real RLS looks like from the client: reads return nothing,
        // writes are refused.
        return record.op === 'select'
          ? { data: [], error: null }
          : { data: null, error: { message: 'new row violates row-level security policy', code: '42501' } };
      }
      const visible = rows().filter(row => matches(row, record.filters));
      return { data: visible, error: null };
    };

    const builder = {
      select(columns) { record.op = record.op || 'select'; record.columns = columns; return builder; },
      insert(payload) { record.op = 'insert'; record.payload = payload; return builder; },
      upsert(payload, options) { record.op = 'upsert'; record.payload = payload; record.conflict = options?.onConflict; return builder; },
      update(payload) { record.op = 'update'; record.payload = payload; return builder; },
      delete() { record.op = 'delete'; return builder; },
      order() { return builder; },
      eq(column, value) { record.filters.push(['eq', column, value]); return builder; },
      gte(column, value) { record.filters.push(['gte', column, value]); return builder; },
      lte(column, value) { record.filters.push(['lte', column, value]); return builder; },
      single() { const r = result(); return Promise.resolve({ data: (r.data || [])[0] ?? null, error: r.error }); },
      maybeSingle() { const r = result(); return Promise.resolve({ data: (r.data || [])[0] ?? null, error: r.error }); },
      then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
    };
    return builder;
  }

  const auth = {
    async getSession() {
      if (scenario === 'offline' && !currentSession) {
        return { data: { session: null }, error: { message: 'Failed to fetch' } };
      }
      if (scenario === 'expired') {
        return { data: { session: null }, error: null };
      }
      return { data: { session: currentSession }, error: null };
    },

    async signInWithPassword({ email, password: given }) {
      if (scenario === 'offline') {
        return { data: { session: null }, error: { message: 'Failed to fetch' } };
      }
      if (email !== user.email || given !== password) {
        return { data: { session: null }, error: { message: 'Invalid login credentials' } };
      }
      currentSession = session();
      try { localStorage.removeItem(SIGNED_OUT_KEY); } catch { /* ignore */ }
      emit('SIGNED_IN', currentSession);
      return { data: { session: currentSession, user }, error: null };
    },

    async signOut() {
      currentSession = null;
      try { localStorage.setItem(SIGNED_OUT_KEY, '1'); } catch { /* ignore */ }
      emit('SIGNED_OUT', null);
      return { error: null };
    },

    onAuthStateChange(listener) {
      authListeners.push(listener);
      return { data: { subscription: { unsubscribe: () => {} } } };
    },
  };

  window.supabase = {
    createClient: () => ({ from, auth }),
  };

  // Test hook: simulate the session dying while the app is open.
  window.__DONTDIE_EXPIRE__ = () => { currentSession = null; emit('TOKEN_REFRESHED', null); };
})();
