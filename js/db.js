import { CONFIG } from './config.js';

let _supabase = null;

function getSupabase() {
  if (!_supabase) {
    _supabase = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  }
  return _supabase;
}

export async function dbCheckConnection() {
  try {
    const { error } = await getSupabase()
      .from('habit_logs')
      .select('id', { count: 'exact', head: true });
    return !error;
  } catch { return false; }
}

export async function dbGetLogsForDate(dateStr) {
  try {
    const { data, error } = await getSupabase()
      .from('habit_logs')
      .select('habit_id, completed')
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
  try {
    const { data, error } = await getSupabase()
      .from('habit_logs')
      .select('date, habit_id, completed')
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
  try {
    const { error } = await getSupabase()
      .from('habit_logs')
      .upsert(
        { date: dateStr, habit_id: habitId, completed, updated_at: new Date().toISOString() },
        { onConflict: 'date,habit_id' }
      );
    if (error) throw error;
    return { error: null };
  } catch (err) {
    console.error('[db] upsertLog:', err);
    return { error: err };
  }
}

export async function dbGetCustomHabits() {
  try {
    const { data, error } = await getSupabase()
      .from('custom_habits')
      .select('*')
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return { data: data || [], error: null };
  } catch (err) {
    console.error('[db] getCustomHabits:', err);
    return { data: [], error: err };
  }
}

export async function dbCreateCustomHabit(habit) {
  try {
    const { data, error } = await getSupabase()
      .from('custom_habits')
      .insert([{
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
  try {
    const { error } = await getSupabase()
      .from('custom_habits')
      .update(updates)
      .eq('id', id);
    if (error) throw error;
    return { error: null };
  } catch (err) {
    console.error('[db] updateCustomHabit:', err);
    return { error: err };
  }
}

export async function dbDeleteCustomHabit(id) {
  try {
    const { error } = await getSupabase()
      .from('custom_habits')
      .delete()
      .eq('id', id);
    if (error) throw error;
    return { error: null };
  } catch (err) {
    console.error('[db] deleteCustomHabit:', err);
    return { error: err };
  }
}

export async function dbDeleteAllLogs() {
  try {
    const { error } = await getSupabase()
      .from('habit_logs')
      .delete()
      .gte('date', '1970-01-01');
    if (error) throw error;
    return { error: null };
  } catch (err) {
    console.error('[db] deleteAllLogs:', err);
    return { error: err };
  }
}

export async function dbExportAll() {
  try {
    const [logsRes, habitsRes] = await Promise.all([
      getSupabase().from('habit_logs').select('*').order('date', { ascending: true }),
      getSupabase().from('custom_habits').select('*'),
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
