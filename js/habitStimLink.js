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
export function syncHabitStimLink(dateStr, habitId, completed, { silent = false } = {}) {
  const link = getStimLink(habitId);
  if (!link) return;
  const ex = findActivity(link.activityId);
  if (!ex) return; // linked activity was deleted — nothing to mirror

  if (completed) {
    if (findHabitLinkEntries(dateStr, habitId).length) return; // already linked — don't double up
    addEntryFull(dateStr, currentBlockIndex(), {
      activityId: link.activityId,
      durationMinutes: Math.max(1, Number(link.durationMin) || ex.defaultDurationMinutes || 15),
      intensity: 1,
      source: 'habit_link',
      linkedHabitId: habitId,
      linkedHabitDate: dateStr,
    });
    if (!silent) showToast(`Added ${ex.name} to Stimulation`, 'success');
  } else {
    const removed = removeHabitLinkEntries(dateStr, habitId);
    if (removed && !silent) showToast('Removed linked Stimulation log', 'default');
  }
}
