import { state } from '../state.js';
import { BUILT_IN_HABITS, CATEGORY_COLORS, PRESET_COLORS } from '../constants.js';
import { formatDate, today } from '../utils/date.js';
import {
  dbCreateCustomHabit, dbUpdateCustomHabit, dbDeleteCustomHabit,
  dbDeleteAllLogs, dbExportAll,
} from '../db.js';
import { showToast } from '../ui/toast.js';
import { openModal, closeModal } from '../ui/modal.js';
import { switchTab } from '../navigation.js';
import { renderTodayHabits, renderToday } from './today.js';

export function renderSettings() {
  const panel = document.getElementById('tab-settings');

  const customHabitsHtml = state.customHabits.length === 0
    ? '<p style="color:var(--text-muted);font-size:13px;padding:8px 0;">No custom habits yet.</p>'
    : `<div class="custom-habit-list">
        ${state.customHabits.map(h => renderCustomHabitRow(h)).join('')}
      </div>`;

  const builtinHabitsHtml = BUILT_IN_HABITS.map(h => `
    <div class="builtin-habit-row">
      <div class="cat-dot" style="background:${CATEGORY_COLORS[h.category]}"></div>
      <div class="builtin-habit-name">${h.name}</div>
      <span class="chip chip-builtin">Built-in</span>
      <label class="toggle-switch" title="Show/hide this habit">
        <input type="checkbox" ${!state.hiddenBuiltins.has(h.id) ? 'checked' : ''} data-builtin="${h.id}">
        <div class="toggle-track"></div>
        <div class="toggle-thumb"></div>
      </label>
    </div>
  `).join('');

  panel.innerHTML = `
    <div class="section-title">Add Custom Habit</div>
    <div class="card">
      <form id="add-habit-form" class="settings-form">
        <div class="form-group">
          <label class="form-label">Name</label>
          <input class="form-input" id="new-habit-name" type="text" placeholder="e.g. Morning Reading" maxlength="40" required>
        </div>
        <div class="form-group">
          <label class="form-label">Days</label>
          <div class="day-selector" id="day-selector">
            ${['M','T','W','T','F','S','S'].map((lbl, i) => {
              const dow = i === 6 ? 0 : i + 1;
              return `<button type="button" class="day-toggle-btn" data-dow="${dow}">${lbl}</button>`;
            }).join('')}
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Color</label>
          <div class="color-swatches" id="color-swatches">
            ${PRESET_COLORS.map((c, i) => `
              <div class="color-swatch ${i === 0 ? 'selected' : ''}"
                   style="background:${c}" data-color="${c}"></div>
            `).join('')}
          </div>
        </div>
        <button type="submit" class="btn btn-primary" style="width:100%;">Add Habit</button>
      </form>
    </div>

    <div class="section-title">Custom Habits</div>
    <div id="custom-habits-section">${customHabitsHtml}</div>

    <div class="section-title">Built-in Habits</div>
    <div class="card">${builtinHabitsHtml}</div>

    <div class="section-title">Data</div>
    <div class="card data-actions">
      <button class="btn btn-ghost" id="export-btn" style="width:100%;justify-content:flex-start;gap:10px;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        Export data as JSON
      </button>
      <button class="btn btn-danger" id="clear-btn" style="width:100%;justify-content:flex-start;gap:10px;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
          <path d="M10 11v6M14 11v6"/>
        </svg>
        Clear all data
      </button>
    </div>

    <div class="section-title">About</div>
    <div class="card">
      <div style="display:flex;flex-direction:column;gap:10px;">
        <div style="display:flex;justify-content:space-between;font-size:13px;">
          <span style="color:var(--text-muted)">Version</span>
          <span style="font-family:var(--font-mono)">1.0.0</span>
        </div>
        <div class="connection-status">
          <div class="status-dot ${state.connectionOk ? 'connected' : 'error'}" id="conn-dot"></div>
          <span id="conn-label">${state.connectionOk ? 'Supabase connected' : 'Connection error'}</span>
        </div>
      </div>
    </div>
  `;

  // Day selector
  const selectedDays = new Set();
  panel.querySelectorAll('.day-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const dow = parseInt(btn.dataset.dow);
      if (selectedDays.has(dow)) { selectedDays.delete(dow); btn.classList.remove('active'); }
      else                       { selectedDays.add(dow);    btn.classList.add('active');    }
    });
  });

  // Color swatches
  let selectedColor = PRESET_COLORS[0];
  panel.querySelectorAll('.color-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      panel.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      swatch.classList.add('selected');
      selectedColor = swatch.dataset.color;
    });
  });

  // Add habit form
  panel.querySelector('#add-habit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('new-habit-name').value.trim();
    if (!name) return;
    if (selectedDays.size === 0) { showToast('Select at least one day', 'warning'); return; }

    const { data, error } = await dbCreateCustomHabit({
      name, days: [...selectedDays], color: selectedColor,
      sort_order: state.customHabits.length,
    });
    if (error) { showToast('Failed to save habit', 'error'); return; }
    state.customHabits.push(data);
    showToast('Habit added', 'success');
    renderSettings();
    switchTab('today');
  });

  // Built-in visibility toggles
  panel.querySelectorAll('[data-builtin]').forEach(input => {
    input.addEventListener('change', () => {
      const habitId = input.dataset.builtin;
      if (input.checked) state.hiddenBuiltins.delete(habitId);
      else               state.hiddenBuiltins.add(habitId);
      saveHiddenBuiltins();
      renderTodayHabits(today());
    });
  });

  // Custom habit toggles
  panel.querySelectorAll('[data-toggle-custom]').forEach(input => {
    input.addEventListener('change', async () => {
      const id    = input.dataset.toggleCustom;
      const habit = state.customHabits.find(h => h.id === id);
      if (!habit) return;
      habit.active = input.checked;
      await dbUpdateCustomHabit(id, { active: habit.active });
    });
  });

  // Custom habit deletes
  panel.querySelectorAll('[data-delete-custom]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.deleteCustom;
      const { error } = await dbDeleteCustomHabit(id);
      if (error) { showToast('Delete failed', 'error'); return; }
      state.customHabits = state.customHabits.filter(h => h.id !== id);
      showToast('Habit deleted', 'default');
      renderSettings();
    });
  });

  // Export
  panel.querySelector('#export-btn').addEventListener('click', async () => {
    const { data, error } = await dbExportAll();
    if (error) { showToast('Export failed', 'error'); return; }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `dontdie-export-${formatDate(today())}.json`; a.click();
    URL.revokeObjectURL(url);
  });

  // Clear all
  panel.querySelector('#clear-btn').addEventListener('click', () => {
    openModal(`
      <p style="color:var(--text-secondary);font-size:14px;margin-bottom:20px;">
        This will permanently delete all habit log data. This cannot be undone.
      </p>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-ghost" id="cancel-clear" style="flex:1;">Cancel</button>
        <button class="btn btn-danger" id="confirm-clear" style="flex:1;">Delete All</button>
      </div>
    `, 'Clear All Data?');

    document.getElementById('cancel-clear').addEventListener('click', closeModal);
    document.getElementById('confirm-clear').addEventListener('click', async () => {
      closeModal();
      const { error } = await dbDeleteAllLogs();
      if (error) { showToast('Failed to clear data', 'error'); return; }
      state.logsByDate = {};
      showToast('All data cleared', 'default');
      renderToday(today());
    });
  });
}

