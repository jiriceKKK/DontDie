import { state } from '../state.js';
import { CATEGORY_COLORS } from '../constants.js';
import { today } from '../utils/date.js';
import { openModal, closeModal } from '../ui/modal.js';
import { showToast } from '../ui/toast.js';
import {
  getSplit, getMuscles, getLibrary, findLibrary, computeVolume, saveSplit,
  addLibraryExercise, updateLibraryExercise,
  addGymItem, updateGymItem, deleteGymItem, gymGroupNames, gymItemContext,
  addMobilityItem, updateMobilityItem, deleteMobilityItem,
  mobilityNameSuggestions, mobItemContext,
} from '../split/store.js';

// Mon-first day list for <select>s and edit-mode iteration.
const DAY_LIST = [
  { dow: 1, name: 'Monday' },    { dow: 2, name: 'Tuesday' }, { dow: 3, name: 'Wednesday' },
  { dow: 4, name: 'Thursday' },  { dow: 5, name: 'Friday' },  { dow: 6, name: 'Saturday' },
  { dow: 0, name: 'Sunday' },
];

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function dayOptions(sel) {
  return DAY_LIST.map(d => `<option value="${d.dow}" ${d.dow === sel ? 'selected' : ''}>${d.name}</option>`).join('');
}
function muscleName(id) {
  const m = getMuscles().find(x => x.id === id);
  return m ? m.name : id;
}
const chevronSvg = `<svg class="split-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`;

// ── Top-level render ──────────────────────────────────────────────────────

export function renderSplit() {
  const panel    = document.getElementById('tab-split');
  const todayDow = today().getDay();
  const edit     = state.splitEdit;

  panel.innerHTML = `
    <div class="split-topbar">
      <div class="pill-nav">
        <button class="pill-btn ${state.splitView === 'fullweek' ? 'active' : ''}" data-view="fullweek">Full Week</button>
        <button class="pill-btn ${state.splitView === 'gymonly'  ? 'active' : ''}" data-view="gymonly">Gym Only</button>
        <button class="pill-btn ${state.splitView === 'mobility' ? 'active' : ''}" data-view="mobility">Mobility</button>
      </div>
      <button class="split-edit-toggle ${edit ? 'active' : ''}" id="split-edit-toggle">${edit ? '✓ Done' : '✎ Edit'}</button>
    </div>
    <div id="split-content"></div>
  `;

  panel.querySelectorAll('.pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.splitView = btn.dataset.view;
      panel.querySelectorAll('.pill-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.view === state.splitView));
      renderSplitContent(state.splitView, todayDow);
    });
  });

  panel.querySelector('#split-edit-toggle').addEventListener('click', () => {
    state.splitEdit = !state.splitEdit;
    renderSplit();
  });

  // Delegated edit-action handler — attached ONCE here (on the freshly created
  // #split-content) so switching pill views doesn't stack duplicate listeners.
  panel.querySelector('#split-content').addEventListener('click', handleAction);

  renderSplitContent(state.splitView, todayDow);
}

function handleAction(e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  const uid = el.dataset.uid;
  if (a === 'add-gym')        openGymModal({ dow: parseInt(el.dataset.dow), group: el.dataset.group || '' });
  else if (a === 'edit-gym')  openGymModal({ uid });
  else if (a === 'del-gym')   { deleteGymItem(uid); saveSplit(); showToast('Exercise removed'); renderSplit(); }
  else if (a === 'add-mob')   openMobilityModal({ dow: parseInt(el.dataset.dow) });
  else if (a === 'edit-mob')  openMobilityModal({ uid });
  else if (a === 'del-mob')   { deleteMobilityItem(uid); saveSplit(); showToast('Exercise removed'); renderSplit(); }
}

function renderSplitContent(view, todayDow) {
  const container = document.getElementById('split-content');
  if (!container) return;
  const edit = state.splitEdit;

  if (view === 'fullweek')      container.innerHTML = renderFullWeek(todayDow, edit);
  else if (view === 'gymonly')  container.innerHTML = renderGymOnly(todayDow, edit);
  else                          container.innerHTML = renderMobility(todayDow, edit);

  wireContent(container, todayDow);
}

