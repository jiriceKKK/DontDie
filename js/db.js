// ============================================================
// Supabase data access.
//
// Every statement here is owner-scoped twice over:
//   1. explicitly — reads/updates/deletes filter on `user_id`, inserts stamp
//      `user_id = session.user.id`;
//   2. server-side — Row Level Security allows a row only when
//      `auth.uid() = user_id` (supabase/migrations/001_owner_auth_and_rls.sql).
//
// The explicit filter is defence in depth and keeps queries honest; RLS is the
// boundary. There is no anonymous fallback: if no session is active the call
// fails fast with an auth-required error and never touches the network.
// ============================================================

import { getSupabase } from './supabaseClient.js';
import { requireUserId, AuthRequiredError } from './session.js';

/** JSON-document tables keyed `(user_id, id)` with `id = 1` per owner. */
const DOC_ROW_ID = 1;
const DOC_CONFLICT = 'user_id,id';

/**
 * Resolve the current owner id, or return a uniform failure shape.
 * @returns {{ userId: string|null, error: AuthRequiredError|null }}
 */
function owner() {
  try {
    return { userId: requireUserId(), error: null };
  } catch (err) {
    if (err instanceof AuthRequiredError) return { userId: null, error: err };
    throw err;
  }
}

/** Single place that reports an operation needing a session. */
function authFailure(operation, fallbackData) {
  const error = new AuthRequiredError(`${operation} requires a signed-in owner`);
  console.warn(`[db] ${operation}: no active session — request not sent`);
  return fallbackData === undefined ? { error } : { data: fallbackData, error };
}