export function renderCustomHabitRow(h) {
  const dayDots = [1,2,3,4,5,6,0].map(dow => `
    <div class="custom-habit-day-dot ${h.days.includes(dow) ? 'active' : ''}"></div>
  `).join('');

  return `
    <div class="custom-habit-row">
      <div class="custom-habit-color" style="background:${h.color || 'var(--accent)'}"></div>
      <div class="custom-habit-name">${h.name}</div>
      <div class="custom-habit-days">${dayDots}</div>
      <label class="toggle-switch">
        <input type="checkbox" ${h.active ? 'checked' : ''} data-toggle-custom="${h.id}">
        <div class="toggle-track"></div>
        <div class="toggle-thumb"></div>
      </label>
      <button class="custom-habit-delete" data-delete-custom="${h.id}" aria-label="Delete">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
        </svg>
      </button>
    </div>
  `;
}

export function saveHiddenBuiltins() {
  localStorage.setItem('hidden_builtins', JSON.stringify([...state.hiddenBuiltins]));
}

export function loadHiddenBuiltins() {
  try {
    const stored = JSON.parse(localStorage.getItem('hidden_builtins') || '[]');
    state.hiddenBuiltins = new Set(stored);
  } catch {
    state.hiddenBuiltins = new Set();
  }
}
