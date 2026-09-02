/* eslint-env browser */
// ============================================================
// SAVE FEEDBACK — one place that turns a RepositoryResult into user-visible
// wording, so every module says the same thing about the same outcome.
//
// A durable local write is the normal case and is SILENT: the sync chip in the
// shell already carries "saved on this device / syncing / synced". Only a
// genuine failure to store the change speaks up, because that is the one case
// where the user must not believe their edit is safe.
// ============================================================

import { showToast } from './toast.js';

/**
 * True when the change is safe: durably on this device, already in the cloud,
 * or coalesced into a write that is about to happen. Anything else means the
 * user must not be told it was saved.
 * @param {import('../data/types.js').RepositoryResult} result
 */
export function isPersisted(result) {
  const status = result && result.status;
  return status === 'local' || status === 'synced' || status === 'queued';
}

/** Tracks the last spoken failure per store so a broken device does not spam. */
const spoken = new Map();

/**
 * @param {string} label   human name of the store, e.g. 'Training split'
 * @param {import('../data/types.js').RepositoryResult} result
 */
export function reportSaveResult(label, result) {
  const status = result && result.status;

  if (status === 'local' || status === 'synced' || status === 'queued') {
    spoken.delete(label);
    return;
  }

  if (status === 'unavailable') {
    if (spoken.get(label) === 'unavailable') return;
    spoken.set(label, 'unavailable');
    showToast(`${label}: this device cannot store changes right now`, 'warning', 5000);
    return;
  }

  if (spoken.get(label) === 'error') return;
  spoken.set(label, 'error');
  console.error(`[save] ${label} failed:`, result && result.error);
  showToast(`${label}: change could not be saved`, 'warning', 5000);
}