// ---- connection -----------------------------------------------------------
/** True when an authenticated round-trip to the owner's rows succeeds. */
export async function dbCheckConnection() {
  const { userId } = owner();
  if (!userId) return false;
  try {
    const { error } = await getSupabase()
      .from('habit_logs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);
    return !error;
  } catch { return false; }
}

// ---- habit logs -----------------------------------------------------------
export async function dbGetLogsForDate(dateStr) {
  const { userId } = owner();
  if (!userId) return authFailure('getLogsForDate', {});
  try {
    const { data, error } = await getSupabase()
      .from('habit_logs')
      .select('habit_id, completed')
      .eq('user_id', userId)
      .eq('date', dateStr);
    if (error) throw error;
    const map = {};
    for (const row of (data || [])) map[row.habit_id] = row.completed;
    return { data: map, error: null };
  } catch (err) {
    console.error('[db] getLogsForDate:', err);
    return { data: {}, error: err };
  }
}

export async function dbGetLogsForRange(startDateStr, endDateStr) {
  const { userId } = owner();
  if (!userId) return authFailure('getLogsForRange', {});
  try {
    const { data, error } = await getSupabase()
      .from('habit_logs')
      .select('date, habit_id, completed')
      .eq('user_id', userId)
      .gte('date', startDateStr)
      .lte('date', endDateStr);
    if (error) throw error;
    const map = {};
    for (const row of (data || [])) {
      if (!map[row.date]) map[row.date] = {};
      map[row.date][row.habit_id] = row.completed;
    }
    return { data: map, error: null };
  } catch (err) {
    console.error('[db] getLogsForRange:', err);
    return { data: {}, error: err };
  }
}

export async function dbUpsertLog(dateStr, habitId, completed) {
  const { userId } = owner();
  if (!userId) return authFailure('upsertLog');
  try {
    const { error } = await getSupabase()
      .from('habit_logs')
      .upsert(
        { user_id: userId, date: dateStr, habit_id: habitId, completed, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,date,habit_id' }
      );
    if (error) throw error;
    return { error: null };
  } catch (err) {
    console.error('[db] upsertLog:', err);
    return { error: err };
  }
}

export async function dbDeleteAllLogs() {
  const { userId } = owner();
  if (!userId) return authFailure('deleteAllLogs');
  try {
    const { error } = await getSupabase()
      .from('habit_logs')
      .delete()
      .eq('user_id', userId)
      .gte('date', '1970-01-01');
    if (error) throw error;
    return { error: null };
  } catch (err) {
    console.error('[db] deleteAllLogs:', err);
    return { error: err };
  }
}

// ---- custom habits --------------------------------------------------------
export async function dbGetCustomHabits() {
  const { userId } = owner();
  if (!userId) return authFailure('getCustomHabits', []);
  try {
    const { data, error } = await getSupabase()
      .from('custom_habits')
      .select('*')
      .eq('user_id', userId)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return { data: data || [], error: null };
  } catch (err) {
    console.error('[db] getCustomHabits:', err);
    return { data: [], error: err };
  }
}

export async function dbCreateCustomHabit(habit) {
  const { userId } = owner();
  if (!userId) return authFailure('createCustomHabit', null);
  try {
    // A client-generated id makes the insert idempotent: a retry after an
    // unacknowledged success upserts the same row instead of creating a twin.
    const row = {
      user_id: userId,
      name: habit.name,
      days: habit.days,
      color: habit.color || '#6ee7b7',
      active: habit.active === undefined ? true : !!habit.active,
      sort_order: habit.sort_order || 0,
    };
    if (habit.id) row.id = habit.id;
    const { data, error } = await getSupabase()
      .from('custom_habits')
      .upsert([row], { onConflict: 'id' })
      .select()
      .single();
    if (error) throw error;
    return { data, error: null };
  } catch (err) {
    console.error('[db] createCustomHabit:', err);
    return { data: null, error: err };
  }
}

export async function dbUpdateCustomHabit(id, updates) {
  const { userId } = owner();
  if (!userId) return authFailure('updateCustomHabit');
  try {
    // `user_id` is never updatable from the client — strip it defensively so a
    // caller cannot hand a row to another account.
    const { user_id: _ignored, ...safeUpdates } = updates || {};
    const { error } = await getSupabase()
      .from('custom_habits')
      .update(safeUpdates)
      .eq('user_id', userId)
      .eq('id', id);
    if (error) throw error;
    return { error: null };
  } catch (err) {
    console.error('[db] updateCustomHabit:', err);
    return { error: err };
  }
}

export async function dbDeleteCustomHabit(id) {
  const { userId } = owner();
  if (!userId) return authFailure('deleteCustomHabit');
  try {
    const { error } = await getSupabase()
      .from('custom_habits')
      .delete()
      .eq('user_id', userId)
      .eq('id', id);
    if (error) throw error;
    return { error: null };
  } catch (err) {
    console.error('[db] deleteCustomHabit:', err);
    return { error: err };
  }
}

// ---- JSON document stores -------------------------------------------------
// One row per owner (`user_id`, `id = 1`). Every store follows the same
// graceful pattern: a missing table returns null so the feature keeps working
// from localStorage instead of breaking startup.

async function getDoc(table, label) {
  const { userId } = owner();
  if (!userId) return authFailure(label, null);
  try {
    const { data, error } = await getSupabase()
      .from(table)
      .select('data')
      .eq('user_id', userId)
      .eq('id', DOC_ROW_ID)
      .maybeSingle();
    if (error) throw error;
    return { data: data ? data.data : null, error: null };
  } catch (err) {
    console.error(`[db] ${label}:`, err);
    return { data: null, error: err };
  }
}

async function saveDoc(table, label, payload) {
  const { userId } = owner();
  if (!userId) return authFailure(label);
  try {
    const { error } = await getSupabase()
      .from(table)
      .upsert(
        { user_id: userId, id: DOC_ROW_ID, data: payload, updated_at: new Date().toISOString() },
        { onConflict: DOC_CONFLICT }
      );
    if (error) throw error;
    return { error: null };
  } catch (err) {
    console.error(`[db] ${label}:`, err);
    return { error: err };
  }
}

export const dbGetSplitConfig       = () => getDoc('split_config', 'getSplitConfig');
export const dbSaveSplitConfig      = d  => saveDoc('split_config', 'saveSplitConfig', d);

export const dbGetMentalStore       = () => getDoc('mh_store', 'getMentalStore');
export const dbSaveMentalStore      = d  => saveDoc('mh_store', 'saveMentalStore', d);

// Optional table: Texts works fully from localStorage when it is absent.
export const dbGetMindTextsStore    = () => getDoc('mind_texts_store', 'getMindTextsStore');
export const dbSaveMindTextsStore   = d  => saveDoc('mind_texts_store', 'saveMindTextsStore', d);

export const dbGetStimulationStore  = () => getDoc('stimulation_store', 'getStimulationStore');
export const dbSaveStimulationStore = d  => saveDoc('stimulation_store', 'saveStimulationStore', d);

export const dbGetSchoolStore       = () => getDoc('school_store', 'getSchoolStore');
export const dbSaveSchoolStore      = d  => saveDoc('school_store', 'saveSchoolStore', d);

export const dbGetHabitConfig       = () => getDoc('habit_config', 'getHabitConfig');
export const dbSaveHabitConfig      = c  => saveDoc('habit_config', 'saveHabitConfig', c);

// ---- revision-aware document access (Phase 2) -----------------------------
// Migration 002 gives every JSON document table a server-maintained
// `revision` and `updated_at`. Writes are compare-and-set: the client states
// the revision it based its edit on, and the server applies the update only
// while that is still current. Zero rows back means the cloud moved on, which
// the repository turns into a recoverable conflict rather than an overwrite.

/** True when the failure means the table is not installed at all. */
export function isMissingTableError(err) {
  if (!err) return false;
  const code = String(err.code || '');
  const message = String(err.message || '');
  return code === '42P01' || code === 'PGRST205' || /does not exist|schema cache/i.test(message);
}

/**
 * Read a document plus its revision metadata.
 * @returns {Promise<{data: any, error: any, missing?: boolean}>}
 */
export async function dbGetDocumentRevisioned(table) {
  const { userId } = owner();
  if (!userId) {
    const failure = authFailure('getDocument:' + table, null);
    return { data: null, error: failure.error };
  }
  try {
    const { data, error } = await getSupabase()
      .from(table)
      .select('data, revision, updated_at')
      .eq('user_id', userId)
      .eq('id', DOC_ROW_ID)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { data: null, error: null };
    return {
      data: {
        data: data.data,
        revision: data.revision === undefined || data.revision === null ? null : Number(data.revision),
        updatedAt: data.updated_at || null,
      },
      error: null,
    };
  } catch (err) {
    if (isMissingTableError(err)) return { data: null, error: null, missing: true };
    console.error('[db] getDocument:' + table + ':', err);
    return { data: null, error: err };
  }
}

/**
 * Compare-and-set update. A null `expectedRevision` means "no row yet", so the
 * insert path is used instead.
 * @returns {Promise<{applied: boolean, revision: number|null, error: any, missing?: boolean}>}
 */
export async function dbWriteDocumentRevisioned(table, payload, expectedRevision) {
  const { userId } = owner();
  if (!userId) {
    const failure = authFailure('writeDocument:' + table);
    return { applied: false, revision: null, error: failure.error };
  }
  try {
    if (expectedRevision === null || expectedRevision === undefined) {
      const { data, error } = await getSupabase()
        .from(table)
        .insert([{ user_id: userId, id: DOC_ROW_ID, data: payload }])
        .select('revision');
      if (error) {
        // 23505 = the row already exists, so the "no row yet" assumption was
        // stale rather than wrong-headed. Report not-applied so the caller
        // refreshes the revision and retries instead of losing the edit.
        if (String(error.code) === '23505') return { applied: false, revision: null, error: null };
        throw error;
      }
      const revision = data && data[0] ? Number(data[0].revision) : null;
      return { applied: true, revision, error: null };
    }

    const { data, error } = await getSupabase()
      .from(table)
      .update({ data: payload })
      .eq('user_id', userId)
      .eq('id', DOC_ROW_ID)
      .eq('revision', expectedRevision)
      .select('revision');
    if (error) throw error;
    if (!data || data.length === 0) return { applied: false, revision: null, error: null };
    return { applied: true, revision: Number(data[0].revision), error: null };
  } catch (err) {
    if (isMissingTableError(err)) return { applied: false, revision: null, error: null, missing: true };
    console.error('[db] writeDocument:' + table + ':', err);
    return { applied: false, revision: null, error: err };
  }
}

/** Every habit log for the owner, paged so a long history is complete. */
export async function dbGetAllLogsPaged(pageSize = 1000) {
  const { userId } = owner();
  if (!userId) return authFailure('getAllLogsPaged', {});
  const map = {};
  try {
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await getSupabase()
        .from('habit_logs')
        .select('date, habit_id, completed')
        .eq('user_id', userId)
        .order('date', { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      const rows = data || [];
      for (const row of rows) {
        if (!map[row.date]) map[row.date] = {};
        map[row.date][row.habit_id] = row.completed;
      }
      if (rows.length < pageSize) break;
    }
    return { data: map, error: null };
  } catch (err) {
    console.error('[db] getAllLogsPaged:', err);
    return { data: map, error: err };
  }
}

// ---- export ---------------------------------------------------------------
export async function dbExportAll() {
  const { userId } = owner();
  if (!userId) return authFailure('exportAll', null);
  try {
    const [logsRes, habitsRes] = await Promise.all([
      getSupabase().from('habit_logs').select('*').eq('user_id', userId).order('date', { ascending: true }),
      getSupabase().from('custom_habits').select('*').eq('user_id', userId),
    ]);
    if (logsRes.error)   throw logsRes.error;
    if (habitsRes.error) throw habitsRes.error;
    return {
      data: {
        exported_at: new Date().toISOString(),
        habit_logs: logsRes.data,
        custom_habits: habitsRes.data,
      },
      error: null,
    };
  } catch (err) {
    console.error('[db] exportAll:', err);
    return { data: null, error: err };
  }
}
