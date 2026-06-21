import { openModal, closeModal } from '../../ui/modal.js';
import { showToast } from '../../ui/toast.js';
import { getSettings, updateSettings, resetStimulation, updateActivity } from '../store.js';
import { openScreenTimeImport } from './importScreen.js';
import { getAllAppMappings, setAppMapping, deleteAppMapping, CLASS_OPTIONS } from '../screenTime.js';

const escS = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MAP_LABEL = id => (CLASS_OPTIONS.find(o => o.id === id) || {}).label || id;

export function renderStimSettings() {
  const panel = document.getElementById('tab-settings');
  if (!panel) return;
  const s = getSettings();

  panel.innerHTML = `
    <div class="mh-header">
      <div class="mh-title">Settings</div>
      <div class="mh-subtitle">Time blocks & baseline</div>
    </div>

    <div class="card">
      <form id="stim-set-form" class="settings-form" style="margin-bottom:0;">
        <div class="form-row">
          <div class="form-group"><label class="form-label">Day start (hour)</label>
            <input class="form-input" id="ss-start" type="number" inputmode="numeric" min="0" max="23" value="${s.dayStartHour}"></div>
          <div class="form-group"><label class="form-label">Day end (hour)</label>
            <input class="form-input" id="ss-end" type="number" inputmode="numeric" min="1" max="24" value="${s.dayEndHour}"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Block size (min)</label>
            <input class="form-input" id="ss-block" type="number" inputmode="numeric" min="30" max="240" step="30" value="${s.blockMinutes}"></div>
          <div class="form-group"><label class="form-label">Baseline window (days)</label>
            <input class="form-input" id="ss-base" type="number" inputmode="numeric" min="1" max="60" value="${s.baselineWindowDays}"></div>
        </div>
        <button type="submit" class="btn btn-primary" style="width:100%;">Save settings</button>
      </form>
    </div>

    <div class="section-title">Screen Time</div>
    <div class="card">
      <button class="btn btn-primary" id="stim-import-settings" style="width:100%;justify-content:center;gap:8px;">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>
        Import Screen Time
      </button>
      <div class="mh-empty" style="text-align:left;font-size:12px;margin-top:10px;">
        Paste your iPhone Screen Time totals. Imports are treated as snapshots — re-importing only adds new minutes, never double-counts.
      </div>
      ${mappingsHtml()}
    </div>

    <div class="section-title">Data</div>
    <div class="card data-actions">
      <button class="btn btn-danger" id="stim-reset" style="width:100%;justify-content:flex-start;gap:10px;">Reset stimulation data</button>
    </div>

    <div class="mh-empty" style="text-align:left;font-size:12px;">
      Stimulation is an estimate from your logged activities — not a medical or biological measurement.
    </div>
  `;

  panel.querySelector('#stim-set-form').addEventListener('submit', (e) => {
    e.preventDefault();
    updateSettings({
      dayStartHour: parseInt(panel.querySelector('#ss-start').value),
      dayEndHour: parseInt(panel.querySelector('#ss-end').value),
      blockMinutes: parseInt(panel.querySelector('#ss-block').value),
      baselineWindowDays: parseInt(panel.querySelector('#ss-base').value),
    });
    showToast('Settings saved', 'success');
    renderStimSettings();
  });

  panel.querySelector('#stim-import-settings').addEventListener('click', () => openScreenTimeImport({ onDone: renderStimSettings }));

  // Remembered app mappings: change category (updates the app's activity too) or forget.
  panel.querySelectorAll('select[data-mapkey]').forEach(sel => sel.addEventListener('change', () => {
    const key = sel.dataset.mapkey, cat = sel.value;
    const m = getAllAppMappings().find(x => x.key === key);
    setAppMapping(key, { category: cat, userConfirmed: true });
    if (m && m.activityId && cat !== 'ignored') updateActivity(m.activityId, { category: cat });
    showToast('Mapping updated', 'success');
    renderStimSettings();
  }));
  panel.querySelectorAll('[data-mapdel]').forEach(b => b.addEventListener('click', () => {
    deleteAppMapping(b.dataset.mapdel);
    showToast('Mapping forgotten', 'default');
    renderStimSettings();
  }));

  panel.querySelector('#stim-reset').addEventListener('click', () => {
    openModal(`
      <p style="color:var(--text-secondary);font-size:14px;margin-bottom:20px;">
        This permanently deletes all logged stimulation days and resets the activity library to defaults. This cannot be undone.
      </p>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="stim-reset-cancel">Cancel</button>
        <button class="btn btn-danger" id="stim-reset-confirm">Reset all</button>
      </div>`, 'Reset stimulation data?');
    document.getElementById('stim-reset-cancel').addEventListener('click', closeModal);
    document.getElementById('stim-reset-confirm').addEventListener('click', () => {
      resetStimulation();
      closeModal();
      showToast('Stimulation data reset', 'default');
      renderStimSettings();
    });
  });
}

// Remembered Screen Time app->category mappings, with change + forget controls.
function mappingsHtml() {
  const maps = getAllAppMappings().sort((a, b) => String(a.label || a.key).localeCompare(String(b.label || b.key)));
  if (!maps.length) return '';
  const opts = m => CLASS_OPTIONS.map(o => `<option value="${o.id}" ${m.category === o.id ? 'selected' : ''}>${escS(o.label)}</option>`).join('');
  return `
    <div class="stim-map-head">Remembered apps · ${maps.length}</div>
    <div class="stim-map-list">
      ${maps.map(m => `
        <div class="stim-map-row">
          <span class="stim-map-app">${escS(m.label || m.key)}</span>
          <select class="stim-map-sel" data-mapkey="${escS(m.key)}">${opts(m)}</select>
          <button class="stim-map-del" data-mapdel="${escS(m.key)}" aria-label="Forget mapping">&times;</button>
        </div>`).join('')}
    </div>
    <div class="he-field-help">These guide future imports. Changing one also re-tags that app's stimulation activity.</div>`;
}
