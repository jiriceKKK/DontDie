/* eslint-env browser */
// ============================================================
// SYNC STATUS — one compact affordance in the persistent shell plus the dark
// conflict-recovery sheet behind it.
//
// The point is that "saved" is never ambiguous. `saved locally`, `syncing`,
// `offline — saved on this device`, `synced`, `conflict` and
// `sync failed — retrying` are distinct states with distinct wording. Idle is
// quiet: no spinner, no toast for a successful background sync.
// ============================================================

import { escapeHtml } from './dom.js';
import { openModal, closeModal } from './modal.js';
import { showToast } from './toast.js';
import { downloadFile } from '../export/download.js';
import {
  onSyncStateChanged, listConflicts, adoptDocument, persistDocument, rebaseDocument, currentOwner, outboxSize,
} from '../data/repository.js';
import { onConflictsChanged, resolveConflict, conflictExport } from '../data/conflicts.js';
import { releaseOperations, discardOperations, flush } from '../data/reconcile.js';

const LABELS = {
  synced: { text: 'Synced', tone: 'ok' },
  'saved-local': { text: 'Saved on this device', tone: 'pending' },
  syncing: { text: 'Syncing', tone: 'pending' },
  offline: { text: 'Offline — saved on this device', tone: 'warn' },
  conflict: { text: 'Needs your choice', tone: 'alert' },
  failed: { text: 'Sync failed — retrying', tone: 'alert' },
};

let _chip = null;
let _state = 'synced';
let _conflicts = 0;

function ensureChip() {
  if (_chip && document.body.contains(_chip)) return _chip;
  const existing = document.getElementById('sync-status');
  if (existing) { _chip = existing; return _chip; }
  const chip = document.createElement('button');
  chip.id = 'sync-status';
  chip.className = 'sync-status';
  chip.type = 'button';
  chip.hidden = true;
  chip.innerHTML = '<span class="sync-status-dot" aria-hidden="true"></span><span class="sync-status-text" id="sync-status-text"></span>';
  chip.addEventListener('click', () => { openRecoverySheet(); });
  // Fixed to the viewport rather than nested in the header: on mobile the
  // header is hidden entirely now that the mode pill has gone.
  document.body.appendChild(chip);
  _chip = chip;
  return chip;
}

function paint() {
  const chip = ensureChip();
  const label = LABELS[_state] || LABELS.synced;
  const text = _conflicts > 0
    ? (_conflicts === 1 ? 'Needs your choice' : `${_conflicts} need your choice`)
    : label.text;
  const tone = _conflicts > 0 ? 'alert' : label.tone;

  chip.dataset.tone = tone;
  chip.dataset.state = _conflicts > 0 ? 'conflict' : _state;
  const textNode = chip.querySelector('.sync-status-text');
  if (textNode) textNode.textContent = text;
  chip.setAttribute('aria-label', `Sync status: ${text}`);
  chip.title = text;
  // Quiet when everything is fine and nothing needs attention.
  chip.hidden = tone === 'ok' && _conflicts === 0;
}

/** Wire the chip to the reconciler. Safe to call once at startup. */
export function initSyncStatus() {
  ensureChip();
  onSyncStateChanged(state => { _state = state; paint(); });
  onConflictsChanged(count => { _conflicts = count; paint(); });
  refreshConflicts();
  paint();
}

async function refreshConflicts() {
  const owner = currentOwner();
  if (!owner) return;
  try {
    _conflicts = (await listConflicts(owner)).length;
    paint();
  } catch { /* the chip is a convenience, never a failure path */ }
}

function when(iso) {
  if (!iso) return 'unknown time';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'unknown time';
  return date.toLocaleString();
}

const STORE_LABELS = {
  split: 'Training split',
  mental: 'Mind',
  mindTexts: 'Mind · Texts',
  stimulation: 'Stimulation',
  school: 'School',
  habitConfig: 'Habit settings',
};

/** The dark recovery sheet. Both copies stay available until a choice is made. */
export async function openRecoverySheet() {
  const owner = currentOwner();
  const conflicts = owner ? await listConflicts(owner) : [];
  const queued = await outboxSize();

  if (conflicts.length === 0) {
    const summary = queued > 0
      ? `${queued} change${queued === 1 ? '' : 's'} saved on this device and waiting for the cloud.`
      : 'Everything on this device matches the cloud.';
    openModal(`<p class="sync-sheet-note">${escapeHtml(summary)}</p>
      <button class="btn-secondary" id="sync-retry-now" type="button">Sync now</button>`, 'Sync');
    const retry = document.getElementById('sync-retry-now');
    if (retry) retry.addEventListener('click', () => { flush(); showToast('Syncing…', 'default'); closeModal(); });
    return;
  }

  const html = conflicts.map(conflict => {
    const name = STORE_LABELS[conflict.storeId] || conflict.entity;
    return `<div class="sync-conflict" data-conflict="${escapeHtml(conflict.id)}">
      <div class="sync-conflict-title">${escapeHtml(name)}</div>
      <div class="sync-conflict-meta">This device: ${escapeHtml(when(conflict.localUpdatedAt))}</div>
      <div class="sync-conflict-meta">Cloud: ${escapeHtml(when(conflict.remoteUpdatedAt))}</div>
      <div class="sync-conflict-actions">
        <button class="btn-secondary" type="button" data-conflict-action="download">Download both</button>
        <button class="btn-secondary" type="button" data-conflict-action="cloud">Use cloud</button>
        <button class="btn-primary" type="button" data-conflict-action="local">Keep this device</button>
      </div>
    </div>`;
  }).join('');

  openModal(`<p class="sync-sheet-note">Both versions are kept until you choose. Nothing has been overwritten.</p>${html}`, 'Recover changes');

  document.querySelectorAll('[data-conflict]').forEach(row => {
    row.addEventListener('click', async event => {
      const button = event.target.closest('[data-conflict-action]');
      if (!button) return;
      const id = row.dataset.conflict;
      const conflict = conflicts.find(c => c.id === id);
      if (!conflict) return;
      await applyChoice(conflict, button.dataset.conflictAction);
    });
  });
}

async function applyChoice(conflict, action) {
  if (action === 'download') {
    const safe = String(conflict.storeId || conflict.entity).replace(/[^a-z0-9]+/gi, '-');
    downloadFile(`dontdie-conflict-${safe}.json`, JSON.stringify(conflictExport(conflict), null, 2), 'application/json');
    showToast('Both versions downloaded', 'success');
    return;
  }

  if (action === 'cloud') {
    await discardOperations(conflict.kind, conflict.entity);
    await adoptDocument(conflict.storeId, conflict.remoteData, conflict.remoteRevision, conflict.remoteUpdatedAt);
    await resolveConflict(conflict.id, conflict.userId);
    closeModal();
    showToast('Using the cloud version — reloading', 'default');
    setTimeout(() => window.location.reload(), 400);
    return;
  }

  if (action === 'local') {
    // Re-base this device's copy on the revision we have now seen, then let the
    // parked operation run again. The cloud copy stays in the download above.
    await rebaseDocument(conflict.storeId, conflict.remoteRevision);
    await releaseOperations(conflict.kind, conflict.entity, conflict.remoteRevision);
    await persistDocument(conflict.storeId, conflict.localData);
    await resolveConflict(conflict.id, conflict.userId);
    closeModal();
    showToast('Keeping this device’s version', 'success');
    flush();
  }
}
