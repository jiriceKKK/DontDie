// ============================================================
// HABIT -> STIMULATION LINK — completing a linked habit creates a Stimulation
// log entry (source:'habit_link'); unticking removes exactly that entry and
// never touches manual logs. Kept tiny and dependency-light so toggleHabit can
// call it without import cycles (stimulation store + habitConfig only).
// ============================================================

import { getStimLink } from './habitConfig.js';
import {
  findActivity, findHabitLinkEntries, addEntryFull, removeHabitLinkEntries, currentBlockIndex,
} from './stimulation/store.js';
import { showToast } from './ui/toast.js';

// Bring the linked Stimulation log in line with the habit's completion state.
//   completed=true  -> add one entry in the current time block (no duplicate)
//   completed=false -> remove the habit's linked entries for that date
// `silent` suppresses toasts (used when reverting after a failed sync).
// `defer` skips the stimulation document's own save so the caller can persist
// the habit log and the linked document in ONE transaction. Returns true when
// the stimulation document actually changed.
export function syncHabitStimLink(dateStr, habitId, completed, { silent = false, defer = false } = {}) {
  const link = getStimLink(habitId);
  if (!link) return false;
  const ex = findActivity(link.activityId);
  if (!ex) return false; // linked activity was deleted — nothing to mirror

  if (completed) {
    if (findHabitLinkEntries(dateStr, habitId).length) return false; // already linked — don't double up
    addEntryFull(dateStr, currentBlockIndex(), {
      activityId: link.activityId,
      durationMinutes: Math.max(1, Number(link.durationMin) || ex.defaultDurationMinutes || 15),
      intensity: 1,
      source: 'habit_link',
      linkedHabitId: habitId,
      linkedHabitDate: dateStr,
    }, { defer });
    if (!silent) showToast(`Added ${ex.name} to Stimulation`, 'success');
    return true;
  }

  const removed = removeHabitLinkEntries(dateStr, habitId, { defer });
  if (removed && !silent) showToast('Removed linked Stimulation log', 'default');
  return removed > 0;
}

// Derive the linked stimulation state from the durable habit state. Called at
// startup and after a flush so a failure that separated the two halves of one
// action converges instead of leaving an orphan entry.
export function reconcileHabitStimLinks(logsByDate) {
  let changed = false;
  for (const [dateStr, habits] of Object.entries(logsByDate || {})) {
    for (const [habitId, completed] of Object.entries(habits)) {
      if (!getStimLink(habitId)) continue;
      const linked = findHabitLinkEntries(dateStr, habitId).length > 0;
      if (!!completed === linked) continue;
      if (syncHabitStimLink(dateStr, habitId, !!completed, { silent: true, defer: true })) changed = true;
    }
  }
  return changed;
}
