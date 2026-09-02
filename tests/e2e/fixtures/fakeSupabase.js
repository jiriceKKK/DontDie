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
// Phase 2 made it STATEFUL, because "offline, then reconnect, then converge"
// cannot be tested against a client that forgets every write:
//   * rows live in a mutable table map; insert/upsert/update/delete apply;
//   * document tables maintain `revision` and `updated_at` exactly the way
//     supabase/migrations/002 does server-side, so a compare-and-set that is
//     guarded by a stale revision matches ZERO rows here too;
//   * window.__DONTDIE_NET__ toggles connectivity at runtime;
//   * window.__DONTDIE_CLOUD__ lets a test act as a second device.
//
// Behaviour is driven by window.__DONTDIE_FAKE__, seeded per test:
//   scenario : 'signed-out' | 'signed-in' | 'expired' | 'offline'
//   user     : { id, email }
//   password : the password signIn() accepts
//   rows     : { <table>: [ ...rows ] }
//
// Every query records itself into window.__DONTDIE_QUERIES__ so a test can
// assert that requests were owner-scoped, ordered, or never made at all.
// ============================================================================
(() => {
  const config = window.__DONTDIE_FAKE__ || {};
  const scenario = config.scenario || 'signed-out';
  const user = config.user || { id: 'e2e-owner-0000-4000-8000-000000000001', email: 'owner@example.invalid' };
  const password = config.password || 'correct horse battery';

  const DOCUMENT_TABLES = new Set([
    'split_config', 'mh_store', 'stimulation_store', 'school_store', 'mind_texts_store', 'habit_config',
  ]);
  // Mirrors production: habit_config is NOT installed.
  const INSTALLED = new Set(config.installedTables || [
    'habit_logs', 'custom_habits', 'split_config', 'mh_store',
    'stimulation_store', 'school_store', 'mind_texts_store',
  ]);

  // Mutable table state. Seeded from `rows`, then genuinely written to — and
  // PERSISTED across reloads. addInitScript re-runs on every navigation, so
  // without this the "cloud" would forget every write the moment the app
  // reloaded, and a reload test would be measuring the fixture rather than the
  // app. sessionStorage is per-tab, so tests stay isolated from each other.
  const TABLES_KEY = '__dontdie_fake_tables';
  const tables = (() => {
    try {
      const stored = sessionStorage.getItem(TABLES_KEY);
      if (stored) return JSON.parse(stored);
    } catch { /* fall through to the seed */ }
    const seeded = {};
    for (const [name, rows] of Object.entries(config.rows || {})) {
      seeded[name] = rows.map(row => ({ ...row }));
    }
    return seeded;
  })();

  let persistHandle = 0;
  function persistTables() {
    if (persistHandle) return;
    persistHandle = setTimeout(() => {
      persistHandle = 0;
      try { sessionStorage.setItem(TABLES_KEY, JSON.stringify(tables)); } catch { /* quota */ }
    }, 0);
  }
  window.addEventListener('beforeunload', () => {
    try { sessionStorage.setItem(TABLES_KEY, JSON.stringify(tables)); } catch { /* quota */ }
  });

  const rowsOf = name => (tables[name] || (tables[name] = []));

  // Real PostgREST hands back fresh JSON every time. A shallow copy would share
  // the nested `data` object with the stored row, so the app mutating its own
  // in-memory copy would silently mutate the "cloud" — and every conflict test
  // would pass for the wrong reason.
  const clone = value => (typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value)));

  window.__DONTDIE_QUERIES__ = [];
  window.__DONTDIE_NET__ = scenario === 'offline' ? 'down' : 'up';

  const nowIso = () => new Date().toISOString();
  let uidCounter = 0;
  const uid = () => `fake-${++uidCounter}`;

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

  const offline = () => window.__DONTDIE_NET__ === 'down';

  function matches(row, filters) {
    return filters.every(([op, column, value]) => {
      const cell = row[column];
      if (op === 'eq') return String(cell) === String(value);
      if (op === 'gte') return String(cell) >= String(value);
      if (op === 'lte') return String(cell) <= String(value);
      return true;
    });
  }

  /** The BEFORE INSERT/UPDATE trigger from migration 002, in JavaScript. */
  function touchInsert(table, row) {
    if (!DOCUMENT_TABLES.has(table)) return row;
    row.revision = 1;
    row.updated_at = nowIso();
    return row;
  }
  function touchUpdate(table, row) {
    if (!DOCUMENT_TABLES.has(table)) return row;
    row.revision = Number(row.revision || 0) + 1;
    row.updated_at = nowIso();
    return row;
  }

  function conflictKeys(table, options) {
    const onConflict = options && options.onConflict;
    if (onConflict) return String(onConflict).split(',').map(s => s.trim());
    return DOCUMENT_TABLES.has(table) ? ['user_id', 'id'] : ['id'];
  }

  function from(table) {
    const record = { table, filters: [], op: null, payload: null, at: Date.now() };
    window.__DONTDIE_QUERIES__.push(record);

    const failOffline = () => ({ data: null, error: { message: 'Failed to fetch', name: 'TypeError' } });
    const failMissing = () => ({
      data: null,
      error: { message: `relation "public.${table}" does not exist`, code: '42P01' },
    });
    const failRls = () => ({
      data: null,
      error: { message: 'new row violates row-level security policy', code: '42501' },
    });

    function apply() {
      if (offline()) return failOffline();
      if (!INSTALLED.has(table)) return failMissing();
      if (!currentSession) {
        // What real RLS looks like from the client: reads return nothing,
        // writes are refused.
        return record.op === 'select' ? { data: [], error: null } : failRls();
      }

      const rows = rowsOf(table);

      if (record.op === 'select') {
        let visible = rows.filter(row => matches(row, record.filters)).map(clone);
        if (record.range) visible = visible.slice(record.range[0], record.range[1] + 1);
        return { data: visible, error: null };
      }

      if (record.op === 'insert' || record.op === 'upsert') {
        const incoming = Array.isArray(record.payload) ? record.payload : [record.payload];
        const keys = conflictKeys(table, record.options);
        const written = [];
        for (const raw of incoming) {
          const candidate = clone(raw);
          if (candidate.user_id && candidate.user_id !== user.id) return failRls();
          const existing = rows.find(row => keys.every(key =>
            candidate[key] !== undefined && String(row[key]) === String(candidate[key])));
          if (existing) {
            if (record.op === 'insert') {
              return { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } };
            }
            Object.assign(existing, candidate);
            touchUpdate(table, existing);
            written.push(clone(existing));
          } else {
            if (!candidate.id) candidate.id = uid();
            if (!candidate.user_id) candidate.user_id = user.id;
            touchInsert(table, candidate);
            rows.push(candidate);
            written.push(clone(candidate));
          }
        }
        persistTables();
        return { data: written, error: null };
      }

      if (record.op === 'update') {
        const targets = rows.filter(row => matches(row, record.filters));
        for (const row of targets) {
          const { user_id: _ignored, revision: _rev, ...safe } = clone(record.payload || {});
          Object.assign(row, safe);
          touchUpdate(table, row);
        }
        persistTables();
        return { data: targets.map(clone), error: null };
      }

      if (record.op === 'delete') {
        const survivors = [];
        const removed = [];
        for (const row of rows) (matches(row, record.filters) ? removed : survivors).push(row);
        tables[table] = survivors;
        persistTables();
        return { data: removed.map(clone), error: null };
      }

      return { data: [], error: null };
    }

    const builder = {
      select(columns) { record.op = record.op || 'select'; record.columns = columns; return builder; },
      insert(payload) { record.op = 'insert'; record.payload = payload; return builder; },
      upsert(payload, options) { record.op = 'upsert'; record.payload = payload; record.options = options; record.conflict = options?.onConflict; return builder; },
      update(payload) { record.op = 'update'; record.payload = payload; return builder; },
      delete() { record.op = 'delete'; return builder; },
      order() { return builder; },
      range(from_, to) { record.range = [from_, to]; return builder; },
      eq(column, value) { record.filters.push(['eq', column, value]); return builder; },
      gte(column, value) { record.filters.push(['gte', column, value]); return builder; },
      lte(column, value) { record.filters.push(['lte', column, value]); return builder; },
      single() { const r = apply(); return Promise.resolve({ data: (r.data || [])[0] ?? null, error: r.error }); },
      maybeSingle() { const r = apply(); return Promise.resolve({ data: (r.data || [])[0] ?? null, error: r.error }); },
      then(resolve, reject) { return Promise.resolve(apply()).then(resolve, reject); },
    };
    return builder;
  }

  const auth = {
    async getSession() {
      if (offline() && !currentSession) {
        return { data: { session: null }, error: { message: 'Failed to fetch' } };
      }
      if (scenario === 'expired') {
        return { data: { session: null }, error: null };
      }
      return { data: { session: currentSession }, error: null };
    },

    async signInWithPassword({ email, password: given }) {
      if (offline()) {
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

  // Test hooks for acting on the cloud the way a SECOND DEVICE would.
  window.__DONTDIE_CLOUD__ = {
    /** Read a document row as stored server-side. */
    read(table) {
      const row = rowsOf(table).find(r => String(r.user_id) === String(user.id) && String(r.id) === '1');
      return row ? clone(row) : null;
    },
    /** Write a document as another device, bumping the revision like the trigger. */
    write(table, data) {
      const rows = rowsOf(table);
      let row = rows.find(r => String(r.user_id) === String(user.id) && String(r.id) === '1');
      if (!row) {
        row = touchInsert(table, { user_id: user.id, id: 1, data: clone(data) });
        rows.push(row);
        persistTables();
        return clone(row);
      }
      row.data = clone(data);
      touchUpdate(table, row);
      persistTables();
      return clone(row);
    },
    rows(table) { return rowsOf(table).map(clone); },
    /** Every write this client sent, in order. */
    writes() {
      return window.__DONTDIE_QUERIES__
        .filter(q => q.op && q.op !== 'select')
        .map(q => ({ table: q.table, op: q.op, at: q.at }));
    },
  };
})();