// Open/close behaviour for collapsible cards + sections. These attach to fresh
// child elements on every render, so they never stack. (The delegated edit
// actions live on #split-content, wired once in renderSplit.)
function wireContent(container, todayDow) {
  container.querySelectorAll('.split-day-header').forEach(h =>
    h.addEventListener('click', () => h.closest('.split-day-card').classList.toggle('open')));

  container.querySelectorAll('.collapsible-header').forEach(h =>
    h.addEventListener('click', () => {
      const body = h.nextElementSibling;
      if (body && body.classList.contains('collapsible-body')) body.classList.toggle('open');
    }));
}

function openClassFor(isToday, edit) {
  // Edit mode keeps every card open so editing never fights a collapse.
  return (edit || isToday || window.innerWidth >= 768) ? ' open' : '';
}

// ── Full Week view ────────────────────────────────────────────────────────

function renderFullWeek(todayDow, edit) {
  const split = getSplit();
  let html = edit
    ? `<div class="edit-hint">Switch to <strong>Gym Only</strong> or <strong>Mobility</strong> to edit exercises and volume.</div>`
    : '';

  for (const day of split.days) {
    const isToday = day.dow === todayDow;
    html += `
      <div class="split-day-card${isToday ? ' today-card' : ''}${openClassFor(isToday, edit)}" data-day="${day.dow}">
        <div class="split-day-header">
          <div>
            <div class="split-day-title">${esc(day.name)}</div>
            <div class="split-day-subtitle">${esc(day.label)}</div>
          </div>
          ${chevronSvg}
        </div>
        <div class="split-day-body">
          <div class="split-day-body-inner">
            <div class="split-activity-list">
              ${day.activities.map(a => `
                <div class="split-activity-item">
                  <div class="cat-dot" style="background:${CATEGORY_COLORS[a.cat] || 'var(--text-muted)'}"></div>
                  <div>${esc(a.text)}${a.sub ? ` <span>${esc(a.sub)}</span>` : ''}</div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>`;
  }
  return html;
}

// ── Gym Only view ─────────────────────────────────────────────────────────

function renderGymOnly(todayDow, edit) {
  const split = getSplit();
  // Normal mode: only days that have gym work. Edit mode: every day, so you can
  // add gym work to a currently-rest day.
  const days = edit ? split.days : split.days.filter(d => d.gym);
  let html = '';

  for (const day of days) {
    const isToday = day.dow === todayDow;
    const groups  = (day.gym && day.gym.groups) || [];
    const title   = (day.gym && day.gym.title) || day.name;

    html += `
      <div class="split-day-card${isToday ? ' today-card' : ''}${openClassFor(isToday, edit)}" data-day="${day.dow}">
        <div class="split-day-header">
          <div><div class="split-day-title">${esc(title)}</div></div>
          ${chevronSvg}
        </div>
        <div class="split-day-body">
          <div class="split-day-body-inner">
            <div class="gym-exercises">
              ${groups.map(g => renderGymGroup(g, edit)).join('')}
            </div>
            ${edit ? `<button class="split-add-btn" data-action="add-gym" data-dow="${day.dow}">+ Add exercise</button>` : ''}
          </div>
        </div>
      </div>`;
  }

  return html + renderVolume(edit);
}

function renderGymGroup(group, edit) {
  if (edit) {
    return `
      <div class="gym-muscle-group">
        <div class="gym-muscle-label">${esc(group.name)}</div>
        <div class="edit-list">
          ${group.items.map(it => {
            const ex = findLibrary(it.ref);
            const meta = [`${it.sets}×`, it.reps, it.rest].filter(Boolean).map(esc).join(' · ');
            return `
              <div class="edit-row" data-action="edit-gym" data-uid="${it.uid}">
                <span class="edit-row-name">${esc(ex ? ex.name : '(removed)')}</span>
                <span class="edit-row-meta">${meta}</span>
                <button class="edit-row-del" data-action="del-gym" data-uid="${it.uid}" aria-label="Delete">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>`;
          }).join('')}
        </div>
      </div>`;
  }
  return `
    <div class="gym-muscle-group">
      <div class="gym-muscle-label">${esc(group.name)}</div>
      <div class="gym-exercise-list">
        ${group.items.map(it => {
          const ex = findLibrary(it.ref);
          return `<div class="gym-exercise-chip">${esc(ex ? ex.name : '(removed)')} ${it.sets}×</div>`;
        }).join('')}
      </div>
    </div>`;
}

function renderVolume(edit) {
  const vol = computeVolume();
  const chips = getMuscles().map(mus => {
    const { direct, indirect } = vol[mus.id] || { direct: 0, indirect: 0 };
    const cls = direct >= mus.min ? 'good' : (direct >= mus.min * 0.7 ? 'ok' : '');
    return `
      <div class="volume-chip ${cls}">
        <div class="volume-label">${esc(mus.name)}</div>
        <div class="volume-num">${direct}${indirect > 0 ? `<span class="volume-indirect">+${indirect}</span>` : ''}</div>
      </div>`;
  }).join('');

  // Collapsed by default in normal mode (matches the original); auto-open while
  // editing so you can watch volume change as you adjust sets.
  return `
    <div class="collapsible-header" id="volume-toggle">
      Weekly Volume ${chevronSvg}
    </div>
    <div class="collapsible-body${edit ? ' open' : ''}">
      <div class="collapsible-inner">
        <div class="volume-grid">${chips}</div>
        <div class="volume-legend">Big number = direct sets · small <span class="volume-indirect">+n</span> = indirect</div>
      </div>
    </div>`;
}

// ── Mobility view ─────────────────────────────────────────────────────────

function renderMobility(todayDow, edit) {
  const split  = getSplit();
  const warmup = split.warmup;

  let html = `
    <div class="split-day-card open" style="margin-bottom:10px;">
      <div class="split-day-header">
        <div>
          <div class="split-day-title">Every Day — Pre-workout Warm-up</div>
          <div class="split-day-subtitle">${esc(warmup.duration)}</div>
        </div>
        ${chevronSvg}
      </div>
      <div class="split-day-body">
        <div class="split-day-body-inner">
          <div class="mobility-exercise-list">
            ${(warmup.items || []).map(ex => `
              <div class="mobility-exercise-row ${ex.priority ? 'priority' : ''}">
                ${ex.priority ? '<div class="mobility-priority-dot"></div>' : '<div class="mobility-dot"></div>'}
                <div class="mobility-exercise-name">${esc(ex.name)}${ex.priority ? ' ★' : ''}</div>
                <div class="mobility-exercise-detail">${esc(ex.detail)}</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    </div>`;

  for (const day of split.days) {
    const isToday = day.dow === todayDow;
    const mob = day.mobility || { items: [] };
    const pailsBadge = mob.pails ? `<span class="mobility-pails-badge">PAILs/RAILs</span>` : '';
    const pailsExplainer = mob.pails && mob.pailsMethod
      ? `<div class="mobility-pails-explainer">${esc(mob.pailsMethod)}</div>` : '';
    const noteHtml = mob.note ? `<div class="mobility-day-note">${esc(mob.note)}</div>` : '';

    const itemsHtml = edit
      ? `<div class="edit-list">${mob.items.map(it => `
          <div class="edit-row" data-action="edit-mob" data-uid="${it.uid}">
            <span class="edit-row-name">${it.priority ? '★ ' : ''}${esc(it.name)}${it.pails ? ' · PAILs' : ''}</span>
            <span class="edit-row-meta">${esc(it.detail)}</span>
            <button class="edit-row-del" data-action="del-mob" data-uid="${it.uid}" aria-label="Delete">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>`).join('')}
        </div>
        <button class="split-add-btn" data-action="add-mob" data-dow="${day.dow}">+ Add exercise</button>`
      : `<div class="mobility-exercise-list">${mob.items.map(ex => `
          <div class="mobility-exercise-row ${ex.pails ? 'has-pails' : ''}">
            <div class="mobility-dot"></div>
            <div class="mobility-exercise-name">${esc(ex.name)}</div>
            <div class="mobility-exercise-detail">${esc(ex.detail)}</div>
          </div>`).join('')}
        </div>`;

    html += `
      <div class="split-day-card${isToday ? ' today-card' : ''}${openClassFor(isToday, edit)}" data-day="${day.dow}">
        <div class="split-day-header">
          <div>
            <div class="split-day-title" style="display:flex;align-items:center;gap:8px;">${esc(day.name)} ${pailsBadge}</div>
            <div class="split-day-subtitle">${esc(mob.label || '')}</div>
          </div>
          ${chevronSvg}
        </div>
        <div class="split-day-body">
          <div class="split-day-body-inner">
            ${noteHtml}
            ${pailsExplainer}
            ${itemsHtml}
          </div>
        </div>
      </div>`;
  }

  const notesHtml = split.notes.map(n => `
    <div class="mobility-note-item ${n.priority ? 'priority' : ''}">
      <div class="mobility-note-dot"></div>
      <div>${esc(n.text)}</div>
    </div>`).join('');

  html += `
    <div class="collapsible-header" id="mobility-notes-toggle">
      Notes & Cues ${chevronSvg}
    </div>
    <div class="collapsible-body">
      <div class="mobility-notes-list">${notesHtml}</div>
    </div>`;

  return html;
}

// ── Gym exercise edit modal ───────────────────────────────────────────────

function openGymModal({ uid = null, dow = 1, group = '' }) {
  const editing = !!uid;
  const muscles = getMuscles();

  let working;
  if (editing) {
    const ctx = gymItemContext(uid);
    if (!ctx) return;
    working = { isNew: false, ref: ctx.ref, name: ctx.name, tags: ctx.tags,
                sets: ctx.sets, reps: ctx.reps, rest: ctx.rest, group: ctx.group, dow: ctx.dow };
  } else {
    working = { isNew: true, ref: null, name: '', tags: [], sets: 3, reps: '', rest: '', group, dow };
  }

  openModal('', editing ? 'Edit exercise' : 'Add exercise');
  renderForm();

  function syncInputs() {
    const v = id => { const el = document.getElementById(id); return el ? el.value : undefined; };
    const s = v('gx-sets'); if (s !== undefined) working.sets = s;
    const r = v('gx-reps'); if (r !== undefined) working.reps = r;
    const t = v('gx-rest'); if (t !== undefined) working.rest = t;
    const g = v('gx-group'); if (g !== undefined) working.group = g;
    const d = v('gx-day'); if (d !== undefined) working.dow = parseInt(d);
    const n = v('gx-name'); if (n !== undefined) working.name = n;
  }

  function buildForm() {
    const lib = getLibrary();
    return `
      <form id="gx-form" class="settings-form" style="margin-bottom:0;">
        <div class="form-group">
          <label class="form-label">Exercise</label>
          <select class="form-input" id="gx-ex">
            <option value="__new" ${working.isNew ? 'selected' : ''}>➕ New exercise…</option>
            ${lib.map(e => `<option value="${e.id}" ${(!working.isNew && working.ref === e.id) ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}
          </select>
        </div>
        ${working.isNew ? `
          <div class="form-group">
            <label class="form-label">Name</label>
            <input class="form-input" id="gx-name" type="text" value="${esc(working.name)}" placeholder="e.g. Lat Pulldown" maxlength="40">
          </div>` : ''}
        <div class="form-row">
          <div class="form-group"><label class="form-label">Sets</label>
            <input class="form-input" id="gx-sets" type="number" inputmode="numeric" min="0" max="30" value="${esc(working.sets)}"></div>
          <div class="form-group"><label class="form-label">Reps</label>
            <input class="form-input" id="gx-reps" type="text" value="${esc(working.reps)}" placeholder="8–12"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Rest</label>
            <input class="form-input" id="gx-rest" type="text" value="${esc(working.rest)}" placeholder="2 min"></div>
          <div class="form-group"><label class="form-label">Day</label>
            <select class="form-input" id="gx-day">${dayOptions(working.dow)}</select></div>
        </div>
        <div class="form-group">
          <label class="form-label">Section</label>
          <input class="form-input" id="gx-group" type="text" list="gx-groups" value="${esc(working.group)}" placeholder="e.g. Chest">
          <datalist id="gx-groups">${gymGroupNames().map(n => `<option value="${esc(n)}">`).join('')}</datalist>
        </div>
        <div class="form-group">
          <label class="form-label">Volume tags</label>
          <div id="gx-tags" class="tag-editor"></div>
        </div>
        <div class="modal-actions">
          ${editing ? `<button type="button" class="btn btn-danger" id="gx-delete">Delete</button>` : ''}
          <button type="submit" class="btn btn-primary">${editing ? 'Save' : 'Add'}</button>
        </div>
      </form>`;
  }

  function renderForm() {
    const body = document.querySelector('.modal-body');
    if (!body) return;
    body.innerHTML = buildForm();

    document.getElementById('gx-ex').addEventListener('change', (e) => {
      syncInputs();
      const val = e.target.value;
      if (val === '__new') {
        working.isNew = true; working.ref = null; working.name = ''; working.tags = [];
      } else {
        const ex = findLibrary(val);
        working.isNew = false; working.ref = val;
        working.name = ex ? ex.name : '';
        working.tags = ex ? JSON.parse(JSON.stringify(ex.tags)) : [];
        if (ex) { working.sets = ex.sets; working.reps = ex.reps || ''; working.rest = ex.rest || ''; }
        if (!working.group && ex && ex.tags[0]) working.group = muscleName(ex.tags[0].muscle);
      }
      renderForm();
    });

    document.getElementById('gx-form').addEventListener('submit', (e) => {
      e.preventDefault();
      syncInputs();
      const name = working.isNew ? (working.name || '').trim() : working.name;
      if (working.isNew && !name) { showToast('Enter an exercise name', 'warning'); return; }
      const sets  = parseInt(working.sets) || 0;
      const reps  = (working.reps || '').trim();
      const rest  = (working.rest || '').trim();
      const grp   = (working.group || '').trim() || 'Other';
      const dowT  = working.dow;

      let ref = working.ref;
      if (working.isNew) ref = addLibraryExercise({ name, tags: working.tags, sets, reps, rest });
      else               updateLibraryExercise(ref, { name, tags: working.tags });

      if (editing) updateGymItem(uid, { ref, sets, reps, rest, group: grp, dow: dowT });
      else         addGymItem(dowT, grp, { ref, sets, reps, rest });

      saveSplit();
      closeModal();
      state.splitView = 'gymonly';
      renderSplit();
    });

    const delBtn = document.getElementById('gx-delete');
    if (delBtn) delBtn.addEventListener('click', () => {
      deleteGymItem(uid); saveSplit(); closeModal();
      state.splitView = 'gymonly'; renderSplit();
    });

    renderTags();
  }

  function renderTags() {
    const host = document.getElementById('gx-tags');
    if (!host) return;
    const tagged = new Set(working.tags.map(t => t.muscle));
    const remaining = muscles.filter(m => !tagged.has(m.id));

    host.innerHTML =
      working.tags.map(tg => `
        <div class="tag-row">
          <span class="tag-muscle">${esc(muscleName(tg.muscle))}</span>
          <div class="seg">
            <button type="button" class="seg-btn ${tg.type !== 'indirect' ? 'active' : ''}" data-tag="${tg.muscle}" data-type="direct">Direct</button>
            <button type="button" class="seg-btn ${tg.type === 'indirect' ? 'active' : ''}" data-tag="${tg.muscle}" data-type="indirect">Indirect</button>
          </div>
          <button type="button" class="tag-count ${tg.count !== false ? 'on' : ''}" data-tagcount="${tg.muscle}">${tg.count !== false ? 'counts' : 'off'}</button>
          <button type="button" class="tag-remove" data-tagdel="${tg.muscle}" aria-label="Remove">×</button>
        </div>`).join('')
      + (remaining.length ? `
        <select class="form-input tag-add" id="gx-tag-add">
          <option value="">+ Add muscle…</option>
          ${remaining.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}
        </select>` : '')
      + (working.tags.length ? '' : `<div class="tag-empty">No volume tags — this exercise won't add to weekly volume.</div>`);

    host.querySelectorAll('.seg-btn').forEach(b => b.addEventListener('click', () => {
      const tg = working.tags.find(t => t.muscle === b.dataset.tag);
      if (tg) { tg.type = b.dataset.type; renderTags(); }
    }));
    host.querySelectorAll('[data-tagcount]').forEach(b => b.addEventListener('click', () => {
      const tg = working.tags.find(t => t.muscle === b.dataset.tagcount);
      if (tg) { tg.count = tg.count === false; renderTags(); }
    }));
    host.querySelectorAll('[data-tagdel]').forEach(b => b.addEventListener('click', () => {
      working.tags = working.tags.filter(t => t.muscle !== b.dataset.tagdel);
      renderTags();
    }));
    const add = document.getElementById('gx-tag-add');
    if (add) add.addEventListener('change', () => {
      if (add.value) { working.tags.push({ muscle: add.value, type: 'direct', count: true }); renderTags(); }
    });
  }
}

// ── Mobility edit modal ───────────────────────────────────────────────────

function openMobilityModal({ uid = null, dow = 1 }) {
  const editing = !!uid;
  let w;
  if (editing) { w = mobItemContext(uid); if (!w) return; }
  else         { w = { dow, name: '', detail: '', priority: false, pails: false }; }

  const suggestions = mobilityNameSuggestions();
  const html = `
    <form id="mob-form" class="settings-form" style="margin-bottom:0;">
      <div class="form-group">
        <label class="form-label">Exercise</label>
        <input class="form-input" id="mb-name" type="text" list="mb-names" value="${esc(w.name)}" placeholder="e.g. Couch stretch" maxlength="60">
        <datalist id="mb-names">${suggestions.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
      </div>
      <div class="form-group">
        <label class="form-label">Detail</label>
        <input class="form-input" id="mb-detail" type="text" value="${esc(w.detail)}" placeholder="e.g. 45 sec/side · 3 rounds · 10 reps">
      </div>
      <div class="form-group">
        <label class="form-label">Day</label>
        <select class="form-input" id="mb-day">${dayOptions(w.dow)}</select>
      </div>
      <label class="edit-check"><input type="checkbox" id="mb-priority" ${w.priority ? 'checked' : ''}> Priority (★ highlight)</label>
      <label class="edit-check"><input type="checkbox" id="mb-pails" ${w.pails ? 'checked' : ''}> PAILs/RAILs</label>
      <div class="modal-actions">
        ${editing ? `<button type="button" class="btn btn-danger" id="mb-delete">Delete</button>` : ''}
        <button type="submit" class="btn btn-primary">${editing ? 'Save' : 'Add'}</button>
      </div>
    </form>`;

  openModal(html, editing ? 'Edit mobility' : 'Add mobility');

  document.getElementById('mob-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('mb-name').value.trim();
    if (!name) { showToast('Enter an exercise name', 'warning'); return; }
    const detail   = document.getElementById('mb-detail').value.trim();
    const dowT     = parseInt(document.getElementById('mb-day').value);
    const priority = document.getElementById('mb-priority').checked;
    const pails    = document.getElementById('mb-pails').checked;

    if (editing) updateMobilityItem(uid, { name, detail, priority, pails, dow: dowT });
    else         addMobilityItem(dowT, { name, detail, priority, pails });

    saveSplit();
    closeModal();
    state.splitView = 'mobility';
    renderSplit();
  });

  const delBtn = document.getElementById('mb-delete');
  if (delBtn) delBtn.addEventListener('click', () => {
    deleteMobilityItem(uid); saveSplit(); closeModal();
    state.splitView = 'mobility'; renderSplit();
  });
}
