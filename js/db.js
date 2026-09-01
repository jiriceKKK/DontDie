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
    const { data, error } = await getSupabase()
      .from('custom_habits')
      .insert([{
        user_id: userId,
        name: habit.name,
        days: habit.days,
        color: habit.color || '#6ee7b7',
        active: true,
        sort_order: habit.sort_order || 0,
      }])
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
