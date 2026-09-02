import { state } from '../state.js';
import { BUILT_IN_HABITS, CATEGORY_COLORS, CATEGORY_LABELS, PRESET_COLORS } from '../constants.js';
import { formatDate, today } from '../utils/date.js';
import {
  persistCustomHabitCreate, persistCustomHabitUpdate, persistCustomHabitDelete,
  persistClearAllLogs,
} from '../data/repository.js';
import { showToast } from '../ui/toast.js';
import { openModal, closeModal } from '../ui/modal.js';
import { safeColor } from '../ui/dom.js';
import { isPersisted } from '../ui/saveFeedback.js';

/** Client-generated habit id — also the idempotency key for its create. */
function newHabitId() {
  try {
    if (globalThis.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch { /* fall through */ }
  const hex = () => Math.floor(Math.random() * 16).toString(16);
  return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, hex);
}
import { switchTab } from '../navigation.js';
import { renderTodayHabits, renderToday } from './today.js';
import { scheduleOf, findEffectiveHabit } from '../habits.js';
import { getActivities } from '../stimulation/store.js';
import {
  getBuiltinOverride, hasBuiltinOverride, setBuiltinOverride, resetBuiltinOverride,
  getCustomMeta, setCustomMeta,
} from '../habitConfig.js';
import { buildBackup } from '../export/backup.js';
import { buildReflection } from '../export/aiReflection.js';
import { downloadFile } from '../export/download.js';

const CAT_OPTIONS = ['gym', 'cardio', 'mobility', 'skill', 'custom'];
const DOW_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Plain-language one-liner for a schedule.
export function scheduleSummary(sch) {
  if (!sch || sch.type === 'daily') return 'Every day';
  if (sch.type === 'interval') return `Every ${Math.max(1, Math.round(Number(sch.everyN) || 1))} days`;
  const order = [1, 2, 3, 4, 5, 6, 0];
  const days = (sch.days || []).slice().sort((a, b) => order.indexOf(a) - order.indexOf(b));
  if (!days.length) return 'No days set';
  if (days.length === 7) return 'Every day';
  return days.map(d => DOW_LABELS[d]).join(' ');
}
const daysFromSchedule = sch => (sch.type === 'weekdays' ? [...(sch.days || [])] : [0, 1, 2, 3, 4, 5, 6]);
const cleanTags = arr => [...new Set((arr || []).map(t => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 6);

export function renderSettings() {
  const panel = document.getElementById('tab-settings');

  const customHabitsHtml = state.customHabits.length === 0
    ? '<p style="color:var(--text-muted);font-size:13px;padding:8px 0;">No custom habits yet.</p>'
    : `<div class="custom-habit-list">
        ${state.customHabits.map(h => renderCustomHabitRow(h)).join('')}
      </div>`;

  const builtinHabitsHtml = BUILT_IN_HABITS.map(h => {
    const eff = findEffectiveHabit(h.id) || h;
    const edited = hasBuiltinOverride(h.id);
    return `
    <div class="habit-edit-row">
      <div class="cat-dot" style="background:${CATEGORY_COLORS[eff.category] || 'var(--accent)'}"></div>
      <div class="habit-edit-main">
        <div class="habit-edit-name">${esc(eff.name)} ${edited ? '<span class="chip chip-edited">edited</span>' : ''}</div>
        <div class="habit-edit-sub">Built-in · ${esc(scheduleSummary(scheduleOf(eff)))}</div>
      </div>
      <button class="habit-edit-btn" data-edit-builtin="${h.id}" aria-label="Edit">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
      </button>
      <label class="toggle-switch" title="Show/hide this habit">
        <input type="checkbox" ${!state.hiddenBuiltins.has(h.id) ? 'checked' : ''} data-builtin="${h.id}">
        <div class="toggle-track"></div>
        <div class="toggle-thumb"></div>
      </label>
    </div>`;
  }).join('');

  panel.innerHTML = `
    <div class="section-title">Habits</div>
    <button class="btn btn-primary" id="add-habit-btn" style="width:100%;margin-bottom:14px;">+ Add habit</button>

    <div id="custom-habits-section">${customHabitsHtml}</div>

    <div class="section-title">Built-in Habits</div>
    <div class="card">${builtinHabitsHtml}</div>

    <div class="section-title">Data Export</div>
    <div class="card">
      <div class="form-group" style="margin-bottom:12px;">
        <label class="form-label">AI report time range</label>
        <select class="form-input" id="export-range">
          <option value="7">Last 7 days</option>
          <option value="30" selected>Last 30 days</option>
          <option value="90">Last 90 days</option>
          <option value="all">All time</option>
        </select>
      </div>
      <div class="data-actions">
        <button class="btn btn-primary" id="export-ai" style="width:100%;justify-content:flex-start;gap:10px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          Export AI reflection report
        </button>
        <button class="btn btn-ghost" id="export-ai-compact" style="width:100%;justify-content:flex-start;gap:10px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
          Export compact AI summary
        </button>
        <button class="btn btn-ghost" id="export-backup" style="width:100%;justify-content:flex-start;gap:10px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Export backup JSON (all time)
        </button>
      </div>
      <p class="export-note">AI reflection export includes explanations and summaries so you can discuss your patterns with an AI. It is not medical advice.</p>
      <p class="export-warn">⚠ This may include personal notes, mood data, stimulation logs and school results. Only share it with an AI or person you trust.</p>
    </div>

    <div class="section-title">Data</div>
    <div class="card data-actions">
      <button class="btn btn-danger" id="clear-btn" style="width:100%;justify-content:flex-start;gap:10px;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
          <path d="M10 11v6M14 11v6"/>
        </svg>
        Clear all habit logs
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

  // Add / edit habit → unified editor modal.
  panel.querySelector('#add-habit-btn').addEventListener('click', () => openHabitEditor({ mode: 'create' }));
  panel.querySelectorAll('[data-edit-builtin]').forEach(btn =>
    btn.addEventListener('click', () => openHabitEditor({ mode: 'edit', kind: 'builtin', id: btn.dataset.editBuiltin })));
  panel.querySelectorAll('[data-edit-custom]').forEach(btn =>
    btn.addEventListener('click', () => openHabitEditor({ mode: 'edit', kind: 'custom', id: btn.dataset.editCustom })));

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
      const result = await persistCustomHabitUpdate(id, { active: habit.active });
      if (!isPersisted(result)) {
        habit.active = !input.checked;
        input.checked = habit.active;
        showToast('This device could not save that change', 'error');
      }
    });
  });

  // Custom habit deletes
  panel.querySelectorAll('[data-delete-custom]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.deleteCustom;
      // A local tombstone, so a cloud hydrate that raced the delete cannot
      // bring the habit back before the remote delete lands.
      const result = await persistCustomHabitDelete(id);
      if (!isPersisted(result)) { showToast('Delete failed on this device', 'error'); return; }
      state.customHabits = state.customHabits.filter(h => h.id !== id);
      showToast('Habit deleted', 'default');
      renderSettings();
    });
  });

  // Exports — whole-app backup JSON + AI reflection / compact reports.
  const dstr = formatDate(today());
  const runExport = (build, filename, mime, okMsg) => {
    try {
      const text = build();
      const ok = downloadFile(filename, text, mime);
      showToast(ok ? okMsg : 'Export failed', ok ? 'success' : 'error');
    } catch (err) {
      console.error('[export]', err);
      showToast('Export failed', 'error');
    }
  };
  panel.querySelector('#export-backup').addEventListener('click', () =>
    runExport(buildBackup, `dontdie_backup_${dstr}.json`, 'application/json', 'Backup exported'));
  panel.querySelector('#export-ai').addEventListener('click', () => {
    const range = panel.querySelector('#export-range').value;
    runExport(() => buildReflection(range, { compact: false }), `dontdie_ai_reflection_${dstr}.md`, 'text/markdown', 'AI report exported');
  });
  panel.querySelector('#export-ai-compact').addEventListener('click', () => {
    const range = panel.querySelector('#export-range').value;
    runExport(() => buildReflection(range, { compact: true }), `dontdie_ai_summary_${dstr}.md`, 'text/markdown', 'Compact summary exported');
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
      const result = await persistClearAllLogs();
      if (!isPersisted(result)) { showToast('Failed to clear data', 'error'); return; }
      state.logsByDate = {};
      showToast('All data cleared', 'default');
      renderToday(today());
    });
  });
}

export function renderCustomHabitRow(h) {
  const eff = findEffectiveHabit(h.id) || h;
  const meta = getCustomMeta(h.id) || {};
  const tags = Array.isArray(meta.tags) ? meta.tags : [];
  const tagsHtml = tags.length ? `<span class="habit-edit-tags">${tags.map(t => `<span class="habit-tag-chip">${esc(t)}</span>`).join('')}</span>` : '';
  return `
    <div class="habit-edit-row">
      <div class="cat-dot" style="background:${safeColor(h.color)}"></div>
      <div class="habit-edit-main">
        <div class="habit-edit-name">${esc(h.name)}</div>
        <div class="habit-edit-sub">${esc(CATEGORY_LABELS[eff.category] || 'Custom')} · ${esc(scheduleSummary(scheduleOf(eff)))}</div>
        ${tagsHtml}
      </div>
      <button class="habit-edit-btn" data-edit-custom="${h.id}" aria-label="Edit">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
      </button>
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

// ---- unified habit editor (create + edit, built-in + custom) --------------
// opts: { mode:'create'|'edit', kind?:'builtin'|'custom', id? }
function openHabitEditor({ mode, kind, id } = {}) {
  const isBuiltin = kind === 'builtin';
  const eff = (mode === 'edit' && id) ? (findEffectiveHabit(id) || {}) : {};
  const sch = scheduleOf(eff);

  const w = {
    name: eff.name || '',
    category: eff.category || (isBuiltin ? 'gym' : 'custom'),
    color: eff.color || PRESET_COLORS[0],
    type: sch.type || 'daily',
    days: new Set(sch.type === 'weekdays' ? (sch.days || []) : (Array.isArray(eff.days) ? eff.days : [1, 2, 3, 4, 5])),
    everyN: sch.type === 'interval' ? (sch.everyN || 40) : 40,
    start: sch.type === 'interval' && sch.start ? sch.start : formatDate(today()),
    tags: cleanTags(eff.tags || []),
    link: {
      enabled: !!(eff.stimLink && eff.stimLink.enabled),
      activityId: (eff.stimLink && eff.stimLink.activityId) || '',
      durationMin: (eff.stimLink && eff.stimLink.durationMin) || 30,
    },
  };

  const stimActs = getActivities();
  if (!w.link.activityId && stimActs.length) w.link.activityId = stimActs[0].id;
  const actOptions = stimActs.map(a => `<option value="${a.id}" ${w.link.activityId === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('');

  const dayBtns = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((lbl, i) => {
    const dow = i === 6 ? 0 : i + 1;
    return `<button type="button" class="day-toggle-btn ${w.days.has(dow) ? 'active' : ''}" data-dow="${dow}">${lbl}</button>`;
  }).join('');

  const catChips = CAT_OPTIONS.map(c => `<button type="button" class="he-cat ${w.category === c ? 'active' : ''}" data-cat="${c}">${CATEGORY_LABELS[c]}</button>`).join('');
  const colorSw = PRESET_COLORS.map(c => `<div class="color-swatch ${w.color === c ? 'selected' : ''}" style="background:${c}" data-color="${c}"></div>`).join('');

  openModal(`
    <div class="form-group">
      <label class="form-label">Name</label>
      <input class="form-input" id="he-name" type="text" maxlength="40" value="${esc(w.name)}" placeholder="e.g. Morning Reading">
    </div>

    <div class="form-group">
      <label class="form-label">Category</label>
      <div class="he-cat-row" id="he-cats">${catChips}</div>
    </div>
    <div class="form-group" id="he-color-group" style="${w.category === 'custom' ? '' : 'display:none;'}">
      <label class="form-label">Color</label>
      <div class="color-swatches" id="he-colors">${colorSw}</div>
    </div>

    <div class="form-group">
      <label class="form-label">Schedule</label>
      <div class="he-sched-row" id="he-sched">
        <button type="button" class="he-sched-btn ${w.type === 'daily' ? 'active' : ''}" data-type="daily">Daily</button>
        <button type="button" class="he-sched-btn ${w.type === 'weekdays' ? 'active' : ''}" data-type="weekdays">Weekdays</button>
        <button type="button" class="he-sched-btn ${w.type === 'interval' ? 'active' : ''}" data-type="interval">Every N days</button>
      </div>
      <div id="he-weekdays" class="day-selector" style="${w.type === 'weekdays' ? '' : 'display:none;'};margin-top:10px;">${dayBtns}</div>
      <div id="he-interval" style="${w.type === 'interval' ? '' : 'display:none;'};margin-top:10px;">
        <div class="he-interval-row">
          <span>Every</span>
          <input class="form-input he-n" id="he-everyn" type="number" inputmode="numeric" min="1" max="365" value="${w.everyN}">
          <span>days, from</span>
          <input class="form-input he-date" id="he-start" type="date" value="${esc(w.start)}">
        </div>
      </div>
    </div>

    <details class="he-advanced">
      <summary>Tags (optional)</summary>
      <input class="form-input" id="he-tags" type="text" value="${esc(w.tags.join(', '))}" placeholder="comma-separated, e.g. supplements, morning">
      <div class="he-field-help">Used as the habit's sub-label. Duplicates are removed.</div>
    </details>

    <details class="he-advanced he-link" ${w.link.enabled ? 'open' : ''} ${stimActs.length ? '' : 'hidden'}>
      <summary>Link to Stimulation (optional)</summary>
      <label class="he-link-toggle"><input type="checkbox" id="he-link-on" ${w.link.enabled ? 'checked' : ''}> Log a Stimulation activity when completed</label>
      <div id="he-link-fields" style="${w.link.enabled ? '' : 'display:none;'}">
        <label class="form-label">Activity</label>
        <select class="form-input" id="he-link-act">${actOptions}</select>
        <label class="form-label" style="margin-top:8px;">Duration (min)</label>
        <input class="form-input" id="he-link-dur" type="number" inputmode="numeric" min="1" max="600" value="${w.link.durationMin}">
        <div class="he-field-help">Ticking this habit adds the activity to Stimulation in the current time block; unticking removes it.</div>
      </div>
    </details>

    ${isBuiltin ? `<button type="button" class="btn btn-ghost" id="he-reset" style="width:100%;margin-top:10px;">Reset to default</button>` : ''}

    <div class="modal-actions">
      <button type="button" class="btn btn-ghost" id="he-cancel">Cancel</button>
      <button type="button" class="btn btn-primary" id="he-save">${mode === 'create' ? 'Add habit' : 'Save'}</button>
    </div>
  `, mode === 'create' ? 'New habit' : `Edit ${isBuiltin ? 'built-in' : ''} habit`);

  const $ = s => document.getElementById(s);
  $('he-cats').querySelectorAll('.he-cat').forEach(b => b.addEventListener('click', () => {
    w.category = b.dataset.cat;
    $('he-cats').querySelectorAll('.he-cat').forEach(x => x.classList.toggle('active', x === b));
    $('he-color-group').style.display = w.category === 'custom' ? '' : 'none';
  }));
  const colorsEl = $('he-colors');
  if (colorsEl) colorsEl.querySelectorAll('.color-swatch').forEach(sw => sw.addEventListener('click', () => {
    w.color = sw.dataset.color;
    colorsEl.querySelectorAll('.color-swatch').forEach(x => x.classList.toggle('selected', x === sw));
  }));
  $('he-sched').querySelectorAll('.he-sched-btn').forEach(b => b.addEventListener('click', () => {
    w.type = b.dataset.type;
    $('he-sched').querySelectorAll('.he-sched-btn').forEach(x => x.classList.toggle('active', x === b));
    $('he-weekdays').style.display = w.type === 'weekdays' ? '' : 'none';
    $('he-interval').style.display = w.type === 'interval' ? '' : 'none';
  }));
  $('he-weekdays').querySelectorAll('.day-toggle-btn').forEach(b => b.addEventListener('click', () => {
    const dow = parseInt(b.dataset.dow);
    if (w.days.has(dow)) { w.days.delete(dow); b.classList.remove('active'); }
    else { w.days.add(dow); b.classList.add('active'); }
  }));
  const linkOn = $('he-link-on');
  if (linkOn) linkOn.addEventListener('change', () => {
    w.link.enabled = linkOn.checked;
    $('he-link-fields').style.display = linkOn.checked ? '' : 'none';
  });
  const linkAct = $('he-link-act');
  if (linkAct) linkAct.addEventListener('change', () => { w.link.activityId = linkAct.value; });
  const linkDur = $('he-link-dur');
  if (linkDur) linkDur.addEventListener('input', () => { w.link.durationMin = Math.max(1, parseInt(linkDur.value) || 1); });

  $('he-cancel').addEventListener('click', closeModal);
  if (isBuiltin && $('he-reset')) $('he-reset').addEventListener('click', () => {
    resetBuiltinOverride(id);
    closeModal(); showToast('Reset to default', 'default');
    renderSettings(); renderTodayHabits(today());
  });

  $('he-save').addEventListener('click', async () => {
    const name = $('he-name').value.trim();
    if (!name) { showToast('Name is required', 'warning'); return; }
    // Build schedule
    let schedule;
    if (w.type === 'daily') schedule = { type: 'daily' };
    else if (w.type === 'weekdays') {
      if (w.days.size === 0) { showToast('Pick at least one day', 'warning'); return; }
      schedule = { type: 'weekdays', days: [...w.days] };
    } else {
      const n = Math.max(1, Math.round(Number($('he-everyn').value) || 1));
      schedule = { type: 'interval', everyN: n, start: $('he-start').value || formatDate(today()) };
    }
    const tags = cleanTags(($('he-tags').value || '').split(','));
    const days = daysFromSchedule(schedule);
    const stimLink = {
      enabled: !!w.link.enabled,
      activityId: w.link.activityId || '',
      durationMin: Math.max(1, Number(w.link.durationMin) || 30),
      blockMode: 'current_time',
    };

    if (mode === 'create') {
      // The id is generated here so the create is idempotent: a retry after an
      // unacknowledged success upserts the same row instead of a duplicate.
      const row = {
        id: newHabitId(),
        name, days, color: w.color, active: true,
        sort_order: state.customHabits.length,
      };
      const result = await persistCustomHabitCreate(row);
      if (!isPersisted(result)) { showToast('This device could not save that habit', 'error'); return; }
      state.customHabits.push(row);
      setCustomMeta(row.id, { tags, schedule, category: w.category, stimLink });
      showToast('Habit added', 'success');
      closeModal(); renderSettings(); switchTab('today');
    } else if (isBuiltin) {
      setBuiltinOverride(id, { name, schedule, category: w.category, days, tags, stimLink });
      showToast('Habit updated', 'success');
      closeModal(); renderSettings(); renderTodayHabits(today());
    } else {
      const habit = state.customHabits.find(h => h.id === id);
      if (habit) { habit.name = name; habit.days = days; habit.color = w.color; }
      await persistCustomHabitUpdate(id, { name, days, color: w.color });
      setCustomMeta(id, { tags, schedule, category: w.category, stimLink });
      showToast('Habit updated', 'success');
      closeModal(); renderSettings(); renderTodayHabits(today());
    }
  });
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
