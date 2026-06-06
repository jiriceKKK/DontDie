import { openModal, closeModal } from '../../ui/modal.js';
import { showToast } from '../../ui/toast.js';
import { getSettings, updateSettings, resetStimulation } from '../store.js';

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
